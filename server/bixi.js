/**
 * BIXI : les vélos classiques autour de la maison et les places libres à l'arrivée de chacun.
 *
 * Flux GBFS public (sans clé). Lecture selon l'heure, pour ne pas tirer 300 Ko sans raison :
 * chaque minute pendant la fenêtre de départ en semaine, toutes les 10 min de 6 h à 23 h,
 * rien la nuit. La liste des stations (noms, positions) est relue une fois par jour.
 *
 * Réglages dans data/bixi.json (jamais dans le code : le dépôt est public) :
 *   homeStations: ids GBFS des stations favorites, dans l'ordre
 *   commuters: [{ who, dest: [ids GBFS, de la préférée à la secours] }]
 */
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { getForecast, getLocation } from './weather.js';
import { localParts, toMin } from './cooper.js';
import * as notifier from './notifier.js';
import * as presence from './presence.js';
import * as journal from './journal.js';
import * as lightSignals from './lightSignals.js';
import { distM, classicBikes, freeDocks, trend, rideMinutes, assignStarts, pickDest, bikeVerdict, departureAlerts } from './bixiLogic.js';

const FILE = dataFile('bixi.json');
const TZ = process.env.TZ || 'America/Toronto';
const GBFS = 'https://gbfs.velobixi.com/gbfs/gbfs.json';
const TICK_MS = 60_000;
const INFO_MAX_AGE = 24 * 3600_000;
const SAMPLE_KEEP_MS = 20 * 60_000;

const DEFAULTS = {
    enabled: true,
    homeStations: [],
    commuters: [],
    leaveFrom: '08:00',
    leaveTo: '08:30',
    extrasRadiusM: 500,
    alerts: true, // Telegram dans la fenêtre de départ
    lamp: true, // la lampe signal respire en rouge BIXI
    alertsBeforeMin: 20, // les alertes commencent 20 min avant leaveFrom
    seasonFrom: null, // 'MM-JJ' : on reprend le BIXI ce jour-là (null = toute l'année)
    seasonTo: null, // 'MM-JJ' : dernier jour de BIXI, ensuite métro
    sent: { date: null, keys: [] }, // alertes déjà envoyées aujourd'hui
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ bixi.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde BIXI impossible:', err.message);
    }
};

let feeds = null; // { info, status }
let info = { at: 0, byId: new Map() };
let status = { at: 0, byId: new Map() };
const samples = new Map(); // id → [{ at, bikes }]
let inflight = null;

// --- Lecture du flux ---

const feedUrls = async () => {
    if (feeds) return feeds;
    const { data } = await axios.get(GBFS, { timeout: 10_000 });
    const list = (data.data.fr || data.data.en).feeds;
    const url = (n) => list.find((f) => f.name === n)?.url;
    feeds = { info: url('station_information'), status: url('station_status') };
    return feeds;
};

const refresh = async () => {
    const urls = await feedUrls();
    if (Date.now() - info.at > INFO_MAX_AGE) {
        const { data } = await axios.get(urls.info, { timeout: 15_000 });
        info = { at: Date.now(), byId: new Map(data.data.stations.map((s) => [String(s.station_id), s])) };
    }
    const { data } = await axios.get(urls.status, { timeout: 15_000 });
    status = { at: Date.now(), byId: new Map(data.data.stations.map((s) => [String(s.station_id), s])) };
    for (const id of config.homeStations.map(String)) {
        const bikes = classicBikes(status.byId.get(id));
        if (bikes == null) continue;
        const list = (samples.get(id) || []).filter((s) => status.at - s.at < SAMPLE_KEEP_MS);
        list.push({ at: status.at, bikes });
        samples.set(id, list);
    }
};

/** Relit le flux s'il a plus de `maxAgeMs` ; une seule lecture à la fois. */
export const ensureFresh = async (maxAgeMs = 60_000) => {
    if (!config.enabled || !config.homeStations.length || !inSeason()) return;
    if (Date.now() - status.at < maxAgeMs) return;
    inflight ??= refresh().catch((err) => console.warn('[BIXI]', err.message)).finally(() => (inflight = null));
    await inflight;
};

// --- Saison : hors saison, ni lecture, ni alertes, ni carte (le métro prend le relais) ---

