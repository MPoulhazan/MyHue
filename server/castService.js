import { Client } from 'castv2';
import mdns from 'mdns-js';
import os from 'os';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

let discoveredDevices = new Map();
let browser = null;

const MEDIA_NS = 'urn:x-cast:com.google.cast.media';
const RECEIVER_NS = 'urn:x-cast:com.google.cast.receiver';
const CONNECTION_NS = 'urn:x-cast:com.google.cast.tp.connection';
const HEARTBEAT_NS = 'urn:x-cast:com.google.cast.tp.heartbeat';
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';
const BACKDROP_APP_ID = 'E8C28D3C'; // écran d'accueil : rien ne joue

// Identifiant stable tiré du nom : l'adresse IP d'une enceinte change avec le DHCP
const idFromName = (name) =>
    name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const findByName = (name) =>
    Array.from(discoveredDevices.values()).find((d) => d.name.toLowerCase() === name.toLowerCase());

// --- Device management ---

const loadManualDevices = () => {
    const manualConfig = process.env.CAST_DEVICES;
    if (manualConfig) {
        const devices = manualConfig.split(',');
        devices.forEach(device => {
            const [name, host] = device.split(':').map(s => s.trim());
            if (name && host) {
                const deviceInfo = { name, host, port: 8009, id: idFromName(name), manual: true, online: false };
                discoveredDevices.set(deviceInfo.id, deviceInfo);
                console.log(`📱 Manually configured Cast device: ${name} (${host})`);
            }
        });
    }
};

loadManualDevices();

export const startDiscovery = () => {
    if (browser) return;
    try {
        browser = mdns.createBrowser(mdns.tcp('googlecast'));
        browser.on('ready', () => {
            console.log('🔍 Google Cast discovery started...');
            browser.discover();
        });
        browser.on('update', (device) => {
            if (device.type && device.type.includes('googlecast')) {
                const ipv4 = (device.addresses || []).find(a => a.includes('.'));
                if (ipv4) {
                    const name = device.fullname || device.txt?.fn || 'Unknown';
                    const known = findByName(name);
                    if (known) {
                        known.host = ipv4;
                        known.online = true;
                        return;
                    }
                    const info = { name, host: ipv4, port: device.port || 8009, id: device.txt?.id || ipv4, online: true };
                    discoveredDevices.set(info.id, info);
                    console.log(`📱 Found Cast device: ${info.name} (${info.host})`);
                }
            }
        });
        browser.on('error', (e) => console.error('❌ Discovery error:', e.message));
    } catch (e) {
        console.error('❌ Failed to start discovery:', e.message);
    }
};

export const getDevices = () => Array.from(discoveredDevices.values());

// --- Joignabilité et nouvelle adresse après un changement d'IP ---
// Le mDNS ne passe pas toujours (add-on, Windows) : on interroge la page eureka (port 8008)
// des enceintes connues, et si l'une ne répond plus on balaie le sous-réseau pour la retrouver par son nom.

const probe = async (host) => {
    try {
        const { data } = await axios.get(`http://${host}:8008/setup/eureka_info`, { timeout: 1500, params: { params: 'name' } });
        return data?.name ? data : null;
    } catch {
        return null;
    }
};

const localSubnets = () => {
    const subnets = new Set();
    for (const addrs of Object.values(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal && a.netmask === '255.255.255.0' && /^(192\.168|10)\./.test(a.address)) {
                subnets.add(a.address.split('.').slice(0, 3).join('.'));
            }
        }
    }
    return [...subnets];
};

const SCAN_EVERY_MS = 15 * 60_000;
let lastScan = 0;

const scanSubnets = async (seen) => {
    lastScan = Date.now();
    for (const subnet of localSubnets()) {
        for (let start = 1; start < 255; start += 32) {
            const hosts = [];
            for (let i = start; i < Math.min(start + 32, 255); i++) hosts.push(`${subnet}.${i}`);
            const found = await Promise.all(hosts.map(async (host) => ({ host, info: await probe(host) })));
            for (const { host, info } of found) {
                if (!info) continue;
                const known = findByName(info.name);
                if (known) {
                    if (known.host !== host) console.log(`📱 Cast device ${known.name} moved: ${known.host} → ${host}`);
                    known.host = host;
                    seen.add(known.id);
                } else {
                    const device = { name: info.name, host, port: 8009, id: idFromName(info.name), online: true };
                    discoveredDevices.set(device.id, device);
                    seen.add(device.id);
                    console.log(`📱 Found Cast device by scan: ${device.name} (${host})`);
                }
            }
        }
    }
};

let refreshing = null;

