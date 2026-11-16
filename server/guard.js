/**
 * Mode alarme / vacances, activé et coupé à la main (accueil, Telegram, voix).
 * Pas de géolocalisation : personne n'a besoin d'une appli sur son téléphone.
 *
 * Actif : une porte qui s'ouvre ou un mouvement → Telegram tout de suite, avec
 * « C'est nous » (coupe le mode) et « Tout allumer ». La lampe de l'entrée clignote en rouge.
 * Vacances en plus : le salon s'allume le soir et s'éteint vers 23 h, à des heures
 * qui changent un peu chaque jour, pour que la maison ait l'air habitée.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as entranceLight from './entranceLight.js';
import { hueClient, hueBaseUrl } from './hue.js';

const FILE = dataFile('guard.json');
const TZ = process.env.TZ || 'America/Toronto';
const SENSOR_COOLDOWN_MS = 3 * 60_000; // une alerte par capteur toutes les 3 min au plus
const TICK_MS = 30_000;
export const MODES = ['alarm', 'vacation'];
const LABEL = { alarm: 'Mode alarme', vacation: 'Mode vacances' };

const DEFAULTS = {
    mode: null, // null | 'alarm' | 'vacation'
    since: null,
    by: null,
    events: [], // [{ at, sensor, what }] pendant le mode en cours
    simulate: true, // vacances : simulation de présence au salon
    sim: { onFrom: '18:30', onTo: '19:30', offFrom: '22:45', offTo: '23:30' },
    simDay: null, // { date, onAt, offAt, lit, offDone }
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ guard.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du mode alarme impossible:', err.message);
    }
};

// --- Décisions (testées dans guard.test.js) ---

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

/**
 * Comprend « active le mode vacances », « coupe l'alarme », « on est rentrés »,
 * « le mode alarme est activé ? ». Renvoie { action: 'on', mode } | { action: 'off' } | { action: 'status' } | null.
 */
export const parseGuardCommand = (text) => {
    const t = norm(text);
    if (/\b(on est|je suis|nous sommes) (rentre|rentres|rentree|rentrees|de retour)\b/.test(t)) return { action: 'off' };
    const vacation = /\b(mode|en) vacances?\b/.test(t);
    const alarm = /\b(alarme|surveillance)\b/.test(t);
    if (!vacation && !alarm) return null;
    // L'alarme fuite d'eau a son propre vocabulaire : on ne la confond pas
    if (/\b(fuite|eau|feu|fumee)\b/.test(t)) return null;
    if (/\?\s*$/.test(t.trim()) || /\b(est[- ]ce|est[- ]il|est[- ]elle|c.est quoi|ou en est)\b/.test(t)) return { action: 'status' };
    if (/\b(desactive[rsz]?|arrete[rsz]?|coupe[rsz]?|enleve[rsz]?|eteins?|stop|fin|sors?|quitte[rsz]?)\b/.test(t)) return { action: 'off' };
    if (/\b(active[rsz]?|mets?|lance[rsz]?|allume[rsz]?|passe[rsz]?|pars|part|partons|mode)\b/.test(t)) return { action: 'on', mode: vacation ? 'vacation' : 'alarm' };
    return null;
};

export const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
};

/** Heure au hasard dans une plage, en minutes depuis minuit (rand ∈ [0, 1)). */
export const pickMinute = (from, to, rand = Math.random()) => {
    const a = toMin(from);
    const b = toMin(to);
    return a + Math.floor(rand * Math.max(1, b - a));
};

const localParts = (ts) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString('en-CA', { timeZone: TZ });
    const [h, m] = d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return { date, min: h * 60 + m };
};
const hm = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

/** Phrase de statut pour la voix et Telegram. */
export const guardSpeech = (view) => {
    if (!view.mode) return 'Le mode alarme et le mode vacances sont désactivés.';
    const n = view.events.length;
    const alerts = n ? ` ${n} alerte${n > 1 ? 's' : ''} depuis.` : ' Rien à signaler depuis.';
    return `${LABEL[view.mode]} activé.${alerts}`;
};

// --- Mode ---

export const getView = () => ({
    mode: config.mode,
    since: config.since,
    by: config.by,
    events: config.events.slice(-8).reverse(),
    simulate: config.simulate,
    sim: config.sim,
    simToday: config.mode === 'vacation' && config.simulate && config.simDay ? { onAt: config.simDay.onAt, offAt: config.simDay.offAt, lit: config.simDay.lit } : null,
});

