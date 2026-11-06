/**
 * Repas de Cooper : le capteur d'ouverture sur sa boîte de croquettes dit s'il a mangé.
 *
 * - Une ouverture dans la plage d'un repas (10 h 30–13 h 30, 16 h 30–19 h 30) = repas donné.
 *   Un repas oublié peut encore être donné en retard, jusqu'au début de la plage suivante.
 * - 30 min après l'heure sans ouverture : Telegram (bouton « C'est fait »), annonce sur
 *   l'enceinte de la cuisine et la lampe du bar qui passe lentement du rouge au blanc
 *   (au plus 1 h), ces deux-là seulement si quelqu'un est à la maison.
 * - Boîte rouverte pendant la même plage : « Cooper a déjà mangé à 12 h 04 ».
 * - À chaque ouverture, s'il fait sombre, le bar s'allume en blanc 4 min pour qu'il voie
 *   sa gamelle, puis reprend son état d'avant (sauf si quelqu'un l'a changé entre-temps).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import * as haService from './haService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as zigbeeService from './zigbeeService.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as alarm from './alarm.js';
import { announce, getSpeakers } from './briefing.js';
import { bus } from './events.js';

const FILE = dataFile('cooper.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 30_000;
const KEEP_DAYS = 21;
const SAME_FEEDING_MS = 5 * 60_000; // rouvrir la boîte juste après pour finir de servir ≠ deuxième repas
const DOUBLE_SHOWN_MS = 10 * 60_000;
const BLINK_EVERY_MS = 3000;
const RED = [0.675, 0.322];
const WHITE_XY = [0.3227, 0.329];
const WHITE = { on: true, bri: 254, ct: 250 };

const DEFAULTS = {
    enabled: true,
    sensorDid: null, // null = capteur du registre dont le nom contient « croquette » ou « cooper »
    lightId: null, // null = lampe « Bar » de la pièce Cuisine
    speaker: null, // null = enceinte dont le nom contient « cuisine »
    meals: [
        { id: 'midi', label: 'midi', time: '12:00', from: '10:30', to: '13:30' },
        { id: 'soir', label: 'soir', time: '18:00', from: '16:30', to: '19:30' },
    ],
    lateMin: 30,
    blinkMaxMin: 60,
    lightOnOpenMin: 4,
    lightOnlyWhenDark: true,
    voice: true,
    days: {}, // 'YYYY-MM-DD' -> { midi: { at, source, late? }, … }
    alerted: {}, // 'YYYY-MM-DD' -> { midi: ts }
    lastDouble: null, // { at, meal, fedAt }
    lamp: null, // état du bar à remettre si le serveur redémarre en plein signal
    since: null, // début du suivi : les repas d'avant ce jour-là ne sont pas comptés comme oubliés
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ cooper.json illisible, réglages par défaut:', err.message);
}
if (!config.since) {
    config.since = Date.now();
    queueMicrotask(() => save());
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des repas de Cooper impossible:', err.message);
    }
};

// --- Décisions (testées dans cooper.test.js) ---

export const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

/** Date locale (YYYY-MM-DD) et minutes depuis minuit d'un instant. */
export const localParts = (ts = Date.now(), tz = TZ) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString('en-CA', { timeZone: tz });
    const [h, m] = d.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return { date, minutes: h * 60 + m };
};

/** « 12 h 04 » */
export const hm = (ts, tz = TZ) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    return `${Number(h)} h ${m}`;
};
const hmMin = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;

/** Fin de la période où un repas peut encore être donné : début de la plage suivante, sinon 23 h. */
const lastChance = (meals, i) => (meals[i + 1] ? toMin(meals[i + 1].from) : 23 * 60);

/**
 * À quel repas compte une ouverture à `minutes` ?
 * → { meal, double } dans la plage d'un repas, { meal, late: true } pour un repas oublié rattrapé, ou null.
 */
export const assignOpening = (minutes, meals, fed = {}) => {
    const inWindow = meals.find((m) => minutes >= toMin(m.from) && minutes <= toMin(m.to));
    if (inWindow) return { meal: inWindow.id, double: Boolean(fed[inWindow.id]) };
    for (let i = meals.length - 1; i >= 0; i--) {
        const m = meals[i];
        if (minutes > toMin(m.to) && minutes < lastChance(meals, i)) {
            return fed[m.id] ? null : { meal: m.id, late: true };
        }
    }
    return null;
};