/** Le BIXI fait-il partie des trajets en ce moment ? */
export const inSeason = (now = Date.now()) => {
    if (!config.seasonFrom || !config.seasonTo) return true;
    const md = localParts(now, TZ).date.slice(5);
    return config.seasonFrom <= config.seasonTo
        ? md >= config.seasonFrom && md <= config.seasonTo
        : md >= config.seasonFrom || md <= config.seasonTo;
};

// --- Fenêtres horaires ---

const isWeekday = (now) => {
    const day = new Date(new Date(now).toLocaleString('en-US', { timeZone: TZ })).getDay();
    return day >= 1 && day <= 5;
};

/** Fenêtre de départ du matin (en semaine), élargie de 30 min avant pour voir venir. */
export const inLeaveWindow = (now = Date.now()) => {
    if (!isWeekday(now)) return false;
    const m = localParts(now, TZ).minutes;
    return m >= toMin(config.leaveFrom) - 30 && m <= toMin(config.leaveTo) + 30;
};

/** Âge maximal des données selon l'heure : 1 min au départ, 10 min le jour, rien la nuit. */
const maxAge = (now = Date.now()) => {
    if (inLeaveWindow(now)) return 60_000;
    const m = localParts(now, TZ).minutes;
    return m >= 6 * 60 && m < 23 * 60 ? 10 * 60_000 : Infinity;
};

// --- Alertes du matin ---

/** De 20 min avant le départ jusqu'à la fin de la fenêtre, en semaine. */
const inAlertWindow = (now = Date.now()) => {
    if (!isWeekday(now)) return false;
    const m = localParts(now, TZ).minutes;
    return m >= toMin(config.leaveFrom) - config.alertsBeforeMin && m <= toMin(config.leaveTo);
};

let shortage = false; // vélos à sec en ce moment, pour la lampe au départ

const checkAlerts = async () => {
    const now = Date.now();
    if (!inAlertWindow(now) || !inSeason(now)) {
        shortage = false;
        return;
    }
    const view = await getView();
    const alerts = departureAlerts(view);
    shortage = alerts.some((a) => a.key === 'bikes');
    if (!config.alerts || presence.anyoneHome() === false) return;
    const today = localParts(now, TZ).date;
    if (config.sent.date !== today) config.sent = { date: today, keys: [] };
    const fresh = alerts.filter((a) => !config.sent.keys.includes(a.key));
    if (!fresh.length) return;
    config.sent.keys.push(...fresh.map((a) => a.key));
    save();
    for (const a of fresh) {
        await notifier.notify({ text: a.text, silent: a.key.startsWith('docks') });
        journal.log({ kind: 'system', title: a.text.replace(/^S+s/, 'BIXI : '), data: { key: a.key } });
    }
    if (config.lamp && fresh.some((a) => a.lamp)) await lightSignals.pulse(['bixi'], 'BIXI').catch((err) => console.warn('[BIXI] lampe :', err.message));
};

export const start = () => {
    if (!config.enabled) return console.log('🚲 BIXI désactivé');
    lightSignals.addSource(() => (config.lamp && shortage && inAlertWindow() ? ['bixi'] : []));
    const tick = () => {
        const age = maxAge();
        if (age !== Infinity) ensureFresh(age - 5_000).then(checkAlerts).catch((err) => console.warn('[BIXI] alertes :', err.message));
    };
    tick();
    setInterval(tick, TICK_MS).unref?.();
    console.log(`🚲 BIXI : ${config.homeStations.length} station(s) suivie(s)`);
};

// --- Vue ---

let weatherCache = { at: 0, verdict: null };
const verdict = async () => {
    if (Date.now() - weatherCache.at < 5 * 60_000 && weatherCache.verdict) return weatherCache.verdict;
    const forecast = await getForecast().catch(() => null);
    weatherCache = { at: Date.now(), verdict: bikeVerdict(forecast?.hours || []) };
    return weatherCache.verdict;
};

const station = (id, from) => {
    const s = info.byId.get(String(id));
    if (!s) return null;
    const st = status.byId.get(String(id));
    return {
        id: String(id),
        name: s.name.replace(/\s+/g, ' ').trim(),
        lat: s.lat,
        lon: s.lon,
        capacity: s.capacity ?? null,
        dist: from ? distM(from, s) : null,
        bikes: classicBikes(st),
        docks: freeDocks(st),
        installed: Boolean(st?.is_installed),
    };
};

