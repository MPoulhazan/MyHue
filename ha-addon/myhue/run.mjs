// Lanceur de l'add-on : options HA -> variables d'env, puis agentServer + telegramBot
import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const opts = JSON.parse(readFileSync('/data/options.json', 'utf8'));
const token = process.env.SUPERVISOR_TOKEN;

const env = {
    ...process.env,
    AGENT_PORT: '5174',
    AGENT_API_URL: 'http://127.0.0.1:5174',
    MYHUE_DATA_DIR: '/data',
    HA_URL: 'http://supervisor/core',
    HA_TOKEN: token,
    GROQ_API_KEY: opts.groq_api_key,
    GROQ_MODEL: opts.groq_model,
    MYHUE_TOKEN: opts.myhue_token,
    VITE_HUE_BRIDGE_IP: opts.hue_bridge_ip,
    VITE_HUE_USERNAME: opts.hue_username,
    TELEGRAM_BOT_TOKEN: opts.telegram_bot_token,
    TELEGRAM_ALLOWED_USER_IDS: opts.telegram_allowed_user_ids,
    BROADLINK_IP: opts.broadlink_ip,
    CAST_DEVICES: opts.cast_devices,
    YOUTUBE_API_KEY: opts.youtube_api_key,
    YOUTUBE_CLIENT_ID: opts.youtube_client_id,
    YOUTUBE_CLIENT_SECRET: opts.youtube_client_secret,
    YOUTUBE_DEFAULT_PLAYLISTS: opts.youtube_default_playlists,
};

// Identifiants Mosquitto fournis par le Supervisor (add-on Mosquitto installé)
try {
    const res = await fetch('http://supervisor/services/mqtt', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
        const { data } = await res.json();
        // host_network : Mosquitto est joignable sur l'hôte
        env.ZIGBEE_MQTT_URL = `mqtt://127.0.0.1:${data.port}`;
        env.ZIGBEE_MQTT_USER = data.username;
        env.ZIGBEE_MQTT_PASS = data.password;
        console.log('[addon] MQTT Mosquitto détecté');
    } else {
        console.warn('[addon] Mosquitto non disponible, Zigbee désactivé');
        env.ZIGBEE_MQTT_URL = 'mqtt://127.0.0.1:1883';
    }
} catch (err) {
    console.warn('[addon] Lecture service MQTT impossible:', err.message);
    env.ZIGBEE_MQTT_URL = 'mqtt://127.0.0.1:1883';
}

const children = [];
function run(script) {
    const child = spawn('node', [script], { cwd: '/app', env, stdio: 'inherit' });
    // Un process qui tombe arrête l'add-on : le watchdog HA le relance
    child.on('exit', (code) => {
        console.error(`[addon] ${script} arrêté (code ${code})`);
        children.forEach((c) => c.kill());
        process.exit(code || 1);
    });
    children.push(child);
}

run('server/agentServer.js');
if (opts.telegram_bot_token) run('server/telegramBot.js');

// --- Tailscale Funnel : seul /mcp est public, et il passe par le port 5175 où le token est toujours exigé ---
// Une panne de Tailscale ne doit jamais arrêter MyHue : rien ici n'est dans `children`.
const TS_DIR = '/data/tailscale';
const TS_SOCK = '/tmp/tailscaled.sock';
const ts = (...args) =>
    new Promise((resolve) => {
        const p = spawn('tailscale', [`--socket=${TS_SOCK}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('error', (err) => resolve({ code: 1, out: err.message }));
        p.on('exit', (code) => resolve({ code, out: out.trim() }));
    });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startFunnel() {
    const { existsSync, mkdirSync } = await import('fs');
    const loggedIn = existsSync(`${TS_DIR}/tailscaled.state`);
    if (!opts.tailscale_authkey && !loggedIn) return console.log('[tailscale] pas de clé : accès distant désactivé');
    if (!opts.myhue_token) return console.warn('[tailscale] myhue_token vide : /mcp ne serait pas protégé, Funnel non ouvert');
    mkdirSync(TS_DIR, { recursive: true });
    const daemon = spawn('tailscaled', ['--tun=userspace-networking', `--statedir=${TS_DIR}`, `--socket=${TS_SOCK}`], { stdio: 'ignore' });
    daemon.on('exit', (code) => console.error(`[tailscale] tailscaled arrêté (code ${code})`));
    process.on('SIGTERM', () => daemon.kill('SIGTERM'));
    for (let i = 0; i < 30 && !existsSync(TS_SOCK); i++) await sleep(500);

    const up = await ts('up', '--hostname=myhue', '--accept-dns=false', ...(opts.tailscale_authkey ? [`--authkey=${opts.tailscale_authkey}`] : []));
    if (up.code !== 0) return console.error('[tailscale] connexion impossible :', up.out);
    // On repart de zéro à chaque démarrage : aucune autre route ne reste ouverte
    await ts('serve', 'reset');
    const funnel = await ts('funnel', '--bg', '--set-path=/mcp', 'http://127.0.0.1:5175/mcp');
    if (funnel.code !== 0) return console.error('[tailscale] Funnel refusé :', funnel.out);
    const status = await ts('funnel', 'status');
    console.log('[tailscale] Funnel ouvert sur /mcp seulement\n' + status.out);
}
startFunnel().catch((err) => console.error('[tailscale]', err.message));

process.on('SIGTERM', () => children.forEach((c) => c.kill('SIGTERM')));
