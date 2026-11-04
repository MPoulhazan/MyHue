/**
 * Boîte aux lettres : le capteur d'ouverture dit si le facteur est passé.
 *
 * - Facteur ou nous ? On ne sort que par la porte d'entrée : si elle s'ouvre dans les
 *   4 min avant ou après la boîte, c'est nous qui relevons le courrier. Sinon, le facteur.
 *   Il faut donc attendre 4 min avant d'annoncer son passage.
 * - Passage du facteur : Telegram (« C'était moi », « Relevé »), le bar de la cuisine en
 *   jaune La Poste tant que le courrier attend (7 h – 21 h 30, si quelqu'un est là).
 * - Retour à la maison avec du courrier qui attend : annonce sur l'enceinte de la cuisine.
 * - Ouverture la nuit (22 h – 6 h) sans passer par la porte d'entrée : alerte tout de suite.
 * - L'heure habituelle du facteur est apprise des derniers passages.
 * - Capteur dehors : s'il se tait par grand froid, la pile a sûrement gelé.
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
import * as cooper from './cooper.js';
import { getForecast } from './weather.js';
import { getSensors } from './sensors.js';
import { announce, getSpeakers } from './briefing.js';
import { toMin, localParts, hm } from './cooper.js';
import { bus } from './events.js';

const FILE = dataFile('mailbox.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 30_000;
const KEEP_DAYS = 60;
const SAME_OPENING_MS = 90_000; // le couvercle qui retombe, un colis après les lettres
const ANNOUNCE_AFTER_MS = 45_000;
const NIGHT_SHOWN_MS = 10 * 3600_000;
const COLD_C = -10;
// Jaune La Poste sur une lampe couleur ; blanc très chaud sinon
const YELLOW = { on: true, bri: 180, xy: [0.445, 0.49] };
const YELLOW_CT = { on: true, bri: 180, ct: 454 };

const DEFAULTS = {
    enabled: true,
    sensorDid: null, // null = capteur du registre dont le nom parle de lettres ou de courrier
    entranceWindowMin: 4,
    nightFrom: '22:00',
    nightTo: '06:00',
    lamp: true,
    lampFrom: '07:00',
    lampUntil: '21:30',
    voice: true,
    events: [], // { at, kind: 'delivery'|'pickup'|'night', source }
    waiting: null, // { since, count } : courrier dans la boîte
    pending: null, // { at, nightAlerted } : boîte ouverte, facteur ou nous ?
    announcedFor: null, // `waiting.since` déjà annoncé au retour
    lampState: null, // { id, before, color, for } : le bar en jaune
    lampDismissedFor: null, // quelqu'un a changé le bar : on le laisse pour ce courrier-là
    nightDismissedAt: null,
    frozenAlertAt: null,
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ mailbox.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la boîte aux lettres impossible:', err.message);
    }
};

// --- Décisions (testées dans mailbox.test.js) ---

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const weekdayOf = (ts, tz = TZ) => new Date(new Date(ts).toLocaleString('en-US', { timeZone: tz })).getDay();
const hmMin = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;

/** Plage de nuit qui peut passer minuit (22 h – 6 h). */
export const isNight = (minutes, from = DEFAULTS.nightFrom, to = DEFAULTS.nightTo) => {
    const f = toMin(from);
    const t = toMin(to);
    return f > t ? minutes >= f || minutes < t : minutes >= f && minutes < t;
};

/** Ouverture de la boîte peu après la porte d'entrée : c'est nous qui sortons relever le courrier. */
export const openedByUs = (openAt, lastEntranceAt, windowMs) =>
    Boolean(lastEntranceAt) && openAt >= lastEntranceAt && openAt - lastEntranceAt <= windowMs;

/**
 * Heure habituelle du facteur : médiane du premier passage de chaque jour (45 derniers jours),
 * arrondie au quart d'heure ; null tant qu'on n'a pas 3 jours.
 */