export const getView = async ({ fresh = false } = {}) => {
    const now = Date.now();
    await ensureFresh(fresh ? 60_000 : Math.min(maxAge(now), 10 * 60_000));
    const configured = config.homeStations.length > 0;
    const base = { enabled: config.enabled, configured, window: inLeaveWindow(now), leaveFrom: config.leaveFrom, leaveTo: config.leaveTo };
    if (!inSeason(now)) return { ...base, season: 'closed', updatedAt: status.at || null, home: [], trips: [], extras: [], verdict: await verdict() };
    if (!configured || !status.at) return { ...base, season: 'open', updatedAt: status.at || null, home: [], trips: [], extras: [], verdict: await verdict() };

    const loc = await getLocation().catch(() => null);
    const homeIds = new Set(config.homeStations.map(String));
    const home = config.homeStations.map((id) => station(id, loc)).filter(Boolean)
        .map((s) => ({ ...s, trend: trend(samples.get(s.id), now) }));
    const extras = loc
        ? [...info.byId.keys()].filter((id) => !homeIds.has(id)).map((id) => station(id, loc))
            .filter((s) => s && s.dist <= config.extrasRadiusM && s.bikes != null).sort((a, b) => a.dist - b.dist)
        : [];
    const season = home.some((s) => s.installed) || extras.length ? 'open' : 'closed';

    const starts = assignStarts(home.filter((s) => s.bikes != null), extras, config.commuters.length);
    const trips = config.commuters.map((c, i) => {
        const from = starts[i];
        const to = pickDest((c.dest || []).map((id) => station(id)).filter(Boolean));
        return {
            who: c.who,
            from: from && { id: from.id, name: from.name, dist: from.dist, bikes: from.bikes, scarce: from.scarce, fallback: from.fallback, trend: home.find((h) => h.id === from.id)?.trend ?? null },
            to: to && { id: to.id, name: to.name, docks: to.docks, low: to.low, alt: to.alt },
            rideMin: from && to ? rideMinutes(from, to) : null,
        };
    });
    const used = new Set(trips.map((t) => t.from?.id));
    const strip = ({ lat, lon, ...s }) => s;
    return {
        ...base,
        season,
        updatedAt: status.at,
        verdict: await verdict(),
        home: home.map(strip),
        trips,
        // Pour la ligne du bas : les autres stations favorites et la plus proche bien garnie
        extras: [...home.filter((s) => !used.has(s.id)), ...extras.filter((s) => s.bikes >= 5).slice(0, 1)].map(strip).slice(0, 3),
    };
};

// --- Réglages ---

export const getSettings = () => {
    const { sent, ...rest } = config;
    return structuredClone(rest);
};

const ids = (list) => {
    if (!Array.isArray(list) || list.some((x) => !/^\d+$/.test(String(x)))) throw new Error('ids de station invalides');
    return list.map(String);
};

export const update = (patch = {}) => {
    for (const key of ['enabled', 'alerts', 'lamp']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    if (patch.alertsBeforeMin !== undefined) {
        const n = Number(patch.alertsBeforeMin);
        if (!Number.isFinite(n) || n < 0 || n > 90) throw new Error('alertsBeforeMin invalide');
        config.alertsBeforeMin = n;
    }
    if (patch.homeStations !== undefined) config.homeStations = ids(patch.homeStations).slice(0, 5);
    if (patch.commuters !== undefined) {
        if (!Array.isArray(patch.commuters)) throw new Error('commuters invalide');
        config.commuters = patch.commuters.slice(0, 4).map((c) => {
            if (!c?.who) throw new Error('commuters : « who » requis');
            return { who: String(c.who).slice(0, 24), dest: ids(c.dest || []).slice(0, 4) };
        });
    }
    for (const key of ['seasonFrom', 'seasonTo']) {
        if (patch[key] === undefined) continue;
        if (patch[key] !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]d|3[01])$/.test(patch[key])) throw new Error(`${key} invalide (MM-JJ)`);
        config[key] = patch[key];
    }
    for (const key of ['leaveFrom', 'leaveTo']) {
        if (patch[key] === undefined) continue;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[key])) throw new Error(`${key} invalide`);
        config[key] = patch[key];
    }
    if (patch.extrasRadiusM !== undefined) {
        const n = Number(patch.extrasRadiusM);
        if (!Number.isFinite(n) || n < 100 || n > 1500) throw new Error('extrasRadiusM invalide');
        config.extrasRadiusM = n;
    }
    save();
    status.at = 0; // nouvelles stations : relire tout de suite
    return getSettings();
};
