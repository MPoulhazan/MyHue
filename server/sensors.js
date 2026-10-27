/**
 * Vue unifiée des capteurs : registre manuel (sensors.json) + état Zigbee en direct,
 * complétée par Home Assistant (état au démarrage, historique long, météo extérieure).
 */
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as haService from './haService.js';

export const getSensors = async () => {
    const devices = zigbeeService.getDevices();
    const registry = sensorRegistry.getAll();
    return registry.map((entry) => {
        const device = devices.find((d) => d.ieeeAddr === entry.ieee) || null;
        const state = device?.state || {};
        return {
            did: entry.ieee,
            name: entry.name,
            model: device?.model || 'Zigbee',
            type: entry.type,
            icon: entry.icon || '📡',
            isOnline: device ? device.available !== false : false,
            mac: entry.ieee,
            zigbeeName: device?.friendlyName || entry.ieee,
            props: {
                temperature: state.temperature ?? null,
                humidity: state.humidity ?? null,
                pressure: state.pressure ?? null,
                battery: state.battery ?? null,
                isOpen: 'contact' in state ? !state.contact : null,
                lastMotion: state.occupancy ? new Date().toISOString() : null,
                lastOpen: null,
            },
            lastUpdated: device?.lastSeen ? new Date(device.lastSeen).toISOString() : null,
            source: 'zigbee',
        };
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
        // Nombre de points bruts par entité : diagnostic quand la fusion revient vide
        const raw = { keys: Object.keys(series), ...Object.fromEntries(ids.map((id) => [id, series[id]?.length ?? 0])) };
        return points.length ? { source: 'ha', points } : { source: 'ha', points, raw };
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
    if (Date.now() - weatherCache.at < 10 * 60 * 1000) return weatherCache.value;
    try {
        weatherCache = { at: Date.now(), value: await haService.getWeather() };
    } catch (err) {
        console.warn('[Sensors] Météo HA indisponible:', err.message);
    }
    return weatherCache.value;
};
