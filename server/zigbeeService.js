/**
 * Zigbee Service - Sonoff USB Dongle (COM3)
 * Architecture: aedes (broker MQTT embarqué) + zigbee2mqtt (subprocess)
 */

import { createServer } from 'net';
import { spawn, execFile } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import mqtt from 'mqtt';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MQTT_PORT = 1883;
const Z2M_DATA = resolve(__dirname, 'data/z2m');
const Z2M_BIN = resolve(__dirname, '../node_modules/zigbee2mqtt/index.js');
const ZIGBEE_PORT = process.env.ZIGBEE_PORT || 'COM3';
const BOOTLOADER_EXIT_SCRIPT = resolve(
    __dirname,
    '../scripts/exit-bootloader.py',
);

// Python executable paths to try (Windows + Linux/Mac)
const PYTHON_CANDIDATES = [
    'C:\\Users\\mp041\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'python3',
    'python',
];

let mqttServer = null; // net.Server
let z2mProcess = null; // child process
let mqttClient = null; // mqtt subscriber client
let running = false;

// devices[friendlyName] = { friendlyName, ieeeAddr, model, state, lastSeen }
const devices = {};

// history[friendlyName] = [{ ts, temperature, humidity, pressure, battery }, ...]
const history = {};
const MAX_HISTORY_POINTS = 500; // ~24h at 5min intervals
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

/** Try to exit the Gecko bootloader before z2m connects to the NCP. */
async function exitBootloaderIfNeeded() {
    return new Promise((res) => {
        // Find a working Python binary
        let pythonBin = null;
        for (const candidate of PYTHON_CANDIDATES) {
            // For absolute paths, check existence; for shell commands, just try
            if (candidate.includes('\\') || candidate.includes('/')) {
                if (existsSync(candidate)) {
                    pythonBin = candidate;
                    break;
                }
            } else {
                pythonBin = candidate;
                break;
            }
        }
        if (!pythonBin) {
            console.warn(
                '[Zigbee] Python not found, skipping bootloader check',
            );
            return res();
        }

        console.log(
            `[Zigbee] Checking NCP bootloader state on ${ZIGBEE_PORT}...`,
        );
        const proc = execFile(
            pythonBin,
            [BOOTLOADER_EXIT_SCRIPT, ZIGBEE_PORT],
            {
                timeout: 8000,
            },
            (err, stdout, stderr) => {
                if (stdout) process.stdout.write(stdout);
                if (stderr) process.stderr.write(stderr);
                if (err && err.code !== 0) {
                    console.warn(
                        '[Zigbee] Bootloader exit returned non-zero, continuing anyway...',
                    );
                }
                // Give the NCP a moment to stabilise after bootloader exit
                setTimeout(res, 800);
            },
        );
        proc.on('error', (e) => {
            console.warn(
                '[Zigbee] Could not run bootloader script:',
                e.message,
            );
            res();
        });
    });
}

export async function start() {
    if (running) return;

    console.log('[Zigbee] Démarrage broker MQTT + zigbee2mqtt...');

    // 0. Exit NCP bootloader if it got stuck (common with Sonoff dongle on Windows)
    await exitBootloaderIfNeeded();

    // 1. Démarrer le broker MQTT (aedes)
    await startMqttBroker();

    // 2. Lancer zigbee2mqtt comme subprocess
    await startZ2mProcess();

    // 3. S'abonner aux topics zigbee2mqtt
    await subscribeToZ2m();

    running = true;
    console.log('[Zigbee] Service démarré');
}

async function startMqttBroker() {
    const { Aedes } = await import('aedes');
    const aedes = await Aedes.createBroker();
    return new Promise((res, rej) => {
        mqttServer = createServer(aedes.handle);
        mqttServer.listen(MQTT_PORT, '127.0.0.1', () => {
            console.log(`[Zigbee] Broker MQTT sur port ${MQTT_PORT}`);
            res();
        });
        mqttServer.on('error', rej);
    });
}

function startZ2mProcess() {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            ZIGBEE2MQTT_DATA: Z2M_DATA,
        };

        z2mProcess = spawn('node', [Z2M_BIN], {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let resolved = false;

        z2mProcess.stdout.on('data', (data) => {
            const msg = data.toString().trim();
            if (
                msg.includes('Zigbee2MQTT started') ||
                msg.includes('Started')
            ) {
                console.log('[Zigbee] zigbee2mqtt démarré');
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            }
            if (msg.length > 0 && process.env.ZIGBEE_DEBUG) {
                console.log('[z2m]', msg);
            }
        });

        z2mProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.length > 0) console.error('[z2m error]', msg);
        });

        z2mProcess.on('exit', (code) => {
            running = false;
            console.warn(`[Zigbee] zigbee2mqtt s'est arrêté (code: ${code})`);
        });

        z2mProcess.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });

        // Résoudre après 12s même si le message "started" n'arrive pas
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }, 12000);
    });
}

