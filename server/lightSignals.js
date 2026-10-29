/**
 * Lampes qui informent : au moment de partir, une Hue « respire » quelques secondes
 * en bleu si la pluie arrive dans les 30 min, en ambre si une tempête approche,
 * puis reprend exactement son état d'avant (éteinte si elle l'était).
 *
 * Départ = la porte d'entrée s'ouvre autour de l'heure de sortie du matin,
 * le moment « Je pars », ou HA Companion qui dit que plus personne n'est là.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { hueClient, ensureHueConfigured } from './hue.js';
import * as journal from './journal.js';
import { bus } from './events.js';
import { getWeatherDetails } from './weather.js';

const FILE = dataFile('signals.json');
const TZ = process.env.TZ || 'America/Toronto';
// Couleurs en xy (gamut C) : bleu pluie, ambre tempête
const COLORS = { rain: [0.167, 0.04], storm: [0.56, 0.41] };
const BREATHE_MS = 15_000; // durée d'une « respiration » Hue (alert lselect)

const DEFAULTS = {
    enabled: true,
    lightId: null, // null = première lampe couleur joignable du salon
    windowBeforeMin: 90, // la porte d'entrée compte de 1 h 30 avant…
    windowAfterMin: 60, // …à 1 h après l'heure de sortie du matin
    cooldownMin: 30,
    stormWithinHours: 24,
    lastAt: 0,
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ signals.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des lampes-signal impossible:', err.message);
    }
};

// --- Décisions (testées dans lightSignals.test.js) ---

/** Signaux à montrer d'après /api/weather/details : ['rain'] , ['storm'], les deux ou []. */
export const signalsFor = (w, now = Date.now(), stormWithinHours = DEFAULTS.stormWithinHours) => {
    const out = [];
    if (w.rainSoon) out.push('rain');
    const s = w.storm;
    if (s && (s.level === 'likely' || s.level === 'storm')) {
        const from = s.window?.from ?? now;
        if (from - now <= stormWithinHours * 3600_000) out.push('storm');
    }
    return out;
};

/** Minutes locales d'un instant. */
const localMinutes = (ts) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};

/** La porte d'entrée qui s'ouvre compte comme un départ seulement autour de la sortie du matin. */
export const inLeaveWindow = (minutes, outHour, before = DEFAULTS.windowBeforeMin, after = DEFAULTS.windowAfterMin) =>
    minutes >= outHour * 60 - before && minutes <= outHour * 60 + after;

export const isEntrance = (name) => /entr[ée]e|front|principale/i.test(name || '');

// --- Hue ---

const pickLight = async () => {
    const { data: lights } = await hueClient.get('/lights');
    if (config.lightId && lights[config.lightId]) return config.lightId;
    const { data: groups } = await hueClient.get('/groups');
    const salon = Object.values(groups).find((g) => g.type === 'Room' && /salon/i.test(g.name));
    const candidates = salon ? salon.lights : Object.keys(lights);
    return candidates.find((id) => lights[id]?.state?.reachable && lights[id]?.state?.xy) || null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fait respirer une lampe dans chaque couleur, puis remet son état d'avant. */
export const pulse = async (kinds, source = 'départ') => {
    ensureHueConfigured();
    const id = await pickLight();
    if (!id) throw new Error('Aucune lampe couleur joignable');
    const { data: light } = await hueClient.get(`/lights/${id}`);
    const before = light.state;
    const put = (state) => hueClient.put(`/lights/${id}/state`, state);
    try {
        for (const kind of kinds) {
            await put({ on: true, xy: COLORS[kind], bri: 220, transitiontime: 4 });
            await sleep(600);
            await put({ alert: 'lselect' });
            await sleep(BREATHE_MS);
            await put({ alert: 'none' });
        }
    } finally {
        // Retour à l'état d'avant, couleur comprise
        const restore = { transitiontime: 4 };
        if (before.on) {
            Object.assign(restore, { on: true, bri: before.bri });
            if (before.colormode === 'ct' && before.ct) restore.ct = before.ct;
            else if (before.colormode === 'hs' && before.hue != null) Object.assign(restore, { hue: before.hue, sat: before.sat });
            else if (before.xy) restore.xy = before.xy;
        } else {
            restore.on = false;
        }
        await put(restore);
    }
    const what = kinds.map((k) => (k === 'rain' ? 'pluie dans 30 min' : 'tempête en approche')).join(' et ');
    journal.log({ kind: 'system', title: `${light.name} a prévenu : ${what} (${source})`, data: { light: id, kinds } });
    return { light: { id, name: light.name }, kinds };
};

// --- Déclencheurs ---

let busy = false;
const onLeave = async (source) => {
    if (!config.enabled || busy) return;
    if (Date.now() - config.lastAt < config.cooldownMin * 60_000) return;
    busy = true;
    try {
        const w = await getWeatherDetails();
        const kinds = signalsFor(w, Date.now(), config.stormWithinHours);
        if (!kinds.length) return;
        config.lastAt = Date.now();
        save();
        await pulse(kinds, source);
    } catch (err) {
        console.warn('⚠️  Lampe-signal:', err.message);
    } finally {
        busy = false;
    }
};

// Heure de sortie du matin (WEATHER_OUTINGS=8,17)
const outHour = () => Number((process.env.WEATHER_OUTINGS || '8,17').split(',')[0]) || 8;

export const start = () => {
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop !== 'isOpen' || value !== true || sensor.type !== 'door' || !isEntrance(sensor.name)) return;
        if (!inLeaveWindow(localMinutes(Date.now()), outHour(), config.windowBeforeMin, config.windowAfterMin)) return;
        onLeave(sensor.name);
    });
    // « Je pars » éteint tout : on attend la fin pour que la lampe retourne à l'état éteint
    bus.on('moment', ({ id }) => id === 'depart' && setTimeout(() => onLeave('Je pars'), 1500));
    bus.on('presence', ({ anyoneHome }) => anyoneHome === false && onLeave('départ détecté'));
    console.log(`💡 Lampes-signal ${config.enabled ? 'actives' : 'désactivées'}`);
};

// --- API ---

export const getStatus = () => ({
    enabled: config.enabled,
    lightId: config.lightId,
    windowBeforeMin: config.windowBeforeMin,
    windowAfterMin: config.windowAfterMin,
    outHour: outHour(),
    lastAt: config.lastAt || null,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.lightId !== undefined) {
        if (patch.lightId !== null && !/^\d+$/.test(String(patch.lightId))) throw new Error('Lampe invalide');
        config.lightId = patch.lightId === null ? null : String(patch.lightId);
    }
    save();
    return getStatus();
};

/** Essai depuis l'interface : montre un signal tout de suite, sans regarder la météo. */
export const test = async (kind) => {
    if (!COLORS[kind]) throw new Error('Signal inconnu');
    return pulse([kind], 'essai');
};
