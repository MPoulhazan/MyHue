/**
 * Zigbee Service : client MQTT de zigbee2mqtt (add-on Home Assistant, broker Mosquitto).
 * Config : ZIGBEE_MQTT_URL=mqtt://127.0.0.1:1883, ZIGBEE_MQTT_USER, ZIGBEE_MQTT_PASS
 */

import 'dotenv/config';
import { EventEmitter } from 'events';
import mqtt from 'mqtt';

export const emitter = new EventEmitter();

const MQTT_URL = process.env.ZIGBEE_MQTT_URL || null;
const MQTT_USER = process.env.ZIGBEE_MQTT_USER || undefined;
const MQTT_PASS = process.env.ZIGBEE_MQTT_PASS || undefined;

let mqttClient = null;
let running = false;

// devices[friendlyName] = { friendlyName, ieeeAddr, model, state, lastSeen }
const devices = {};

// Dernier événement de join pour feedback UI
let lastJoinEvent = null; // { ieee, friendlyName, ts }
let permitJoinActive = false;

// history[friendlyName] = [{ ts, temperature, humidity, pressure, battery }, ...]
const history = {};
const MAX_HISTORY_POINTS = 500; // ~24h at 5min intervals
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

export async function start() {
    if (mqttClient) return;
    if (!MQTT_URL) {
        console.warn('[Zigbee] ZIGBEE_MQTT_URL absent : capteurs désactivés');
        return;
    }
    console.log(`[Zigbee] Connexion à ${MQTT_URL}`);
    await subscribeToZ2m();
}

function subscribeToZ2m() {
    return new Promise((resolve) => {
        mqttClient = mqtt.connect(MQTT_URL, {
            username: MQTT_USER,
            password: MQTT_PASS,
            reconnectPeriod: 5000,
        });

        mqttClient.on('connect', () => {
            console.log('[Zigbee] Client MQTT connecté');
            running = true;
            mqttClient.subscribe('zigbee2mqtt/#');
            resolve();
        });

        mqttClient.on('close', () => {
            running = false;
        });

        mqttClient.on('message', (topic, payload) => {
            try {
                const msg = JSON.parse(payload.toString());
                const parts = topic.split('/');

                // zigbee2mqtt/bridge/devices -> liste complète des appareils
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

                // zigbee2mqtt/bridge/event -> détection immédiate d'un join
                if (topic === 'zigbee2mqtt/bridge/event') {
                    if (msg.type === 'device_joined' || msg.type === 'device_announce') {
                        const ieee = msg.data?.ieee_address || msg.data?.friendly_name;
                        const name = msg.data?.friendly_name || ieee;
                        if (ieee) {
                            if (!devices[name]) devices[name] = { friendlyName: name, state: {} };
                            devices[name].ieeeAddr = ieee;
                            devices[name].lastSeen = Date.now();
                            lastJoinEvent = { ieee, friendlyName: name, ts: Date.now() };
                            console.log(`[Zigbee] Nouvel appareil joint: ${name} (${ieee})`);
                        }
                    }
                    if (msg.type === 'device_leave') {
                        const name = msg.data?.friendly_name;
                        if (name && devices[name]) {
                            devices[name].available = false;
                        }
                    }
                    return;
                }

                // zigbee2mqtt/bridge/response/permit_join -> confirmation z2m
                if (topic === 'zigbee2mqtt/bridge/response/permit_join') {
                    permitJoinActive = msg.data?.value === true;
                    console.log(`[Zigbee] Permit join: ${permitJoinActive ? 'actif' : 'inactif'}`);
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
                    emitter.emit('update', name);

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

export async function setFriendlyName(fromName, toName) {
    if (!mqttClient) throw new Error('Service non démarré');
    // Mettre à jour le cache local immédiatement
    if (devices[fromName]) {
        devices[toName] = { ...devices[fromName], friendlyName: toName };
        if (history[fromName]) {
            history[toName] = history[fromName];
            delete history[fromName];
        }
        delete devices[fromName];
    }
    // Envoyer la demande de renommage à zigbee2mqtt
    mqttClient.publish(
        'zigbee2mqtt/bridge/request/device/rename',
        JSON.stringify({ from: fromName, to: toName }),
    );
    console.log(`[Zigbee] Renommage: "${fromName}" → "${toName}"`);
}

export async function addInstallCode(code) {
    if (!mqttClient) throw new Error('Service non démarré');
    mqttClient.publish(
        'zigbee2mqtt/bridge/request/install_code/add',
        JSON.stringify({ value: code }),
    );
    console.log(`[Zigbee] Install code soumis: ${code.substring(0, 20)}...`);
}

export function isRunning() {
    return running;
}

export function getLastJoinEvent() {
    return lastJoinEvent;
}

export function isPermitJoinActive() {
    return permitJoinActive;
}