/** Met à jour `online` (et l'adresse si besoin) de chaque enceinte. `force` balaie le réseau même si le dernier balayage est récent. */
export const refreshDevices = ({ force = false } = {}) => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const devices = getDevices();
        const seen = new Set();
        const answers = await Promise.all(devices.map((d) => probe(d.host)));
        devices.forEach((d, i) => answers[i] && seen.add(d.id));
        const missing = devices.length === 0 || seen.size < devices.length;
        if (missing && (force || Date.now() - lastScan > SCAN_EVERY_MS)) await scanSubnets(seen);
        for (const d of discoveredDevices.values()) d.online = seen.has(d.id);
    })().finally(() => { refreshing = null; });
    return refreshing;
};

// Connexion à une enceinte ; si elle échoue, on la cherche à sa nouvelle adresse et on réessaie une fois
const connectDevice = async (deviceId) => {
    const device = discoveredDevices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    try {
        return { device, conn: await createCastConnection(device.host) };
    } catch (err) {
        const before = device.host;
        await refreshDevices({ force: true });
        if (device.host === before) throw err;
        return { device, conn: await createCastConnection(device.host) };
    }
};

// --- Lecture en cours (pour le mini-lecteur) ---

let nowPlaying = null;

export const getNowPlaying = () => nowPlaying;

const readReceiverStatus = (receiver) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Status timeout')), 5000);
    const handler = (data) => {
        if (data.type === 'RECEIVER_STATUS') {
            clearTimeout(timer);
            receiver.removeListener('message', handler);
            resolve(data.status);
        }
    };
    receiver.on('message', handler);
    receiver.send({ type: 'GET_STATUS', requestId: 7 });
});

const volumePct = (status) => (status?.volume?.level != null ? Math.round(status.volume.level * 100) : null);

// Recale l'état sur l'enceinte : arrêtée depuis la voix ou une autre appli, le mini-lecteur disparaît
const syncNowPlaying = async () => {
    if (!nowPlaying) return;
    const device = discoveredDevices.get(nowPlaying.deviceId);
    if (!device) return;
    let conn;
    try {
        conn = await createCastConnection(device.host);
        const status = await readReceiverStatus(conn.receiver);
        if (!nowPlaying) return;
        const apps = (status.applications || []).filter((a) => a.appId !== BACKDROP_APP_ID && !a.isIdleScreen);
        if (!apps.length) nowPlaying = null;
        else if (volumePct(status) != null) nowPlaying.volume = volumePct(status);
    } catch {
        // enceinte momentanément injoignable : on garde l'état
    } finally {
        conn?.cleanup();
    }
};

export const findDevice = (nameQuery) => {
    const q = nameQuery.toLowerCase();
    return Array.from(discoveredDevices.values()).find(d =>
        d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
    );
};

// --- Raw Cast v2 protocol helpers ---

const createCastConnection = (host) => {
    return new Promise((resolve, reject) => {
        const client = new Client();
        const timer = setTimeout(() => {
            client.close();
            reject(new Error('Connection timeout'));
        }, 10000);

        client.on('error', (err) => {
            clearTimeout(timer);
            try { client.close(); } catch {}
            reject(err);
        });

        client.connect({ host, port: 8009 }, () => {
            clearTimeout(timer);

            // Open connection channel to receiver
            const connection = client.createChannel('sender-0', 'receiver-0', CONNECTION_NS, 'JSON');
            const heartbeat = client.createChannel('sender-0', 'receiver-0', HEARTBEAT_NS, 'JSON');
            const receiver = client.createChannel('sender-0', 'receiver-0', RECEIVER_NS, 'JSON');

            connection.send({ type: 'CONNECT' });

            // Keep alive
            const hbInterval = setInterval(() => {
                try { heartbeat.send({ type: 'PING' }); } catch {}
            }, 5000);

            const cleanup = () => {
                clearInterval(hbInterval);
                try { client.close(); } catch {}
            };

            resolve({ client, connection, receiver, cleanup });
        });
    });
};

const launchApp = (receiver, appId) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Launch timeout')), 15000);

        const handler = (data) => {
            if (data.type === 'RECEIVER_STATUS' && data.status?.applications) {
                const app = data.status.applications.find(a => a.appId === appId);
                if (app) {
                    clearTimeout(timer);
                    receiver.removeListener('message', handler);
                    resolve(app);
                }
            }
        };

        receiver.on('message', handler);
        receiver.send({ type: 'LAUNCH', appId, requestId: 1 });
    });
};

const connectToApp = (client, transportId) => {
    const appConnection = client.createChannel('sender-0', transportId, CONNECTION_NS, 'JSON');
    const media = client.createChannel('sender-0', transportId, MEDIA_NS, 'JSON');
    appConnection.send({ type: 'CONNECT' });
    return { media };
};