export const usualTime = (events, now = Date.now(), tz = TZ) => {
    const firstOfDay = new Map();
    for (const e of events) {
        if (e.kind !== 'delivery' || now - e.at > 45 * 86_400_000) continue;
        const { date, minutes } = localParts(e.at, tz);
        if (!firstOfDay.has(date) || minutes < firstOfDay.get(date)) firstOfDay.set(date, minutes);
    }
    const mins = [...firstOfDay.values()].sort((a, b) => a - b);
    if (mins.length < 3) return null;
    const mid = mins.length % 2 ? mins[(mins.length - 1) / 2] : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2;
    return Math.round(mid / 15) * 15;
};

/** « 13 h 42 », « hier à 13 h 42 », « lundi » */
export const since = (ts, now = Date.now(), tz = TZ) => {
    const days = Math.round((Date.parse(localParts(now, tz).date) - Date.parse(localParts(ts, tz).date)) / 86_400_000);
    if (days <= 0) return hm(ts, tz);
    if (days === 1) return `hier, ${hm(ts, tz)}`;
    return WEEKDAYS[weekdayOf(ts, tz)];
};

/**
 * Ce que dit le visiteur dans sa bulle.
 * @param view { waiting, today: { delivery, pickup }, pending, night, usual, online, frozen }
 * @returns {{ mood: 'mail'|'pending'|'night'|'off'|'done'|'empty', line: string }}
 */
export const mailLine = (view, now = Date.now(), tz = TZ) => {
    const { minutes } = localParts(now, tz);
    if (view.night) return { mood: 'night', line: `Mais qu'est-ce que c'est que ce binz ? On a ouvert la boîte à ${hm(view.night.at, tz)}, en pleine nuit !` };
    if (view.pending) return { mood: 'pending', line: 'Quelqu’un ouvre la boîte… serait-ce le facteur ?' };
    if (view.waiting) {
        const more = view.waiting.count > 1 ? ` Le facteur est passé ${view.waiting.count} fois.` : '';
        return { mood: 'mail', line: `Okayyy ! Une missive vous attend depuis ${since(view.waiting.since, now, tz)}.${more}` };
    }
    if (!view.online) {
        return view.frozen
            ? { mood: 'off', line: 'Brrr… je ne sens plus la boîte. La pile a dû geler, c’est dingue !' }
            : { mood: 'off', line: 'Je ne sens plus la boîte aux lettres : le capteur ne répond plus.' };
    }
    const { delivery, pickup } = view.today;
    if (delivery && pickup && pickup > delivery) return { mood: 'done', line: `C'est relevé, messire ! Le facteur était passé à ${hm(delivery, tz)}.` };
    const weekday = weekdayOf(now, tz);
    if (weekday === 0 || weekday === 6) return { mood: 'empty', line: `Point de facteur le ${WEEKDAYS[weekday]}, messire. Repos !` };
    if (minutes >= 17 * 60) return { mood: 'empty', line: 'Point de missive ce jour. Le facteur n’est point passé.' };
    if (view.usual != null) return { mood: 'empty', line: `Point de missive pour l'heure. Le facteur passe d'habitude vers ${hmMin(view.usual)}.` };
    return { mood: 'empty', line: 'Point de missive pour l’heure. Je guette le facteur.' };
};

/** Réponse de Jarvis à « Est-ce que le courrier est passé ? ». */
export const mailSpeech = (view, now = Date.now(), tz = TZ) => {
    if (!view.sensor) return "Je n'ai pas de capteur sur la boîte aux lettres.";
    if (view.waiting) {
        const n = view.waiting.count > 1 ? ` Il est passé ${view.waiting.count} fois.` : '';
        const sameDay = localParts(view.waiting.since, tz).date === localParts(now, tz).date;
        return `Oui, le facteur est passé ${sameDay ? 'à ' : ''}${since(view.waiting.since, now, tz)}, et le courrier n'est pas encore relevé.${n}`;
    }
    const { delivery, pickup } = view.today;
    if (delivery) return `Oui, le facteur est passé à ${hm(delivery, tz)}${pickup && pickup > delivery ? ` et le courrier a été relevé à ${hm(pickup, tz)}` : ''}.`;
    const weekday = weekdayOf(now, tz);
    if (weekday === 0 || weekday === 6) return "Non, pas de facteur la fin de semaine.";
    return `Non, le facteur n'est pas encore passé aujourd'hui.${view.usual != null ? ` Il passe d'habitude vers ${hmMin(view.usual)}.` : ''}`;
};

