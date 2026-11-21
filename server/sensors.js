/**
 * Vue unifiée des capteurs : registre manuel (sensors.json) + état Zigbee en direct,
 * complétée par Home Assistant (état au démarrage, historique long, météo extérieure).
 */
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as sensorPause from './sensorPause.js';
import * as haService from './haService.js';
import { roleOf } from './sensorRoles.js';
import { localOutdoor } from './outdoorLogic.js';
import * as journal from './journal.js';

// Dernier mouvement vu par capteur (ieee -> ms) : messages « occupancy: true », repris de HA au démarrage
const motionAt = new Map();
zigbeeService.emitter.on('update', (name) => {
    const d = zigbeeService.getDevice(name);
    if (d?.state?.occupancy === true && Date.now() - (d.lastSeen || 0) < 5000) motionAt.set(d.ieeeAddr, Date.now());
});

/** Portes et boîtes : dernier changement d'état et dernière ouverture, d'après le journal (persisté). */
const contactTimes = () => {
    const out = new Map();
    for (const e of journal.list({ limit: 2000, kind: 'door' })) {
        const did = e.data?.did;
        if (!did) continue;
        const t = out.get(did) || { changedAt: null, lastOpen: null };
        t.changedAt ??= e.ts;
        if (e.data.isOpen && t.lastOpen == null) t.lastOpen = e.ts;
        out.set(did, t);
    }
    return out;
};
const iso = (ts) => (ts ? new Date(ts).toISOString() : null);

export const getSensors = async () => {
    const devices = zigbeeService.getDevices();
    const registry = sensorRegistry.getAll();
    const contacts = contactTimes();
    return registry.map((entry) => {
        const device = devices.find((d) => d.ieeeAddr === entry.ieee) || null;
        const state = device?.state || {};
        const sensor = {
            did: entry.ieee,
            name: entry.name,
            model: device?.model || 'Zigbee',
            type: entry.type,
            icon: entry.icon || '📡',
            room: entry.room || null,
            outside: Boolean(entry.outside),
            pausedUntil: sensorPause.isPaused(entry.ieee) ? sensorPause.get(entry.ieee).until ?? 'forever' : null,
            isOnline: device ? device.available !== false : false,
            mac: entry.ieee,
            zigbeeName: device?.friendlyName || entry.ieee,
            props: {
                temperature: state.temperature ?? null,
                humidity: state.humidity ?? null,
                pressure: state.pressure ?? null,
                battery: state.battery ?? null,
                isOpen: 'contact' in state ? !state.contact : null,
                leak: 'water_leak' in state ? Boolean(state.water_leak) : null,
                smoke: 'smoke' in state ? Boolean(state.smoke) : null,
                lastMotion: iso(motionAt.get(entry.ieee)),
                lastOpen: iso(contacts.get(entry.ieee)?.lastOpen),
            },
            // Porte ou boîte : depuis quand elle est dans son état actuel (journal)
            stateSince: 'contact' in state ? iso(contacts.get(entry.ieee)?.changedAt) : null,
            lastUpdated: device?.lastSeen ? new Date(device.lastSeen).toISOString() : null,
            source: 'zigbee',
        };
        // indoor / outdoor (balcon) / stove (hotte) ; null pour ce qui n'est pas un thermomètre
        sensor.role = roleOf({ ...sensor, role: entry.role });
        return sensor;
    });
};

// --- Lien Zigbee ↔ entités Home Assistant (découverte MQTT de zigbee2mqtt) ---

// HA nomme les entités d'après le friendly name z2m : sensor.<slug>_<propriété>
const slugify = (name) =>
    name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

const MEASURES = ['temperature', 'humidity', 'pressure', 'battery'];
const UNKNOWN = new Set(['unknown', 'unavailable', '']);

/** Convertit l'état d'une entité HA en propriété zigbee2mqtt. */
const toZ2mValue = (prop, state) => {
    if (UNKNOWN.has(state)) return undefined;
    // binary_sensor porte : 'on' = ouverte, alors que contact=true = fermée
    if (prop === 'contact') return state === 'off';
    if (prop === 'occupancy' || prop === 'water_leak' || prop === 'smoke') return state === 'on';
    const n = Number(state);
    return isNaN(n) ? state : n;
};