/**
 * État d'un repas : done, upcoming, soon (≤ 30 min avant), due (l'heure est passée),
 * late (oublié, encore rattrapable), missed (trop tard).
 */
export const mealStatus = (meals, i, minutes, fed = {}, lateMin = DEFAULTS.lateMin) => {
    const m = meals[i];
    if (fed[m.id]) return 'done';
    const t = toMin(m.time);
    if (minutes < t - 30) return 'upcoming';
    if (minutes < t) return 'soon';
    if (minutes < t + lateMin) return 'due';
    if (minutes < lastChance(meals, i)) return 'late';
    return 'missed';
};

/**
 * Ce que dit Cooper dans sa bulle, d'après l'état des repas du jour.
 * @returns {{ mood: 'fed'|'waiting'|'soon'|'late'|'double', line: string }}
 */
export const cooperLine = (view, now = Date.now(), tz = TZ) => {
    const { minutes } = localParts(now, tz);
    if (view.double) {
        return { mood: 'double', line: `Déjà mangé à ${hm(view.double.fedAt, tz)}, hein. Bien essayé !` };
    }
    const late = view.meals.find((m) => m.status === 'late');
    if (late) {
        const ago = minutes - toMin(late.time);
        const when = ago >= 60 ? `il y a ${Math.floor(ago / 60)} h${ago % 60 ? ` ${String(ago % 60).padStart(2, '0')}` : ''}` : `il y a ${ago} min`;
        return { mood: 'late', line: `Euh… on n'a pas oublié quelqu'un ? Le repas de ${late.label}, c'était ${when}.` };
    }
    const due = view.meals.find((m) => m.status === 'due');
    if (due) return { mood: 'soon', line: "C'est l'heure ! Je suis devant ma gamelle." };
    const soon = view.meals.find((m) => m.status === 'soon');
    if (soon) {
        const left = toMin(soon.time) - minutes;
        return { mood: 'soon', line: `Plus que ${left} minute${left > 1 ? 's' : ''}… je surveille la boîte.` };
    }
    const next = view.meals.find((m) => m.status === 'upcoming');
    const lastDone = [...view.meals].reverse().find((m) => m.status === 'done');
    const missed = view.meals.find((m) => m.status === 'missed');
    if (!next) {
        if (missed) return { mood: 'late', line: `Pas de repas de ${missed.label} aujourd'hui… je m'en souviendrai.` };
        return { mood: 'fed', line: 'Deux repas, ventre plein. Bonne nuit !' };
    }
    if (lastDone) return { mood: 'fed', line: `Miam, merci ! On se revoit à ${hmMin(toMin(next.time))}.` };
    return { mood: 'waiting', line: `Prochain repas à ${hmMin(toMin(next.time))}. Je patiente.` };
};

/** Réponse de Jarvis à « Est-ce que Cooper a mangé ? ». */
export const cooperSpeech = (view, tz = TZ) => {
    const done = view.meals.filter((m) => m.status === 'done');
    const late = view.meals.find((m) => m.status === 'late' || m.status === 'missed');
    const next = view.meals.find((m) => ['upcoming', 'soon', 'due'].includes(m.status));
    const parts = [];
    if (late) parts.push(`Non, Cooper n'a pas eu son repas de ${late.label}.`);
    else if (done.length) parts.push(`Oui, Cooper a mangé à ${done.map((m) => hm(m.at, tz)).join(' et à ')}.`);
    else parts.push("Cooper n'a pas encore mangé aujourd'hui.");
    if (next) parts.push(`Prochain repas à ${hmMin(toMin(next.time))}.`);
    return parts.join(' ');
};

export const isCooperQuestion = (text) =>
    /cooper|(le|du) chien|croquette/i.test(text) && /mang|nourri|repas|croquette|gamelle/i.test(text);

// --- Vue ---

const todayFed = (date) => config.days[date] || {};

/** Repas d'avant l'installation du capteur, le premier jour : ni donné ni oublié. */
const beforeTracking = (date, meal, fed) => {
    if (fed[meal.id]) return false;
    const since = localParts(config.since);
    return date === since.date && toMin(meal.time) + DEFAULTS.lateMin < since.minutes;
};

