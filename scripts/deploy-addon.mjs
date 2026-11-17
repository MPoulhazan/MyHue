// Met à jour l'add-on MyHue sur Home Assistant (Supervisor, via l'API WebSocket de HA).
// Usage : node scripts/deploy-addon.mjs   (lit HA_TOKEN dans .env ; pousser sur master d'abord)
import { readFileSync } from 'fs';

const ADDON = 'f9d59efd_myhue';
const HA_WS = process.env.HA_WS || 'ws://192.168.0.17/api/websocket';

const env = Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.HA_TOKEN) throw new Error('HA_TOKEN manquant dans .env');

const ws = new WebSocket(HA_WS);
let nextId = 1;
const pending = new Map();
const call = (endpoint, method = 'post') =>
    new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, type: 'supervisor/api', endpoint, method, timeout: 900 }));
    });
const info = async () => {
    const r = await call(`/addons/${ADDON}/info`, 'get');
    return { version: r.result?.version, latest: r.result?.version_latest, state: r.result?.state };
};

ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: env.HA_TOKEN }));
    if (m.type === 'auth_invalid') {
        console.error('Jeton HA refusé');
        process.exit(1);
    }
    if (m.type === 'auth_ok') {
        const reload = await call('/store/reload');
        if (!reload.success) console.warn('store/reload:', reload.error?.message);
        const before = await info();
        console.log('Avant :', before);
        if (before.version === before.latest) {
            console.log('Déjà à jour.');
            return ws.close();
        }
        const up = await call(`/store/addons/${ADDON}/update`);
        console.log('Mise à jour :', up.success ? 'ok' : up.error?.message);
        console.log('Après :', await info());
        return ws.close();
    }
    if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
    }
};
ws.onerror = (e) => {
    console.error('WebSocket HA :', e.message || e);
    process.exit(1);
};