/**
 * Au démarrage, zigbee2mqtt ne renvoie pas l'état des capteurs sur batterie :
 * on le reprend de Home Assistant, sinon il reste vide jusqu'au prochain envoi (jusqu'à 1 h).
 */
export const seedFromHomeAssistant = async () => {
    if (!haService.isConfigured()) return;
    try {
        const states = await haService.getStates();
        let seeded = 0;
        for (const device of zigbeeService.getDevices()) {
            const prefix = slugify(device.friendlyName);
            const state = {};
            let lastSeen = 0;
            for (const e of states) {
                const m = e.entity_id.match(/^(sensor|binary_sensor)\.(.+)$/);
                if (!m || !m[2].startsWith(`${prefix}_`)) continue;
                const prop = m[2].slice(prefix.length + 1);
                const value = toZ2mValue(prop, e.state);
                if (value === undefined) continue;
                state[prop] = value;
                if (prop === 'occupancy' && !motionAt.has(device.ieeeAddr)) {
                    const ts = Date.parse(e.last_changed);
                    if (ts) motionAt.set(device.ieeeAddr, ts);
                }
                lastSeen = Math.max(lastSeen, Date.parse(e.last_reported || e.last_updated) || 0);
            }
            if (Object.keys(state).length) {
                zigbeeService.seedState(device.friendlyName, state, lastSeen || undefined);
                seeded++;
            }
        }
        console.log(`[Sensors] État de ${seeded} capteur(s) repris de Home Assistant`);
    } catch (err) {
        console.warn('[Sensors] Reprise depuis Home Assistant impossible:', err.message);
    }
};

zigbeeService.emitter.on('devices', seedFromHomeAssistant);

/**
 * Historique d'un capteur : recorder HA (jours/semaines), à défaut les 24 h en mémoire.
 * Renvoie { source: 'ha' | 'memory', points: [{ ts, temperature, humidity, pressure, battery }], error? }.
 */
export const getSensorHistory = async (nameOrIeee, hours = 24) => {
    const device = zigbeeService
        .getDevices()
        .find((d) => d.friendlyName === nameOrIeee || d.ieeeAddr === nameOrIeee);
    const memory = (error) => ({ source: 'memory', points: zigbeeService.getHistory(nameOrIeee), error });
    if (!device) return memory('appareil inconnu');
    if (!haService.isConfigured()) return memory();

    try {
        const prefix = slugify(device.friendlyName);
        const ids = MEASURES.map((p) => `sensor.${prefix}_${p}`);
        const series = await haService.getHistoryMulti(ids, hours);

        // Fusionne les séries sur un axe de temps commun, en reportant la dernière valeur connue
        const events = [];
        MEASURES.forEach((prop, i) => {
            for (const p of series[ids[i]] || []) {
                if (typeof p.value === 'number') events.push({ ts: p.ts, prop, value: p.value });
            }
        });
        events.sort((a, b) => a.ts - b.ts);
        const current = { temperature: null, humidity: null, pressure: null, battery: null };
        const points = [];
        for (const ev of events) {
            current[ev.prop] = ev.value;
            const last = points[points.length - 1];
            if (last && last.ts === ev.ts) Object.assign(last, current);
            else points.push({ ts: ev.ts, ...current });
        }
        return { source: 'ha', points };
    } catch (err) {
        const detail = err.response ? `HTTP ${err.response.status}` : err.message;
        console.warn('[Sensors] Historique HA indisponible:', detail);
        return memory(detail);
    }
};

// --- Météo extérieure (cache 10 min) ---

let weatherCache = { at: 0, value: null };
export const getOutdoorWeather = async () => {
    if (!haService.isConfigured()) return null;
    if (Date.now() - weatherCache.at >= 10 * 60 * 1000) {
        try {
            weatherCache = { at: Date.now(), value: await haService.getWeather() };
        } catch (err) {
            console.warn('[Sensors] Météo HA indisponible:', err.message);
        }
    }
    const weather = weatherCache.value;
    if (!weather) return weather;
    // Sonde du balcon fraîche et plausible : elle remplace la météo pour la température et l'humidité
    const local = localOutdoor(await getSensors(), typeof weather.temperature === 'number' ? weather.temperature : null);
    if (!local) return { ...weather, source: 'météo' };
    return {
        ...weather,
        temperature: local.temperature,
        humidity: local.humidity ?? weather.humidity,
        forecastTemperature: weather.temperature,
        source: 'balcon',
    };
};