export const getView = (now = Date.now()) => {
    const { date, minutes } = localParts(now);
    const fed = todayFed(date);
    const meals = config.meals.map((m, i) => ({
        id: m.id,
        label: m.label,
        time: m.time,
        status: beforeTracking(date, m, fed) ? 'unknown' : mealStatus(config.meals, i, minutes, fed, config.lateMin),
        at: fed[m.id]?.at ?? null,
        source: fed[m.id]?.source ?? null,
        late: Boolean(fed[m.id]?.late),
    }));
    const d = config.lastDouble;
    const double = d && now - d.at < DOUBLE_SHOWN_MS ? d : null;
    const view = { meals, double };
    const sensor = findSensor();
    const device = sensor && zigbeeService.getDevices().find((x) => x.ieeeAddr === sensor.ieee);
    return {
        enabled: config.enabled,
        sensor: sensor ? { did: sensor.ieee, name: sensor.name, online: device ? device.available !== false : false } : null,
        ...view,
        ...cooperLine(view, now),
        blinking: config.lamp?.mode === 'blink',
    };
};

/** Repas des derniers jours (résumé de la semaine). */
export const getHistory = () => ({ meals: config.meals.map((m) => m.id), days: config.days });

// --- Capteur, lampe, enceinte ---

const findSensor = () => {
    const all = sensorRegistry.getAll();
    if (config.sensorDid) return all.find((s) => s.ieee === config.sensorDid) || null;
    return all.find((s) => /croquette|cooper/i.test(s.name)) || null;
};

const pickLight = async () => {
    const { data: lights } = await hueClient.get('/lights');
    if (config.lightId && lights[config.lightId]) return config.lightId;
    const { data: groups } = await hueClient.get('/groups');
    const kitchen = Object.values(groups).find((g) => g.type === 'Room' && /cuisine|kitchen/i.test(g.name));
    const inKitchen = (kitchen?.lights || []).find((id) => /bar/i.test(lights[id]?.name || ''));
    return inKitchen || Object.keys(lights).find((id) => /bar/i.test(lights[id].name)) || null;
};

const kitchenSpeaker = async () => {
    if (config.speaker) return config.speaker;
    const speakers = await getSpeakers();
    return speakers.find((s) => s.available && (/cuisine|kitchen/i.test(s.name) || /cuisine|kitchen/i.test(s.id)))?.id || null;
};

const say = async (message) => {
    if (!config.voice || !haService.isConfigured()) return;
    try {
        const speaker = await kitchenSpeaker();
        if (speaker) await announce([speaker], message, { volume: 0.6 });
    } catch (err) {
        console.warn('⚠️  Cooper, enceinte:', err.message);
    }
};

// null = on ne sait pas (HA Companion absent) : on fait comme si quelqu'un était là
const someoneHome = () => presence.anyoneHome() !== false;

let sunCache = { at: 0, dark: true };
const isDark = async () => {
    if (!haService.isConfigured()) return true;
    if (Date.now() - sunCache.at < 5 * 60_000) return sunCache.dark;
    try {
        const sun = await haService.getState('sun.sun');
        // Un peu avant le coucher, la cuisine est déjà sombre
        sunCache = { at: Date.now(), dark: Number(sun.attributes?.elevation) < 3 };
    } catch {
        sunCache = { at: Date.now(), dark: true };
    }
    return sunCache.dark;
};

// --- Lampe du bar : un seul signal à la fois, état d'avant mémorisé une fois ---

let lampTimer = null;
let blinkTimer = null;

const stopTimers = () => {
    clearTimeout(lampTimer);
    clearInterval(blinkTimer);
    lampTimer = blinkTimer = null;
};

const putLight = (id, state) => hueClient.put(`/lights/${id}/state`, state);

const endLamp = async ({ checkManual = false } = {}) => {
    const lamp = config.lamp;
    stopTimers();
    if (!lamp) return;
    config.lamp = null;
    save();
    try {
        if (checkManual) {
            // Quelqu'un a changé le bar pendant les 4 min : on ne l'écrase pas
            const { data } = await hueClient.get(`/lights/${lamp.id}`);
            const s = data.state;
            const untouched = s.on && Math.abs(s.bri - WHITE.bri) <= 3 && s.colormode === 'ct' && Math.abs(s.ct - WHITE.ct) <= 5;
            if (!untouched) return;
        }
        await restoreLight(lamp.id, lamp.before);
    } catch (err) {
        console.warn('⚠️  Cooper, lampe:', err.message);
    }
};