export const isMailQuestion = (text) => /courrier|facteur|bo[iî]te aux lettres|bo[iî]te à lettres/i.test(text);

/** Ligne du briefing du matin : le courrier d'hier n'a pas été relevé. */
export const briefingLine = (view, now = Date.now(), tz = TZ) => {
    if (!view.waiting || localParts(view.waiting.since, tz).date === localParts(now, tz).date) return null;
    return `Du courrier attend dans la boîte aux lettres depuis ${since(view.waiting.since, now, tz)}.`;
};

// --- Capteurs ---

const findSensor = () => {
    const all = sensorRegistry.getAll();
    if (config.sensorDid) return all.find((s) => s.ieee === config.sensorDid) || null;
    return all.find((s) => /lettre|courrier|mailbox|facteur/i.test(s.name)) || null;
};
const findEntrance = () => sensorRegistry.getAll().find((s) => s.type === 'door' && sensorRegistry.isEntrance(s.name)) || null;

const deviceOf = (sensor) => sensor && zigbeeService.getDevices().find((x) => x.ieeeAddr === sensor.ieee);
let battery = null; // dernière valeur connue, mise à jour par le flux des capteurs
let outdoorC = null;

// --- Vue ---

const todayEvents = (now = Date.now()) => {
    const today = localParts(now).date;
    return config.events.filter((e) => localParts(e.at).date === today);
};

export const getView = (now = Date.now()) => {
    const sensor = findSensor();
    const device = deviceOf(sensor);
    const online = device ? device.available !== false : false;
    const events = todayEvents(now);
    const last = (kind) => events.filter((e) => e.kind === kind).at(-1)?.at ?? null;
    const lastNight = config.events.filter((e) => e.kind === 'night').at(-1);
    const night = lastNight && now - lastNight.at < NIGHT_SHOWN_MS && (config.nightDismissedAt ?? 0) < lastNight.at ? { at: lastNight.at } : null;
    const view = {
        waiting: config.waiting,
        today: { delivery: last('delivery'), pickup: last('pickup') },
        pending: Boolean(config.pending),
        night,
        usual: usualTime(config.events, now),
        online,
        frozen: online === false && outdoorC != null && outdoorC <= COLD_C,
    };
    return {
        enabled: config.enabled,
        sensor: sensor ? { did: sensor.ieee, name: sensor.name, online, battery } : null,
        entrance: Boolean(findEntrance()),
        ...view,
        ...mailLine(view, now),
        lamp: Boolean(config.lampState),
    };
};

/** Passages des derniers jours (résumé de la semaine). */
export const getHistory = () => ({ events: config.events, usual: usualTime(config.events) });

// --- Enceinte et bar ---

const kitchenSpeaker = async () => {
    const speakers = await getSpeakers();
    return speakers.find((s) => s.available && (/cuisine|kitchen/i.test(s.name) || /cuisine|kitchen/i.test(s.id)))?.id || null;
};

const say = async (message) => {
    if (!config.voice || !haService.isConfigured()) return;
    try {
        const speaker = await kitchenSpeaker();
        if (speaker) await announce([speaker], message, { volume: 0.6 });
    } catch (err) {
        console.warn('⚠️  Boîte aux lettres, enceinte:', err.message);
    }
};

// null = on ne sait pas (HA Companion absent) : on fait comme si quelqu'un était là
const someoneHome = () => presence.anyoneHome() !== false;