export const setMode = async (mode, by = 'écran') => {
    if (mode !== null && !MODES.includes(mode)) throw new Error('Mode inconnu (alarm, vacation ou null)');
    const before = config.mode;
    if (before === mode) return getView();
    config.mode = mode;
    config.since = mode ? Date.now() : null;
    config.by = mode ? by : null;
    config.events = mode ? (before ? config.events : []) : [];
    config.simDay = null;
    save();
    const text = mode ? `🛡️ ${LABEL[mode]} activé (${by}).` : `🏠 ${LABEL[before]} désactivé (${by}).`;
    journal.log({ kind: 'system', title: text, data: { mode, by } });
    notifier.notify({ text, silent: true }).catch(() => {});
    if (mode === 'vacation') tick();
    return getView();
};

export const update = (patch = {}) => {
    if (patch.simulate !== undefined) config.simulate = Boolean(patch.simulate);
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (patch.sim) {
        for (const k of ['onFrom', 'onTo', 'offFrom', 'offTo']) {
            if (patch.sim[k] === undefined) continue;
            if (!HHMM.test(patch.sim[k])) throw new Error(`${k} : format HH:MM`);
            config.sim[k] = patch.sim[k];
        }
        config.simDay = null;
    }
    save();
    return getView();
};

// --- Alertes ---

const lastAlert = new Map(); // did → ts

const allLightsOn = async () => {
    const { executeActions } = await import('./actions.js');
    await executeActions([{ type: 'toggle_all', on: true }], 'mode alarme');
    return 'Toutes les lumières sont allumées.';
};

const alert = async (entry, what) => {
    if (!config.mode) return;
    const now = Date.now();
    if (now - (lastAlert.get(entry.ieee) || 0) < SENSOR_COOLDOWN_MS) return;
    lastAlert.set(entry.ieee, now);
    config.events.push({ at: now, sensor: entry.name, what });
    config.events = config.events.slice(-50);
    save();
    const { min } = localParts(now);
    const text = `🚨 ${LABEL[config.mode]} : ${what === 'open' ? `${entry.name} vient de s’ouvrir` : `mouvement, ${entry.name}`} (${hm(min)}).`;
    journal.log({ kind: 'automation', title: text, data: { did: entry.ieee, level: 'alert' } });
    await notifier.notify({
        text,
        buttons: [
            { label: '🏠 C’est nous', run: async () => (await setMode(null, 'Telegram'), 'OK, mode coupé. Bon retour !') },
            { label: '💡 Tout allumer', run: allLightsOn },
        ],
    });
};

// --- Simulation de présence (vacances) ---

const salonGroup = async () => {
    const { data: groups } = await hueClient.get('/groups');
    const found = Object.entries(groups).find(([, g]) => g.type === 'Room' && /salon/i.test(g.name));
    return found?.[0] || null;
};

const setSalon = async (on) => {
    if (!hueBaseUrl) return;
    const id = await salonGroup();
    if (!id) return;
    await hueClient.put(`/groups/${id}/action`, on ? { on: true, bri: 150, ct: 400, transitiontime: 50 } : { on: false, transitiontime: 50 });
};

let ticking = false;
async function tick() {
    if (ticking || config.mode !== 'vacation' || !config.simulate) return;
    ticking = true;
    try {
        const { date, min } = localParts(Date.now());
        if (config.simDay?.date !== date) {
            config.simDay = { date, onAt: pickMinute(config.sim.onFrom, config.sim.onTo), offAt: pickMinute(config.sim.offFrom, config.sim.offTo), lit: false, offDone: false };
            save();
        }
        const d = config.simDay;
        if (!d.lit && !d.offDone && min >= d.onAt && min < d.offAt) {
            await setSalon(true);
            d.lit = true;
            save();
            journal.log({ kind: 'system', title: 'Vacances : salon allumé pour la soirée', data: {} });
        } else if (d.lit && min >= d.offAt) {
            await setSalon(false);
            d.lit = false;
            d.offDone = true;
            save();
            journal.log({ kind: 'system', title: 'Vacances : salon éteint pour la nuit', data: {} });
        }
    } catch (err) {
        console.warn('⚠️  Simulation de présence:', err.message);
    } finally {
        ticking = false;
    }
}

// --- Démarrage ---

export const start = () => {
    entranceLight.setAlarmCheck(() => Boolean(config.mode));
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop !== 'isOpen' || value !== true || sensor.type !== 'door') return;
        const entry = sensorRegistry.find(sensor.did);
        if (entry) alert(entry, 'open');
    });
    zigbeeService.emitter.on('update', (name) => {
        const device = zigbeeService.getDevice(name);
        if (device?.state?.occupancy !== true || Date.now() - (device.lastSeen || 0) > 5000) return;
        const entry = sensorRegistry.find(device.ieeeAddr);
        if (entry?.type === 'motion') alert(entry, 'motion');
    });
    setInterval(tick, TICK_MS).unref?.();
    console.log(`🛡️  Mode alarme/vacances : ${config.mode ? LABEL[config.mode] : 'désactivé'}`);
};