// Autres signaux sur le bar (boîte aux lettres, collecte) : ils rendent la lampe avant qu'on lise son état
const lampYields = [];
export const setLampYield = (fn) => lampYields.push(fn);
// Un signal plus important que le courrier veut le bar (la poubelle du soir) : le courrier lui laisse la place
const barClaims = new Set();
export const claimBar = (who, on) => (on ? barClaims.add(who) : barClaims.delete(who));
export const barClaimed = () => barClaims.size > 0;
let taking = false;
export const lampBusy = () => taking || Boolean(config.lamp);
export const pickBarLight = () => pickLight();

const takeLamp = async (mode) => {
    if (config.lamp) {
        config.lamp.mode = mode;
        return config.lamp;
    }
    taking = true;
    try {
        for (const fn of lampYields) await fn().catch(() => {});
        const id = await pickLight();
        if (!id) throw new Error('Lampe du bar introuvable');
        const { data } = await hueClient.get(`/lights/${id}`);
        config.lamp = { id, name: data.name, before: data.state, mode, color: Boolean(data.state.xy) };
        save();
        return config.lamp;
    } finally {
        taking = false;
    }
};

/** Rouge ↔ blanc, lentement, jusqu'à l'ouverture de la boîte, « C'est fait » ou au plus 1 h. */
const startBlink = async (maxMs = config.blinkMaxMin * 60_000) => {
    if (!hueBaseUrl || alarm.anyActive()) return;
    if (config.lamp?.mode === 'white') return; // la gamelle est en train d'être servie
    const lamp = await takeLamp('blink');
    stopTimers();
    let red = true;
    const step = () => {
        const state = lamp.color
            ? { on: true, bri: 230, xy: red ? RED : WHITE_XY, transitiontime: 25 }
            : { on: true, ct: 300, bri: red ? 254 : 60, transitiontime: 25 };
        red = !red;
        putLight(lamp.id, state).catch(() => {});
    };
    step();
    blinkTimer = setInterval(step, BLINK_EVERY_MS);
    lampTimer = setTimeout(() => endLamp(), maxMs);
};

/** Blanc pour voir la gamelle, puis état d'avant (celui d'avant le clignotement s'il y en avait un). */
const showBowl = async () => {
    if (!hueBaseUrl || alarm.anyActive()) return;
    const lamp = await takeLamp('white');
    stopTimers();
    await putLight(lamp.id, { ...WHITE, transitiontime: 4 });
    lampTimer = setTimeout(() => endLamp({ checkManual: true }), config.lightOnOpenMin * 60_000);
};

// --- Repas ---

const prune = () => {
    const keep = new Set(Object.keys(config.days).sort().slice(-KEEP_DAYS));
    for (const k of Object.keys(config.days)) if (!keep.has(k)) delete config.days[k];
    for (const k of Object.keys(config.alerted)) if (!keep.has(k) && k !== localParts().date) delete config.alerted[k];
};

const mealLabel = (id) => config.meals.find((m) => m.id === id)?.label || id;

/** Note le repas ; prévient si une alerte d'oubli était partie. */
const recordMeal = async (mealId, { at = Date.now(), source, late = false }) => {
    const { date } = localParts(at);
    config.days[date] = { ...todayFed(date), [mealId]: { at, source, ...(late ? { late: true } : {}) } };
    prune();
    save();
    journal.log({ kind: 'system', title: `Cooper a eu son repas de ${mealLabel(mealId)} (${hm(at)})`, data: { meal: mealId, source } });
    if (config.alerted[date]?.[mealId]) {
        notifier.notify({ text: `✅ Cooper a eu son repas de ${mealLabel(mealId)} à ${hm(at)}.`, silent: true }).catch(() => {});
    }
};

/** « C'est fait » (carte, Telegram, agent) : le repas en attente le plus proche. */
export const markFed = async (mealId = null, source = 'bouton') => {
    const view = getView();
    const target = mealId
        ? view.meals.find((m) => m.id === mealId)
        : view.meals.find((m) => m.status === 'late') || view.meals.find((m) => m.status === 'due') || view.meals.find((m) => m.status === 'soon');
    if (!target) throw new Error('Aucun repas en attente');
    if (target.status !== 'done') await recordMeal(target.id, { source, late: target.status === 'late' });
    if (config.lamp?.mode === 'blink') await endLamp();
    return getView();
};