const putLight = (id, state) => hueClient.put(`/lights/${id}/state`, state);
const isYellow = (s, color) =>
    s.on && (color
        ? s.colormode === 'xy' && Math.abs(s.xy[0] - YELLOW.xy[0]) < 0.03 && Math.abs(s.xy[1] - YELLOW.xy[1]) < 0.03
        : s.colormode === 'ct' && Math.abs(s.ct - YELLOW_CT.ct) <= 8) && Math.abs(s.bri - YELLOW.bri) <= 5;

const wantLamp = (now = Date.now()) => {
    const { minutes } = localParts(now);
    return config.enabled && config.lamp && Boolean(hueBaseUrl) && Boolean(config.waiting)
        && config.lampDismissedFor !== config.waiting.since
        && minutes >= toMin(config.lampFrom) && minutes < toMin(config.lampUntil)
        && someoneHome() && !alarm.anyActive() && !cooper.lampBusy();
};

let lampBusy = false;
const lightLamp = async () => {
    const id = await cooper.pickBarLight();
    if (!id) return;
    const { data } = await hueClient.get(`/lights/${id}`);
    const color = Boolean(data.state.xy);
    config.lampState = { id, before: data.state, color, for: config.waiting.since };
    save();
    await putLight(id, { ...(color ? YELLOW : YELLOW_CT), transitiontime: 20 });
};

/** Remet le bar comme avant, sauf si quelqu'un l'a changé entre-temps. */
const releaseLamp = async () => {
    const lamp = config.lampState;
    if (!lamp) return;
    config.lampState = null;
    save();
    try {
        const { data } = await hueClient.get(`/lights/${lamp.id}`);
        if (isYellow(data.state, lamp.color)) await restoreLight(lamp.id, lamp.before);
    } catch (err) {
        console.warn('⚠️  Boîte aux lettres, lampe:', err.message);
    }
};

const syncLamp = async () => {
    if (lampBusy) return;
    lampBusy = true;
    try {
        const want = wantLamp();
        if (want && !config.lampState) await lightLamp();
        else if (!want && config.lampState) await releaseLamp();
        else if (config.lampState) {
            // Le bar a été changé à la main : on n'y touche plus pour ce courrier
            const { data } = await hueClient.get(`/lights/${config.lampState.id}`);
            if (data.state.reachable !== false && !isYellow(data.state, config.lampState.color)) {
                config.lampDismissedFor = config.lampState.for;
                config.lampState = null;
                save();
            }
        }
    } catch (err) {
        console.warn('⚠️  Boîte aux lettres, lampe:', err.message);
    } finally {
        lampBusy = false;
    }
};

// --- Passages ---

const prune = () => {
    const limit = Date.now() - KEEP_DAYS * 86_400_000;
    config.events = config.events.filter((e) => e.at >= limit);
};

const record = (kind, at, source) => {
    config.events.push({ at, kind, source });
    config.events.sort((a, b) => a.at - b.at);
    prune();
};

/** Courrier relevé (boîte ouverte par nous, carte, Telegram). */
export const markCollected = async (at = Date.now(), source = 'bouton') => {
    record('pickup', at, source);
    const had = config.waiting;
    config.waiting = null;
    save();
    journal.log({ kind: 'system', title: `Courrier relevé (${hm(at)})`, data: { source } });
    if (had) syncLamp();
    return getView();
};

/** « C'était moi » sur un passage du facteur : c'était nous qui relevions le courrier. */
const undoDelivery = async (at) => {
    config.events = config.events.filter((e) => !(e.kind === 'delivery' && e.at === at));
    if (config.waiting) {
        const left = (config.waiting.count || 1) - 1;
        config.waiting = left > 0 ? { ...config.waiting, count: left } : null;
    }
    record('pickup', at, 'Telegram');
    save();
    syncLamp();
};

export const dismissNight = () => {
    config.nightDismissedAt = Date.now();
    save();
    return getView();
};

