/**
 * Cuisinière (sonde sur la hotte) :
 * - « cuisinière oubliée » : Telegram si plus personne n'est là (ou mode garde) et qu'elle chauffe,
 *   ou si elle chauffe depuis plus d'1 h 30 ;
 * - « l'eau bout » : annonce sur l'enceinte de la cuisine (Nest Hub) ;
 * - lumière de cuisson : le soir, Cuisine et Bar passent en blanc vif, puis reviennent comme avant ;
 * - contexte pour l'alarme fumée (automations.js).
 * Réglages et état dans data/stove.json. Logique pure : stoveLogic.js.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import * as haService from './haService.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as guard from './guard.js';
import * as circadian from './circadian.js';
import { announce, getSpeakers } from './briefing.js';
import { bus } from './events.js';
import { roleOf, indoorClimate, stoveSensor } from './sensorRoles.js';
import { DEFAULTS as LOGIC_DEFAULTS, initialState, step, alertDue, alertText, smokeContext, statusText } from './stoveLogic.js';

const FILE = dataFile('stove.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 60_000;
const SAMPLE_MS = 30 * 60_000;
const QUIET = { from: 22 * 60 + 30, to: 7 * 60 };

const DEFAULTS = {
    enabled: true,
    lights: true, // blanc vif le soir pendant la cuisson
    boilVoice: true, // « l'eau bout » sur l'enceinte de la cuisine
    speaker: null, // null = enceinte dont le nom contient « cuisine »
    tuning: {}, // surcharges des seuils de stoveLogic (onDelta, boilJump…)
    state: initialState(),
    alerts: { lastAwayAlertAt: 0, lastLongAlertAt: 0, mutedUntil: 0 },
    lamp: null, // { ids, before: { [id]: état Hue }, set: { [id]: { bri, ct } } } pendant la lumière de cuisson
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) {
        const saved = JSON.parse(readFileSync(FILE, 'utf8'));
        config = { ...config, ...saved, state: { ...DEFAULTS.state, ...saved.state }, alerts: { ...DEFAULTS.alerts, ...saved.alerts } };
    }
} catch (err) {
    console.error('❌ stove.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la cuisinière impossible:', err.message);
    }
};

const cfg = () => ({ ...LOGIC_DEFAULTS, ...config.tuning });

let getSensorsFn = null;
let samples = []; // [{ ts, t, h }] de la hotte, 30 dernières minutes
let last = { stove: null, humidity: null, indoor: null, did: null, name: null };
let awaySince = null;

const localMinutes = () => {
    const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    return Number(h) * 60 + Number(m);
};
const isQuiet = () => {
    const m = localMinutes();
    return m >= QUIET.from || m < QUIET.to;
};

// Personne (HA Companion) ou mode garde actif. null (pas de téléphone connu) = quelqu'un est là.
const isAway = () => presence.anyoneHome() === false || Boolean(guard.getView().mode);

let sunCache = { at: 0, dark: false };
const isDark = async () => {
    if (Date.now() - sunCache.at < 5 * 60_000) return sunCache.dark;
    try {
        const sun = await haService.getState('sun.sun');
        sunCache = { at: Date.now(), dark: Number(sun.attributes?.elevation) < 3 };
    } catch {
        const m = localMinutes();
        sunCache = { at: Date.now(), dark: m >= 17 * 60 || m < 7 * 60 };
    }
    return sunCache.dark;
};

// --- Lumière de cuisson ---

const kitchenLights = async () => {
    const { data: groups } = await hueClient.get('/groups');
    const room = Object.values(groups).find((g) => g.type === 'Room' && /cuisine|kitchen/i.test(g.name));
    return room?.lights || [];
};

const COOK = { bri: 254, ct: 250 }; // blanc neutre 4000 K, à fond

const lightsUp = async () => {
    if (!config.lights || !hueBaseUrl || config.lamp) return;
    if (!(await isDark()) || isAway()) return;
    try {
        const ids = await kitchenLights();
        const { data: lights } = await hueClient.get('/lights');
        const before = {};
        const used = [];
        for (const id of ids) {
            const s = lights[id]?.state;
            if (!s || s.reachable === false || s.ct === undefined) continue;
            // Lampe en couleur et allumée = signal en cours (bacs, courrier, Cooper) : on ne la prend pas
            if (s.on && s.colormode && s.colormode !== 'ct') continue;
            before[id] = { on: s.on, bri: s.bri, ct: s.ct, xy: s.xy, hue: s.hue, sat: s.sat, colormode: s.colormode };
            used.push(id);
        }
        if (!used.length) return;
        circadian.markManual(used); // le circadien ne repasse pas en 2200 K pendant la cuisson
        for (const id of used) await hueClient.put(`/lights/${id}/state`, { on: true, ...COOK, transitiontime: 10 });
        config.lamp = { ids: used, before };
        save();
        journal.log({ kind: 'stove', title: 'Cuisson : lumière de la cuisine en blanc vif', data: { lights: used } });
    } catch (err) {
        console.warn('⚠️  Cuisinière, lumière:', err.message);
    }
};

const lightsBack = async () => {
    const lamp = config.lamp;
    if (!lamp) return;
    config.lamp = null;
    save();
    try {
        const { data: lights } = await hueClient.get('/lights');
        const back = [];
        for (const id of lamp.ids) {
            const s = lights[id]?.state;
            if (!s) continue;
            // Éteinte, ou réglée autrement depuis (scène, couleur, autre blanc) : on la laisse
            const untouched = s.on && s.colormode === 'ct' && Math.abs(s.ct - COOK.ct) <= 25 && Math.abs(s.bri - COOK.bri) <= 10;
            if (!untouched) continue;
            await restoreLight(id, lamp.before[id]);
            back.push(id);
        }
        circadian.unmarkManual(back); // le circadien reprend la main sur le blanc
        journal.log({ kind: 'stove', title: 'Fin de cuisson : lumière de la cuisine comme avant', data: { lights: back } });
    } catch (err) {
        console.warn('⚠️  Cuisinière, lumière:', err.message);
    }
};

// --- L'eau bout ---

const kitchenSpeaker = async () => {
    if (config.speaker) return config.speaker;
    const speakers = await getSpeakers();
    return speakers.find((s) => s.available && (/cuisine|kitchen/i.test(s.name) || /cuisine|kitchen/i.test(s.id)))?.id || null;
};

const sayBoil = async () => {
    journal.log({ kind: 'stove', title: 'L’eau bout (vapeur sur la hotte)', data: {} });
    if (!config.boilVoice || isAway() || isQuiet() || !haService.isConfigured()) return;
    try {
        const speaker = await kitchenSpeaker();
        if (speaker) await announce([speaker], 'L’eau bout !', { volume: 0.55, holdMs: 6000 });
    } catch (err) {
        console.warn('⚠️  Cuisinière, enceinte:', err.message);
    }
};

// --- Analyse ---

const buttons = () => [
    {
        label: '👍 C’est normal',
        run: async () => {
            config.alerts.mutedUntil = Date.now() + 3 * 3600_000;
            save();
            return 'OK, plus de rappel sur la cuisinière pendant 3 h.';
        },
    },
];

const analyse = async () => {
    if (!config.enabled || last.stove == null) return;
    const now = Date.now();
    const { state, events } = step(config.state, { stove: last.stove, humidity: last.humidity, indoor: last.indoor, samples, now }, cfg());
    config.state = state;
    for (const e of events) {
        if (e === 'start') {
            journal.log({ kind: 'stove', title: `Cuisinière allumée (${String(last.stove).replace('.', ',')}° sur la hotte)`, data: {} });
            await lightsUp();
        } else if (e === 'stop') {
            const alerted = config.alerts.lastAwayAlertAt > 0 || config.alerts.lastLongAlertAt > 0;
            journal.log({ kind: 'stove', title: 'Cuisinière éteinte (la hotte refroidit)', data: {} });
            if (alerted) await notifier.notify({ text: '✅ La cuisinière refroidit, tout est rentré dans l’ordre.', silent: true }).catch(() => {});
            config.alerts = { lastAwayAlertAt: 0, lastLongAlertAt: 0, mutedUntil: 0 };
            await lightsBack();
        } else if (e === 'boil') {
            await sayBoil();
        }
    }

    const away = isAway();
    if (away) awaySince ??= now;
    else awaySince = null;
    const kind = alertDue({ on: state.on, since: state.since, away, awaySince, ...config.alerts, now }, cfg());
    if (kind) {
        if (kind === 'away') config.alerts.lastAwayAlertAt = now;
        else config.alerts.lastLongAlertAt = now;
        const text = alertText(kind, { since: state.since, stove: last.stove, now, tz: TZ });
        journal.log({ kind: 'stove', title: text, data: { alert: kind } });
        await notifier.notify({ text, buttons: buttons(), silent: false }).catch(() => {});
    }
    // Plus personne et la lumière de cuisson encore là : on la rend
    if (away && config.lamp && !state.on) await lightsBack();
    save();
};

const refreshIndoor = async () => {
    if (!getSensorsFn) return;
    try {
        const sensors = await getSensorsFn();
        const stove = stoveSensor(sensors);
        if (!stove) return;
        last.did = stove.did;
        last.name = stove.name;
        last.stove ??= stove.props.temperature;
        last.humidity ??= stove.props.humidity;
        // Sonde de la même pièce de préférence, sinon la première sonde de pièce (salon)
        const indoor = indoorClimate(sensors);
        const ref = indoor.find((s) => s.room && s.room === stove.room) || indoor[0];
        last.indoor = ref?.props.temperature ?? null;
    } catch { /* capteurs indisponibles : prochain tour */ }
};