const onOpen = async (ts) => {
    if (!config.enabled) return;
    const { date, minutes } = localParts(ts);
    const fed = todayFed(date);
    const hit = assignOpening(minutes, config.meals, fed);

    if (hit?.double) {
        const first = fed[hit.meal];
        if (ts - first.at > SAME_FEEDING_MS) {
            config.lastDouble = { at: ts, meal: hit.meal, fedAt: first.at };
            save();
            const text = `Attention, Cooper a déjà eu son repas de ${mealLabel(hit.meal)} à ${hm(first.at)}.`;
            journal.log({ kind: 'system', title: `Boîte de Cooper rouverte : déjà nourri à ${hm(first.at)}`, data: { meal: hit.meal } });
            notifier.notify({ text: `⚠️ ${text}` }).catch(() => {});
            say(text);
        }
    } else if (hit) {
        await recordMeal(hit.meal, { at: ts, source: 'boîte', late: Boolean(hit.late) });
    }

    try {
        if (!config.lightOnlyWhenDark || (await isDark())) await showBowl();
        else if (config.lamp) await endLamp();
    } catch (err) {
        console.warn('⚠️  Cooper, lampe:', err.message);
    }
};

const alertLate = async (meal, date) => {
    config.alerted[date] = { ...(config.alerted[date] || {}), [meal.id]: Date.now() };
    save();
    const sensor = getView().sensor;
    const offline = sensor && !sensor.online;
    const text = offline
        ? `🐾 Le capteur des croquettes ne répond plus : je ne sais pas si Cooper a eu son repas de ${meal.label} (prévu à ${hmMin(toMin(meal.time))}).`
        : `🐾 Cooper n'a pas eu son repas de ${meal.label} (prévu à ${hmMin(toMin(meal.time))}). La boîte n'a pas été ouverte.`;
    journal.log({ kind: 'system', title: `Repas de ${meal.label} de Cooper oublié`, data: { meal: meal.id } });
    notifier
        .notify({
            text,
            buttons: [{ label: "✅ C'est fait", run: async () => (await markFed(meal.id, 'Telegram'), `Noté, Cooper a eu son repas de ${meal.label}.`) }],
        })
        .catch(() => {});
    if (!someoneHome()) return;
    say(`Cooper n'a pas encore eu son repas de ${meal.label}.`);
    try {
        await startBlink();
    } catch (err) {
        console.warn('⚠️  Cooper, lampe:', err.message);
    }
};

const tick = async () => {
    if (!config.enabled || !findSensor()) return;
    const { date, minutes } = localParts();
    const fed = todayFed(date);
    for (const meal of config.meals) {
        const start = toMin(meal.time) + config.lateMin;
        if (fed[meal.id] || config.alerted[date]?.[meal.id] || beforeTracking(date, meal, fed)) continue;
        // Fenêtre courte : un redémarrage à 15 h ne déclenche pas une vieille alerte
        if (minutes >= start && minutes <= toMin(meal.to)) await alertLate(meal, date);
    }
};

export const start = () => {
    // Signal interrompu par un redémarrage : le bar reprend son état d'avant
    if (config.lamp) endLamp().catch(() => {});
    bus.on('sensor', ({ sensor, prop, value, ts }) => {
        if (prop !== 'isOpen' || value !== true) return;
        if (sensor.did !== findSensor()?.ieee) return;
        onOpen(ts).catch((err) => console.warn('⚠️  Cooper:', err.message));
    });
    setInterval(() => tick().catch((err) => console.warn('⚠️  Cooper:', err.message)), TICK_MS);
    console.log(`🐾 Repas de Cooper ${config.enabled ? 'suivis' : 'non suivis'}`);
};

// --- API ---

export const getSettings = () => {
    const { days, alerted, lastDouble, lamp, ...rest } = config;
    return rest;
};

export const update = (patch = {}) => {
    for (const key of ['enabled', 'voice', 'lightOnlyWhenDark']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    for (const key of ['lightId', 'sensorDid', 'speaker']) {
        if (patch[key] !== undefined) config[key] = patch[key] === null || patch[key] === '' ? null : String(patch[key]);
    }
    for (const [key, min, max] of [['lateMin', 5, 120], ['blinkMaxMin', 1, 180], ['lightOnOpenMin', 1, 15]]) {
        if (patch[key] === undefined) continue;
        const n = Number(patch[key]);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} invalide`);
        config[key] = n;
    }
    if (!config.enabled && config.lamp) endLamp().catch(() => {});
    save();
    return getSettings();
};

/** Essai depuis l'interface : 20 s de clignotement, ou la lumière de la gamelle. */
export const test = async (kind) => {
    if (kind === 'blink') return startBlink(20_000);
    if (kind === 'bowl') return showBowl();
    throw new Error('Essai inconnu');
};