const onDelivery = async (at) => {
    const { minutes } = localParts(at);
    if (isNight(minutes, config.nightFrom, config.nightTo)) {
        record('night', at, 'boîte');
        save();
        journal.log({ kind: 'system', title: `Boîte aux lettres ouverte la nuit (${hm(at)})`, data: {} });
        return;
    }
    record('delivery', at, 'boîte');
    config.waiting = config.waiting ? { ...config.waiting, count: (config.waiting.count || 1) + 1 } : { since: at, count: 1 };
    save();
    journal.log({ kind: 'system', title: `Le facteur est passé (${hm(at)})`, data: {} });
    notifier
        .notify({
            text: `📬 Okayyy ! Le facteur est passé à ${hm(at)}.`,
            buttons: [
                { label: '🙋 C’était moi', run: async () => (await undoDelivery(at), 'Noté, c’était toi.') },
                { label: '✅ Relevé', run: async () => (await markCollected(Date.now(), 'Telegram'), 'Noté, courrier relevé.') },
            ],
        })
        .catch(() => {});
    syncLamp();
};

const nightAlert = (at) => {
    if (config.pending) config.pending.nightAlerted = true;
    save();
    notifier
        .notify({
            text: `🌙 La boîte aux lettres vient de s'ouvrir à ${hm(at)}, sans passage par la porte d'entrée.`,
            buttons: [{ label: '🙋 C’était moi', run: async () => (dismissNight(), 'Noté, fausse alerte.') }],
        })
        .catch(() => {});
};

let pendingTimer = null;
let lastOpen = 0;
let lastEntrance = 0;

const windowMs = () => config.entranceWindowMin * 60_000;

const resolvePending = async () => {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const p = config.pending;
    if (!p) return;
    config.pending = null;
    save();
    await onDelivery(p.at);
};

const onMailboxOpen = async (ts) => {
    if (!config.enabled) return;
    if (ts - lastOpen < SAME_OPENING_MS) return;
    lastOpen = ts;
    if (openedByUs(ts, lastEntrance, windowMs())) return markCollected(ts, 'boîte');
    if (config.pending) return;
    config.pending = { at: ts };
    save();
    if (isNight(localParts(ts).minutes, config.nightFrom, config.nightTo)) nightAlert(ts);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => resolvePending().catch((err) => console.warn('⚠️  Boîte aux lettres:', err.message)), windowMs());
};

let announceTimer = null;
const onEntranceOpen = async (ts) => {
    lastEntrance = ts;
    if (!config.enabled) return;
    // Boîte ouverte juste avant : c'est nous qui rentrons avec le courrier
    const p = config.pending;
    if (p && ts - p.at <= windowMs()) {
        clearTimeout(pendingTimer);
        config.pending = null;
        save();
        if (p.nightAlerted) {
            dismissNight();
            notifier.notify({ text: '✅ Fausse alerte : la porte d’entrée s’est ouverte juste après, c’était sûrement toi.', silent: true }).catch(() => {});
        }
        return markCollected(p.at, 'boîte');
    }
    // Retour à la maison avec du courrier qui attend : une annonce par passage du facteur
    const w = config.waiting;
    const { minutes } = localParts(ts);
    if (!w || config.announcedFor === w.since || minutes < 7 * 60 || minutes >= 22 * 60) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
        if (config.waiting?.since !== w.since || config.pending || !someoneHome()) return;
        config.announcedFor = w.since;
        save();
        say(`Okayyy ! Du courrier vous attend dans la boîte aux lettres depuis ${since(w.since)}.`);
    }, ANNOUNCE_AFTER_MS);
};

// --- Pile et froid ---