function subscribeToZ2m() {
    return new Promise((resolve) => {
        mqttClient = mqtt.connect(`mqtt://localhost:${MQTT_PORT}`);

        mqttClient.on('connect', () => {
            console.log('[Zigbee] Client MQTT connecté');
            mqttClient.subscribe('zigbee2mqtt/#');
            resolve();
        });

        mqttClient.on('message', (topic, payload) => {
            try {
                const msg = JSON.parse(payload.toString());
                const parts = topic.split('/');

                // zigbee2mqtt/bridge/devices -> liste des appareils
                if (topic === 'zigbee2mqtt/bridge/devices') {
                    for (const d of msg) {
                        if (d.type === 'Coordinator') continue;
                        const name = d.friendly_name;
                        if (!devices[name]) devices[name] = {};
                        devices[name].friendlyName = name;
                        devices[name].ieeeAddr = d.ieee_address;
                        devices[name].model = d.definition?.model || d.model_id;
                        devices[name].description = d.definition?.description;
                        devices[name].vendor = d.definition?.vendor;
                        devices[name].available = d.supported !== false;
                        if (!devices[name].state) devices[name].state = {};
                    }
                    console.log(
                        `[Zigbee] ${Object.keys(devices).length} appareil(s) connu(s)`,
                    );
                    return;
                }

                // zigbee2mqtt/<device> -> données du capteur
                if (
                    parts.length === 2 &&
                    parts[0] === 'zigbee2mqtt' &&
                    parts[1] !== 'bridge'
                ) {
                    const name = parts[1];
                    if (!devices[name])
                        devices[name] = { friendlyName: name, state: {} };
                    devices[name].state = { ...devices[name].state, ...msg };
                    devices[name].lastSeen = Date.now();

                    // Historique : on enregistre si données de mesure présentes
                    const HAS_MEASURE = [
                        'temperature',
                        'humidity',
                        'pressure',
                        'battery',
                    ];
                    if (HAS_MEASURE.some((k) => k in msg)) {
                        if (!history[name]) history[name] = [];
                        const now = Date.now();
                        history[name].push({
                            ts: now,
                            temperature:
                                devices[name].state.temperature ?? null,
                            humidity: devices[name].state.humidity ?? null,
                            pressure: devices[name].state.pressure ?? null,
                            battery: devices[name].state.battery ?? null,
                        });
                        // Purge: garder seulement les 24 dernières heures
                        const cutoff = now - HISTORY_TTL_MS;
                        history[name] = history[name].filter(
                            (p) => p.ts >= cutoff,
                        );
                        // Limiter le nombre de points
                        if (history[name].length > MAX_HISTORY_POINTS) {
                            history[name] =
                                history[name].slice(-MAX_HISTORY_POINTS);
                        }
                    }

                    const relevant = Object.entries(msg)
                        .filter(([k]) =>
                            [
                                'temperature',
                                'humidity',
                                'battery',
                                'occupancy',
                                'contact',
                                'illuminance',
                            ].includes(k),
                        )
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ');
                    if (relevant) {
                        console.log(`[Zigbee] ${name}: ${relevant}`);
                    }
                }
            } catch {
                /* JSON non parsable */
            }
        });

        mqttClient.on('error', (err) => {
            console.error('[Zigbee] MQTT client erreur:', err.message);
        });
    });
}

export async function stop() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
    }
    if (z2mProcess) {
        z2mProcess.kill();
        z2mProcess = null;
    }
    if (mqttServer) {
        mqttServer.close();
        mqttServer = null;
    }
    running = false;
    console.log('[Zigbee] Service arrêté');
}

// ── API publique ──────────────────────────────────────────────────────────────

export function getDevices() {
    return Object.values(devices);
}

export function getDevice(name) {
    return devices[name] || null;
}

export function getTemperatureSensors() {
    return Object.values(devices).filter(
        (d) => d.state && 'temperature' in d.state,
    );
}

/**
 * Retourne l'historique des 24 dernières heures pour un capteur.
 * @param {string} nameOrIeee - friendly name ou adresse IEEE
 */
export function getHistory(nameOrIeee) {
    // cherche par friendly name en premier
    if (history[nameOrIeee]) return history[nameOrIeee];
    // cherche par adresse IEEE
    const device = Object.values(devices).find(
        (d) => d.ieeeAddr === nameOrIeee,
    );
    if (device && history[device.friendlyName]) {
        return history[device.friendlyName];
    }
    return [];
}

export async function permitJoin(seconds = 60) {
    if (!mqttClient) throw new Error('Service non démarré');
    mqttClient.publish(
        'zigbee2mqtt/bridge/request/permit_join',
        JSON.stringify({ value: true, time: seconds }),
    );
    console.log(`[Zigbee] Appairage autorisé pendant ${seconds}s`);
}

export async function disallowJoin() {
    if (!mqttClient) throw new Error('Service non démarré');
    mqttClient.publish(
        'zigbee2mqtt/bridge/request/permit_join',
        JSON.stringify({ value: false }),
    );
    console.log('[Zigbee] Appairage désactivé');
}

export function isRunning() {
    return running;
}
