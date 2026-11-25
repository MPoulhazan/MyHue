/**
 * Mode alarme / vacances, activé et coupé à la main (accueil, Telegram, voix).
 * Pas de géolocalisation : personne n'a besoin d'une appli sur son téléphone.
 *
 * Actif : une porte qui s'ouvre ou un mouvement → Telegram tout de suite, avec
 * « C'est nous » (coupe le mode) et « Tout allumer ». La lampe de l'entrée clignote en rouge.
 * Vacances en plus : simulation de présence le soir (salon dès la nuit tombée, cuisine au souper,
 * salle à manger un moment, tout éteint vers 23 h), à des heures qui changent chaque soir.
 * La maison vide (away.js) lance la simulation seule après 12 h de porte fermée, et arme
 * le mode vacances après 24 h ; ce mode-là se coupe tout seul quand un téléphone revient sur le Wi-Fi.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as sensorPause from './sensorPause.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as entranceLight from './entranceLight.js';
import { hueClient, hueBaseUrl } from './hue.js';
import { planSimDay, roomsOnAt, fallbackSunset } from './awayLogic.js';

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
    simulate: true, // vacances : simulation de présence le soir
    sim: { onFrom: '18:30', onTo: '19:30', offFrom: '22:45', offTo: '23:30' }, // ancien réglage, plus utilisé
    simDay: null, // { date, plan: { onAt, offAt, rooms }, applied: ['salon', …] }
    autoSim: false, // simulation lancée par la maison vide (12 h), sans alarme
    auto: false, // mode armé par la maison vide (24 h) : se coupe au retour d'un téléphone
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
    // « On part en week-end », « on part au chalet » : le mode vacances tout de suite, sans attendre 12 h
    if (/\b(on part|on s.en va|nous partons|partons)\b.*\b(week-?end|chalet)\b/.test(t)) return { action: 'on', mode: 'vacation' };
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
    auto: config.auto,
    autoSim: config.autoSim,
    pausedSensors: sensorPause.list(), // capteurs qui ne déclencheront pas d'alerte
    simToday: simActive() && config.simDay?.plan
        ? { onAt: config.simDay.plan.onAt, offAt: config.simDay.plan.offAt, lit: config.simDay.applied.length > 0, rooms: config.simDay.plan.rooms }
        : null,
});

function simActive() {
    return (config.mode === 'vacation' && config.simulate) || config.autoSim;
}

export const setMode = async (mode, by = 'écran', { auto = false, silent = true } = {}) => {
    if (mode !== null && !MODES.includes(mode)) throw new Error('Mode inconnu (alarm, vacation ou null)');
    const before = config.mode;
    if (before === mode) return getView();
    config.mode = mode;
    config.since = mode ? Date.now() : null;
    config.by = mode ? by : null;
    config.auto = Boolean(mode && auto);
    config.events = mode ? (before ? config.events : []) : [];
    // Le plan du soir reste le même : pas de lampes qui sautent quand la simulation change de main.
    // Simulation finie : on oublie ce qu'elle avait allumé, sans rien éteindre devant nous.
    if (config.simDay && !simActive()) config.simDay.applied = [];
    save();
    const paused = mode ? sensorPause.list() : [];
    const warn = paused.length ? ` ⚠️ En pause, non surveillé : ${paused.map((p) => p.name).join(', ')}.` : '';
    const text = mode ? `🛡️ ${LABEL[mode]} activé (${by}).${warn}` : `🏠 ${LABEL[before]} désactivé (${by}).`;
    journal.log({ kind: 'system', title: text, data: { mode, by } });
    notifier.notify({ text, silent }).catch(() => {});
    if (mode === 'vacation') tick();
    return getView();
};

/** Maison vide depuis 12 h : simulation sans alarme (away.js). Coupée au retour, sans rien éteindre. */
export const setAutoSim = (on) => {
    if (config.autoSim === Boolean(on)) return;
    config.autoSim = Boolean(on);
    if (config.simDay && !simActive()) config.simDay.applied = [];
    save();
    if (on) tick();
};

/** Un téléphone est revenu : on coupe le mode s'il a été armé par l'absence (jamais un mode mis à la main). */
export const disarmAuto = async (by) => {
    if (!config.mode || !config.auto) return false;
    await setMode(null, by, { silent: false });
    return true;
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
        builtin: 'guard',
        detail: text.replace(/^\S+\s/, ''),
        buttons: [
            { label: '🏠 C’est nous', run: async () => (await setMode(null, 'Telegram'), 'OK, mode coupé. Bon retour !') },
            { label: '💡 Tout allumer', run: allLightsOn },
        ],
    });
};

// --- Simulation de présence (vacances) ---

// Une Room Hue par pièce simulée ; blanc chaud, intensité moyenne (≈ 15-25 W en tout)
const ROOMS = {
    salon: { pattern: /salon/i, label: 'salon', state: { bri: 120, ct: 420 } },
    cuisine: { pattern: /cuisine/i, label: 'cuisine', state: { bri: 160, ct: 400 } },
    salle: { pattern: /salle/i, label: 'salle à manger', state: { bri: 110, ct: 430 } },
};

const setRoom = async (room, on) => {
    if (!hueBaseUrl) return;
    const { data: groups } = await hueClient.get('/groups');
    const id = Object.entries(groups).find(([, g]) => g.type === 'Room' && ROOMS[room].pattern.test(g.name))?.[0];
    if (!id) return;
    await hueClient.put(`/groups/${id}/action`, on ? { on: true, ...ROOMS[room].state, transitiontime: 50 } : { on: false, transitiontime: 50 });
};

// Coucher du soleil du jour (Open-Meteo), en minutes locales ; à défaut, une moyenne du mois
const sunsetOf = async (date) => {
    try {
        const { getForecast } = await import('./weather.js');
        const { days } = await getForecast();
        const d = days.find((x) => localParts(x.sunset).date === date);
        if (d) return localParts(d.sunset).min;
    } catch { /* météo injoignable */ }
    return fallbackSunset(Number(date.slice(5, 7)) - 1);
};

let ticking = false;
async function tick() {
    if (ticking || !simActive()) return;
    ticking = true;
    try {
        const { date, min } = localParts(Date.now());
        if (config.simDay?.date !== date || !config.simDay.plan) {
            config.simDay = { date, plan: planSimDay(await sunsetOf(date)), applied: [] };
            save();
        }
        const d = config.simDay;
        const want = roomsOnAt(d.plan, min);
        for (const room of want.filter((r) => !d.applied.includes(r))) {
            await setRoom(room, true);
            d.applied.push(room);
            save();
            journal.log({ kind: 'system', title: `Simulation de présence : ${ROOMS[room].label} allumé`, data: {} });
        }
        for (const room of d.applied.filter((r) => !want.includes(r))) {
            await setRoom(room, false);
            d.applied = d.applied.filter((r) => r !== room);
            save();
            journal.log({ kind: 'system', title: `Simulation de présence : ${ROOMS[room].label} éteint`, data: {} });
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
        if (entry?.type === 'motion' && !sensorPause.isPaused(entry.ieee)) alert(entry, 'motion');
    });
    setInterval(tick, TICK_MS).unref?.();
    console.log(`🛡️  Mode alarme/vacances : ${config.mode ? LABEL[config.mode] : 'désactivé'}`);
};
