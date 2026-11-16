/**
 * Lampe de l'entrée (Yeelight) : s'allume quand la porte d'entrée s'ouvre ou que le
 * capteur de mouvement de l'entrée voit quelqu'un, à toute heure, et s'éteint 2 min
 * après le dernier passage.
 *
 * Elle ne touche pas à une lampe allumée à la main : si l'ampoule était déjà allumée,
 * ou si on l'a réglée entre-temps (luminosité, teinte), elle reste comme elle est.
 * La nuit, lumière douce pour ne pas éblouir.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as yeelight from './yeelight.js';

const FILE = dataFile('entrance-light.json');
const TZ = process.env.TZ || 'America/Toronto';
const RETRY_DISCOVERY_MS = 10 * 60_000;

const DEFAULTS = {
    enabled: true,
    ip: null, // trouvée toute seule (SSDP puis balayage), gardée ici
    bulbId: null,
    offAfterSec: 120,
    nightFrom: '22:30',
    nightTo: '06:30',
    day: { ct: 4000, bright: 100 },
    night: { ct: 2700, bright: 100 },
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ entrance-light.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la lampe de l’entrée impossible:', err.message);
    }
};

// --- Décisions (testées dans entranceLight.test.js) ---

export const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
};

/** Plage qui peut passer minuit (22:30 → 06:30). */
export const inRange = (min, from, to) => {
    const a = toMin(from);
    const b = toMin(to);
    return a <= b ? min >= a && min < b : min >= a || min < b;
};

const localMinutes = (ts) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};

/** Réglage d'allumage selon l'heure. */
export const sceneFor = (ts, cfg = config) => (inRange(localMinutes(ts), cfg.nightFrom, cfg.nightTo) ? { ...cfg.night, mode: 'night' } : { ...cfg.day, mode: 'day' });

/** La lampe est-elle encore telle qu'on l'a laissée ? Sinon quelqu'un l'a prise en main. */
export const untouched = (props, scene) =>
    props.power === 'on' &&
    Number(props.bright) === scene.bright &&
    !['1', '3'].includes(String(props.color_mode)) && // passée en couleur
    (String(props.color_mode) !== '2' || Math.abs(Number(props.ct) - scene.ct) <= 50);

// --- Ampoule ---

let lastDiscoveryAt = 0;
let discovering = null;

const locate = () => {
    if (discovering) return discovering;
    discovering = (async () => {
        lastDiscoveryAt = Date.now();
        let bulbs = await yeelight.discover();
        if (config.bulbId) bulbs = bulbs.filter((b) => b.id === config.bulbId).concat(bulbs.filter((b) => b.id !== config.bulbId));
        let ip = bulbs[0]?.ip || null;
        if (bulbs[0]) config.bulbId = bulbs[0].id;
        if (!ip) ip = (await yeelight.scan())[0] || null;
        if (ip && ip !== config.ip) {
            config.ip = ip;
            save();
            console.log(`💡 Lampe de l’entrée trouvée : Yeelight ${ip}`);
            journal.log({ kind: 'system', title: `Lampe de l’entrée trouvée (Yeelight ${ip})`, data: { ip } });
        }
        return config.ip;
    })().finally(() => {
        discovering = null;
    });
    return discovering;
};

/** Commande avec une nouvelle recherche si l'ampoule a changé d'adresse. */
const withBulb = async (fn) => {
    if (!config.ip) await locate();
    if (!config.ip) throw new Error('Yeelight introuvable : activer « Contrôle LAN » dans l’appli Yeelight');
    try {
        return await fn(config.ip);
    } catch (err) {
        if (Date.now() - lastDiscoveryAt < 60_000) throw err;
        const before = config.ip;
        await locate();
        if (!config.ip || config.ip === before) throw err;
        return fn(config.ip);
    }
};

// --- Allumage / extinction ---

let owned = null; // { scene } quand c'est nous qui l'avons allumée
let offTimer = null;
let busy = Promise.resolve();
const lastTrigger = { at: null, source: null };

const scheduleOff = () => {
    clearTimeout(offTimer);
    offTimer = setTimeout(() => {
        busy = busy.then(turnOff, turnOff);
    }, config.offAfterSec * 1000);
};

