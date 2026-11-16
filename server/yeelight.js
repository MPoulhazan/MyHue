/**
 * Ampoules Yeelight en direct sur le réseau local (protocole LAN, TCP 55443).
 * Il faut activer « Contrôle LAN » dans l'appli Yeelight, sinon l'ampoule ne répond pas.
 *
 * Découverte : annonce SSDP (multicast 239.255.255.250:1982), puis balayage du port 55443
 * sur le sous-réseau si l'annonce ne revient pas (pare-feu, multicast filtré).
 */
import dgram from 'dgram';
import net from 'net';
import { networkInterfaces } from 'os';

const MCAST = '239.255.255.250';
const PORT = 1982;
const CTRL_PORT = 55443;

/** Analyse une réponse ou une annonce SSDP Yeelight. */
export const parseAdvert = (text) => {
    const h = {};
    for (const line of text.split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const loc = /yeelight:\/\/([\d.]+):(\d+)/.exec(h.location || '');
    if (!loc || !h.id) return null;
    return { id: h.id, ip: loc[1], port: Number(loc[2]), model: h.model || null, name: h.name || null, power: h.power || null };
};

/** Cherche les ampoules par SSDP pendant `ms`. */
export const discover = (ms = 3000) =>
    new Promise((resolve) => {
        const found = new Map();
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${MCAST}:${PORT}\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n`);
        sock.on('message', (m) => {
            const b = parseAdvert(m.toString());
            if (b) found.set(b.id, b);
        });
        sock.on('error', () => {});
        sock.bind(() => {
            for (let i = 0; i < 3; i++) setTimeout(() => sock.send(msg, PORT, MCAST, () => {}), i * 600);
        });
        setTimeout(() => {
            try {
                sock.close();
            } catch {}
            resolve([...found.values()]);
        }, ms);
    });

const localSubnets = () =>
    Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address))
        .map((i) => i.address.split('.').slice(0, 3).join('.'));

/** Plan B : IP du réseau local qui ont le port de contrôle Yeelight ouvert. */
export const scan = async () => {
    const hits = [];
    for (const net24 of [...new Set(localSubnets())]) {
        await Promise.all(
            Array.from({ length: 254 }, (_, i) => `${net24}.${i + 1}`).map(
                (ip) =>
                    new Promise((res) => {
                        const c = net.connect({ host: ip, port: CTRL_PORT, timeout: 1200 });
                        c.on('connect', () => {
                            hits.push(ip);
                            c.destroy();
                            res();
                        });
                        c.on('timeout', () => {
                            c.destroy();
                            res();
                        });
                        c.on('error', res);
                    }),
            ),
        );
    }
    return hits;
};

let nextId = 1;
/** Envoie une commande et attend la réponse ({ result } ou erreur). */
export const command = (ip, method, params = [], timeoutMs = 3000) =>
    new Promise((resolve, reject) => {
        const id = nextId++;
        const sock = net.connect({ host: ip, port: CTRL_PORT });
        let buf = '';
        const done = (err, val) => {
            clearTimeout(timer);
            sock.destroy();
            err ? reject(err) : resolve(val);
        };
        const timer = setTimeout(() => done(new Error(`Yeelight ${ip} ne répond pas`)), timeoutMs);
        sock.on('connect', () => sock.write(JSON.stringify({ id, method, params }) + '\r\n'));
        sock.on('data', (d) => {
            buf += d.toString();
            for (const line of buf.split('\r\n')) {
                if (!line.trim()) continue;
                let msg;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                if (msg.id !== id) continue; // notifications « props » de l'ampoule
                if (msg.error) return done(new Error(`Yeelight: ${msg.error.message}`));
                return done(null, msg.result);
            }
        });
        sock.on('error', (err) => done(err));
    });

export const getProps = async (ip, props = ['power', 'bright', 'ct', 'color_mode', 'name']) => {
    const values = await command(ip, 'get_prop', props);
    return Object.fromEntries(props.map((p, i) => [p, values[i]]));
};

/** Allume directement en blanc (ct en kelvins, bright 1-100) : une seule commande, pas de flash. */
export const setWhite = (ip, ct, bright) => command(ip, 'set_scene', ['ct', ct, bright]);

/** Allume en couleur (rgb 0xRRGGBB). */
export const setColor = (ip, rgb, bright) => command(ip, 'set_scene', ['color', rgb, bright]);

export const setPower = (ip, on, durationMs = 500) => command(ip, 'set_power', [on ? 'on' : 'off', 'smooth', durationMs]);