const loadMedia = (mediaChannel, mediaUrl, contentType, metadata) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Load timeout')), 15000);

        const handler = (data) => {
            if (data.type === 'MEDIA_STATUS' && data.status?.length > 0) {
                clearTimeout(timer);
                mediaChannel.removeListener('message', handler);
                resolve(data.status[0]);
            }
        };

        mediaChannel.on('message', handler);
        mediaChannel.send({
            type: 'LOAD',
            requestId: 2,
            media: {
                contentId: mediaUrl,
                contentType,
                streamType: contentType === 'audio/mpeg' ? 'LIVE' : 'BUFFERED',
                metadata: {
                    type: 0,
                    metadataType: 0,
                    title: metadata?.title || 'MyHue Cast',
                    subtitle: metadata?.subtitle || '',
                    ...(metadata?.thumbnail ? { images: [{ url: metadata.thumbnail }] } : {}),
                },
            },
            autoplay: true,
        });
    });
};

// --- Public API ---

export const castMedia = async (deviceId, mediaUrl, contentType = 'audio/mpeg', metadata = {}) => {
    const { device, conn: { client, receiver, cleanup } } = await connectDevice(deviceId);

    try {
        const app = await launchApp(receiver, DEFAULT_MEDIA_RECEIVER_APP_ID);
        const { media } = connectToApp(client, app.transportId);
        await loadMedia(media, mediaUrl, contentType, metadata);
        const receiverStatus = await readReceiverStatus(receiver).catch(() => null);
        nowPlaying = {
            deviceId: device.id,
            device: device.name,
            title: metadata?.title || 'Lecture',
            subtitle: metadata?.subtitle || '',
            thumbnail: metadata?.thumbnail || null,
            paused: false,
            volume: volumePct(receiverStatus),
            since: Date.now(),
        };

        // Don't close immediately - let it play
        setTimeout(() => cleanup(), 2000);

        return { device: device.name, status: 'playing', mediaUrl };
    } catch (err) {
        cleanup();
        throw err;
    }
};

// Titre, chaîne et vignette d'une vidéo, sans clé d'API (oEmbed) ; à défaut « YouTube »
const youtubeInfo = async (videoId) => {
    try {
        const page = `https://www.youtube.com/watch?v=${videoId}`;
        const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`oEmbed ${res.status}`);
        const { title, author_name: subtitle, thumbnail_url: thumbnail } = await res.json();
        return { title, subtitle, thumbnail };
    } catch {
        return { title: 'YouTube' };
    }
};

export const castYouTube = async (deviceId, videoId, serverProxyUrl) => {
    if (!serverProxyUrl) {
        throw new Error('Server proxy URL required for YouTube casting');
    }
    return castMedia(deviceId, serverProxyUrl, 'audio/mp4', await youtubeInfo(videoId));
};

export const controlPlayback = async (deviceId, command) => {
    const { device, conn: { client, receiver, cleanup } } = await connectDevice(deviceId);

    try {
        // Get current app status
        const status = await readReceiverStatus(receiver);

        if (!status.applications || status.applications.length === 0) {
            if (nowPlaying?.deviceId === device.id) nowPlaying = null;
            throw new Error('No active session');
        }

        const app = status.applications[0];
        const { media } = connectToApp(client, app.transportId);

        // Get media session ID
        const mediaStatus = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Media status timeout')), 5000);
            const handler = (data) => {
                if (data.type === 'MEDIA_STATUS') {
                    clearTimeout(timer);
                    media.removeListener('message', handler);
                    resolve(data.status?.[0] || null);
                }
            };
            media.on('message', handler);
            media.send({ type: 'GET_STATUS', requestId: 4 });
        });

        if (!mediaStatus) throw new Error('No active media');

        const mediaSessionId = mediaStatus.mediaSessionId;
        const typeMap = { play: 'PLAY', pause: 'PAUSE', stop: 'STOP' };
        const castCommand = typeMap[command];
        if (!castCommand) throw new Error(`Unknown command: ${command}`);

        media.send({
            type: castCommand,
            requestId: 5,
            mediaSessionId,
        });

        if (nowPlaying?.deviceId === device.id) {
            if (command === 'stop') nowPlaying = null;
            else nowPlaying.paused = command === 'pause';
        }

        setTimeout(() => cleanup(), 1000);
        return { device: device.name, command, status: 'ok' };
    } catch (err) {
        cleanup();
        throw err;
    }
};

export const setVolume = async (deviceId, level) => {
    const volume = Math.max(0, Math.min(1, level));
    const { device, conn: { receiver, cleanup } } = await connectDevice(deviceId);

    try {
        receiver.send({
            type: 'SET_VOLUME',
            volume: { level: volume },
            requestId: 6,
        });

        if (nowPlaying?.deviceId === device.id) nowPlaying.volume = Math.round(volume * 100);

        setTimeout(() => cleanup(), 1000);
        return { device: device.name, volume };
    } catch (err) {
        cleanup();
        throw err;
    }
};

startDiscovery();
setTimeout(() => refreshDevices({ force: true }), 3000);
setInterval(() => refreshDevices(), 2 * 60_000).unref?.();
setInterval(() => syncNowPlaying(), 30_000).unref?.();