// --- Vue ---

export const getView = () => ({
    found: Boolean(last.did),
    enabled: config.enabled,
    on: config.state.on,
    since: config.state.since,
    stove: last.stove,
    humidity: last.humidity,
    indoor: last.indoor,
    offset: Math.round(config.state.offset * 10) / 10,
    lights: config.lights,
    boilVoice: config.boilVoice,
    lightOn: Boolean(config.lamp),
    // Alerte « oubliée » déjà envoyée et toujours chaude : 'away' (personne) ou 'long' (1 h 30)
    alerting: !config.state.on ? null : config.alerts.lastAwayAlertAt ? 'away' : config.alerts.lastLongAlertAt ? 'long' : null,
    text: statusText({ on: config.state.on, since: config.state.since }),
});

/** Ligne ajoutée à l'alerte fumée. */
export const smokeLine = () => (last.did ? smokeContext({ on: config.state.on, since: config.state.since, stove: last.stove }) : null);

export const update = (patch = {}) => {
    for (const k of ['enabled', 'lights', 'boilVoice']) if (patch[k] !== undefined) config[k] = Boolean(patch[k]);
    if (patch.speaker !== undefined) config.speaker = patch.speaker || null;
    if (patch.tuning && typeof patch.tuning === 'object') {
        for (const [k, v] of Object.entries(patch.tuning)) {
            if (!(k in LOGIC_DEFAULTS)) continue;
            if (v === null) delete config.tuning[k];
            else if (Number.isFinite(Number(v))) config.tuning[k] = Number(v);
        }
    }
    save();
    return getView();
};

export const start = (getSensors) => {
    getSensorsFn = getSensors;
    bus.on('sensor', ({ sensor, prop, value, ts }) => {
        if (!['temperature', 'humidity'].includes(prop) || roleOf({ ...sensor, props: { temperature: 0 } }) !== 'stove') return;
        last.did = sensor.did;
        if (prop === 'temperature') last.stove = value;
        else last.humidity = value;
        // Analyse avec les mesures d'avant, puis on garde celle-ci
        analyse().finally(() => {
            samples.push({ ts, t: last.stove, h: last.humidity });
            samples = samples.filter((s) => s.ts >= Date.now() - SAMPLE_MS);
        });
    });
    setTimeout(async () => {
        await refreshIndoor();
        if (last.did) console.log(`🍳 Cuisinière suivie (${last.name}, ${statusText(config.state)})`);
    }, 15_000);
    setInterval(async () => {
        await refreshIndoor();
        await analyse();
    }, TICK_MS);
};