const checkFrozen = async () => {
    const sensor = findSensor();
    if (!sensor) return;
    try {
        outdoorC = (await getForecast()).current?.temperature_2m ?? outdoorC;
    } catch { /* météo indisponible : on garde la dernière valeur */ }
    try {
        const s = (await getSensors()).find((x) => x.did === sensor.ieee);
        if (s?.props?.battery != null) battery = s.props.battery;
    } catch { /* capteurs indisponibles */ }
    const online = deviceOf(sensor)?.available !== false;
    const weak = !online || (battery != null && battery <= 10);
    if (!weak) {
        if (config.frozenAlertAt) {
            config.frozenAlertAt = null;
            save();
        }
        return;
    }
    if (config.frozenAlertAt || outdoorC == null || outdoorC > COLD_C) return;
    config.frozenAlertAt = Date.now();
    save();
    const what = online ? `sa pile est à ${battery} %` : 'elle ne répond plus';
    notifier
        .notify({ text: `🥶 La boîte aux lettres a gelé ? Il fait ${Math.round(outdoorC)} ° dehors et ${what}. La pile (CR1632) revient souvent au redoux ; sinon, une pile au lithium tient mieux le froid.`, silent: true })
        .catch(() => {});
};

// --- Démarrage ---

export const start = () => {
    // Bar resté jaune après un redémarrage : il reprend son état d'avant, puis le suivi décide
    if (config.lampState) releaseLamp().catch(() => {});
    // Boîte ouverte juste avant un redémarrage : on finit la décision
    if (config.pending) {
        const left = Math.max(0, config.pending.at + windowMs() - Date.now());
        pendingTimer = setTimeout(() => resolvePending().catch(() => {}), left);
    }
    // Le bar passe à Cooper : on rend son état d'avant d'abord, le jaune reviendra après
    cooper.setLampYield(async () => {
        await releaseLamp();
    });
    bus.on('sensor', ({ sensor, prop, value, ts }) => {
        if (prop === 'battery' && sensor.did === findSensor()?.ieee) battery = value;
        if (prop !== 'isOpen' || value !== true) return;
        if (sensor.did === findSensor()?.ieee) onMailboxOpen(ts ?? Date.now()).catch((err) => console.warn('⚠️  Boîte aux lettres:', err.message));
        else if (sensor.did === findEntrance()?.ieee) onEntranceOpen(ts ?? Date.now()).catch((err) => console.warn('⚠️  Boîte aux lettres:', err.message));
    });
    setInterval(() => syncLamp(), TICK_MS);
    setInterval(() => checkFrozen().catch(() => {}), 30 * 60_000);
    setTimeout(() => checkFrozen().catch(() => {}), 60_000);
    console.log(`📬 Boîte aux lettres ${config.enabled ? 'suivie' : 'non suivie'}`);
};

// --- API ---

export const getSettings = () => {
    const { events, waiting, pending, announcedFor, lampState, lampDismissedFor, nightDismissedAt, frozenAlertAt, ...rest } = config;
    return rest;
};

export const update = (patch = {}) => {
    for (const key of ['enabled', 'voice', 'lamp']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    if (patch.sensorDid !== undefined) config.sensorDid = patch.sensorDid ? String(patch.sensorDid) : null;
    for (const key of ['nightFrom', 'nightTo', 'lampFrom', 'lampUntil']) {
        if (patch[key] === undefined) continue;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[key])) throw new Error(`${key} invalide`);
        config[key] = patch[key];
    }
    if (patch.entranceWindowMin !== undefined) {
        const n = Number(patch.entranceWindowMin);
        if (!Number.isFinite(n) || n < 1 || n > 15) throw new Error('entranceWindowMin invalide');
        config.entranceWindowMin = n;
    }
    save();
    syncLamp();
    return getSettings();
};

/** Essai depuis l'interface : le bar 20 s en jaune. */
export const test = async () => {
    if (!hueBaseUrl) throw new Error('Pont Hue non configuré');
    const id = await cooper.pickBarLight();
    if (!id) throw new Error('Lampe du bar introuvable');
    const { data } = await hueClient.get(`/lights/${id}`);
    const before = data.state;
    await putLight(id, { ...(before.xy ? YELLOW : YELLOW_CT), transitiontime: 10 });
    setTimeout(() => restoreLight(id, before).catch(() => {}), 20_000);
};