const turnOff = async () => {
    if (!owned) return;
    const { scene } = owned;
    owned = null;
    try {
        await withBulb(async (ip) => {
            const props = await yeelight.getProps(ip);
            if (!untouched(props, scene)) return; // réglée à la main entre-temps : on la laisse
            await yeelight.setPower(ip, false, 800);
        });
    } catch (err) {
        console.warn('⚠️  Lampe de l’entrée (extinction):', err.message);
    }
};

const turnOn = async (source) => {
    lastTrigger.at = Date.now();
    lastTrigger.source = source;
    if (owned) return scheduleOff(); // déjà allumée par nous : on repousse l'extinction
    try {
        await withBulb(async (ip) => {
            const props = await yeelight.getProps(ip);
            if (props.power === 'on') return; // allumée à la main : pas touche
            const scene = sceneFor(Date.now());
            // Ampoule blanche simple : pas de température de couleur, juste la luminosité
            await yeelight.setWhite(ip, scene.ct, scene.bright).catch(async () => {
                await yeelight.setPower(ip, true, 300);
                await yeelight.command(ip, 'set_bright', [scene.bright, 'sudden', 0]);
            });
            owned = { scene };
            scheduleOff();
        });
    } catch (err) {
        console.warn('⚠️  Lampe de l’entrée:', err.message);
    }
};

export const trigger = (source) => {
    if (!config.enabled) return busy;
    busy = busy.then(() => turnOn(source), () => turnOn(source));
    return busy;
};

// --- Déclencheurs ---

const entranceMotion = (ieee) => {
    const e = ieee && sensorRegistry.find(ieee);
    return e && e.type === 'motion' && (/entr[ée]e/i.test(e.room || '') || sensorRegistry.isEntrance(e.name)) ? e : null;
};

export const start = () => {
    // Porte d'entrée qui s'ouvre
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop === 'isOpen' && value === true && sensor.type === 'door' && sensorRegistry.isEntrance(sensor.name)) trigger(sensor.name);
    });
    // Mouvement : chaque message « occupancy: true » compte, même répété (le bus ne voit que les changements)
    zigbeeService.emitter.on('update', (name) => {
        const device = zigbeeService.getDevice(name);
        if (device?.state?.occupancy !== true || Date.now() - (device.lastSeen || 0) > 5000) return;
        const e = entranceMotion(device.ieeeAddr);
        if (e) trigger(e.name);
    });
    if (config.enabled && !config.ip) {
        const retry = () =>
            locate()
                .catch(() => null)
                .then((ip) => !ip && setTimeout(retry, RETRY_DISCOVERY_MS));
        setTimeout(retry, 8000);
    }
    console.log(`💡 Lampe de l’entrée ${config.enabled ? 'active' : 'désactivée'}${config.ip ? ` (Yeelight ${config.ip})` : ' (Yeelight à trouver)'}`);
};

// --- API ---

export const getStatus = () => ({
    enabled: config.enabled,
    ip: config.ip,
    offAfterSec: config.offAfterSec,
    nightFrom: config.nightFrom,
    nightTo: config.nightTo,
    day: config.day,
    night: config.night,
    lit: Boolean(owned),
    lastTrigger: lastTrigger.at ? { ...lastTrigger } : null,
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const level = (v, cur) => ({
    ct: v?.ct !== undefined ? Math.max(1700, Math.min(6500, Math.round(Number(v.ct)))) : cur.ct,
    bright: v?.bright !== undefined ? Math.max(1, Math.min(100, Math.round(Number(v.bright)))) : cur.bright,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.ip !== undefined) {
        if (patch.ip !== null && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(patch.ip))) throw new Error('Adresse IP invalide');
        config.ip = patch.ip;
    }
    if (patch.offAfterSec !== undefined) {
        const s = Number(patch.offAfterSec);
        if (!(s >= 15 && s <= 3600)) throw new Error('Délai entre 15 s et 1 h');
        config.offAfterSec = Math.round(s);
    }
    for (const k of ['nightFrom', 'nightTo']) {
        if (patch[k] === undefined) continue;
        if (!HHMM.test(patch[k])) throw new Error(`${k} : format HH:MM`);
        config[k] = patch[k];
    }
    if (patch.day) config.day = level(patch.day, config.day);
    if (patch.night) config.night = level(patch.night, config.night);
    save();
    return getStatus();
};

/** Essai depuis l'interface : allume comme si quelqu'un passait. */
export const test = async () => {
    if (!config.ip) await locate();
    await trigger('essai');
    return getStatus();
};
