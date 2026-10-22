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

process.on('SIGTERM', () => children.forEach((c) => c.kill('SIGTERM')));
