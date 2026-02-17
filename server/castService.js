import { Client } from 'castv2';
import mdns from 'mdns-js';
import dotenv from 'dotenv';

dotenv.config();

let discoveredDevices = new Map();
let browser = null;

const MEDIA_NS = 'urn:x-cast:com.google.cast.media';
const RECEIVER_NS = 'urn:x-cast:com.google.cast.receiver';
const CONNECTION_NS = 'urn:x-cast:com.google.cast.tp.connection';
const HEARTBEAT_NS = 'urn:x-cast:com.google.cast.tp.heartbeat';
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

// --- Device management ---

const loadManualDevices = () => {
    const manualConfig = process.env.CAST_DEVICES;
    if (manualConfig) {
        const devices = manualConfig.split(',');
        devices.forEach(device => {
            const [name, host] = device.split(':').map(s => s.trim());
            if (name && host) {
                const deviceInfo = { name, host, port: 8009, id: host, manual: true };
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
                    const info = {
                        name: device.fullname || device.txt?.fn || 'Unknown',
                        host: ipv4,
                        port: device.port || 8009,
                        id: device.txt?.id || ipv4,
                    };
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
                streamType: 'LIVE',
                metadata: {
                    type: 0,
                    metadataType: 0,
                    title: metadata?.title || 'MyHue Cast',
                    subtitle: metadata?.subtitle || '',
                },
            },
            autoplay: true,
        });
    });
};

// --- Public API ---

export const castMedia = async (deviceId, mediaUrl, contentType = 'audio/mpeg', metadata = {}) => {
    const device = discoveredDevices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const { client, receiver, cleanup } = await createCastConnection(device.host);

    try {
        const app = await launchApp(receiver, DEFAULT_MEDIA_RECEIVER_APP_ID);
        const { media } = connectToApp(client, app.transportId);
        const status = await loadMedia(media, mediaUrl, contentType, metadata);

        // Don't close immediately - let it play
        setTimeout(() => cleanup(), 2000);

        return { device: device.name, status: 'playing', mediaUrl };
    } catch (err) {
        cleanup();
        throw err;
    }
};

export const castYouTube = async (deviceId, videoId) => {
    // YouTube videos must use the web player URL as a media source
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return castMedia(deviceId, url, 'video/mp4', {
        title: 'YouTube',
        subtitle: videoId,
    });
};

export const controlPlayback = async (deviceId, command) => {
    const device = discoveredDevices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const { client, receiver, cleanup } = await createCastConnection(device.host);

    try {
        // Get current app status
        const status = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Status timeout')), 5000);
            const handler = (data) => {
                if (data.type === 'RECEIVER_STATUS') {
                    clearTimeout(timer);
                    receiver.removeListener('message', handler);
                    resolve(data.status);
                }
            };
            receiver.on('message', handler);
            receiver.send({ type: 'GET_STATUS', requestId: 3 });
        });

        if (!status.applications || status.applications.length === 0) {
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

        setTimeout(() => cleanup(), 1000);
        return { device: device.name, command, status: 'ok' };
    } catch (err) {
        cleanup();
        throw err;
    }
};

export const setVolume = async (deviceId, level) => {
    const device = discoveredDevices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const volume = Math.max(0, Math.min(1, level));
    const { receiver, cleanup } = await createCastConnection(device.host);

    try {
        receiver.send({
            type: 'SET_VOLUME',
            volume: { level: volume },
            requestId: 6,
        });

        setTimeout(() => cleanup(), 1000);
        return { device: device.name, volume };
    } catch (err) {
        cleanup();
        throw err;
    }
};

startDiscovery();
