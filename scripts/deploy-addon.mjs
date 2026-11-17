// Met à jour l'add-on MyHue sur Home Assistant : recharge la boutique puis installe la dernière version.
// Usage : node scripts/deploy-addon.mjs   (lit HA_TOKEN et HA_WS_URL dans .env, n'affiche jamais le jeton)
import { readFileSync } from 'fs';

const env = Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^\s*[A-Z_]+\s*=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
if (!env.HA_TOKEN) {
    console.error('HA_TOKEN absent du .env');
    process.exit(1);
}

const ADDON = 'f9d59efd_myhue';
const steps = [
    ['Rechargement de la boutique', { endpoint: '/store/reload', method: 'post' }],
    ['Mise à jour de l’add-on', { endpoint: `/store/addons/${ADDON}/update`, method: 'post', timeout: 900 }],
    ['Version installée', { endpoint: `/addons/${ADDON}/info`, method: 'get' }],
];

const ws = new WebSocket(env.HA_WS_URL || 'ws://192.168.0.17/api/websocket');
let id = 0;
let current = null;
const next = () => {
    current = steps.shift();
    if (!current) return ws.close();
    ws.send(JSON.stringify({ id: ++id, type: 'supervisor/api', ...current[1] }));
};
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: env.HA_TOKEN }));
    if (m.type === 'auth_invalid') {
        console.error('Jeton HA refusé');
        process.exitCode = 1;
        return ws.close();
    }
    if (m.type === 'auth_ok') return next();
    if (m.type !== 'result') return;
    if (!m.success) {
        console.error(`${current[0]} : échec`, JSON.stringify(m.error));
        process.exitCode = 1;
        return ws.close();
    }
    if (current[1].endpoint.endsWith('/info')) console.log(`${current[0]} : ${m.result?.version} (dernière : ${m.result?.version_latest}, état : ${m.result?.state})`);
    else console.log(`${current[0]} : ok`);
    next();
};
ws.onerror = () => {
    console.error('Home Assistant injoignable');
    process.exitCode = 1;
};
