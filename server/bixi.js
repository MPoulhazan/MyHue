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

// --- Saison : chacun la sienne. Hors saison pour tout le monde : ni lecture, ni alertes, ni carte ---
//
// commuter.season : absent = la saison de la maison (seasonFrom / seasonTo),
// null = toute l'année, { from: 'MM-JJ', to: 'MM-JJ' } = la sienne.

const seasonOk = (from, to, now) => {
    if (!from || !to) return true;
    const md = localParts(now, TZ).date.slice(5);
    return from <= to ? md >= from && md <= to : md >= from || md <= to;
};

const commuterInSeason = (c, now) => {
    if (c.season === null) return true;
    if (c.season) return seasonOk(c.season.from, c.season.to, now);
    return seasonOk(config.seasonFrom, config.seasonTo, now);
};

/** Les personnes qui prennent le BIXI en ce moment de l'année. */
const activeCommuters = (now = Date.now()) => config.commuters.filter((c) => commuterInSeason(c, now));

/** Le BIXI fait-il partie des trajets de quelqu'un en ce moment ? */
export const inSeason = (now = Date.now()) =>
    config.commuters.length ? activeCommuters(now).length > 0 : seasonOk(config.seasonFrom, config.seasonTo, now);

/** Quelqu'un a-t-il rangé son vélo pour l'hiver ? (la carte Métro s'affiche alors pour lui) */
export const someoneOffSeason = (now = Date.now()) =>
    config.commuters.length ? config.commuters.some((c) => !commuterInSeason(c, now)) : !inSeason(now);

// --- Fenêtres horaires ---
//
// commuter.days : absent = en semaine, de leaveFrom à leaveTo ;
// sinon { '1': '08:00-08:30', '2': … } par jour (0 = dimanche), un jour absent = pas de trajet.

const localDow = (now) => new Date(new Date(now).toLocaleString('en-US', { timeZone: TZ })).getDay();

/** Fenêtre de départ d'une personne aujourd'hui, en minutes, ou null. */
export const leaveWindowOf = (c, now = Date.now()) => {
    const dow = localDow(now);
    if (c?.days) {
        const w = c.days[String(dow)];
        if (!w) return null;
        const [from, to] = w.split('-');
        return { from, to, fromMin: toMin(from), toMin: toMin(to) };
    }
    if (dow < 1 || dow > 5) return null;
    return { from: config.leaveFrom, to: config.leaveTo, fromMin: toMin(config.leaveFrom), toMin: toMin(config.leaveTo) };
};

const windowsNow = (now, before, after) => {
    const m = localParts(now, TZ).minutes;
    return activeCommuters(now).filter((c) => {
        const w = leaveWindowOf(c, now);
        return w && m >= w.fromMin - before && m <= w.toMin + after;
    });
};

/** Fenêtre de départ de quelqu'un, élargie de 30 min de chaque côté pour voir venir. */
export const inLeaveWindow = (now = Date.now()) => windowsNow(now, 30, 30).length > 0;

/** Âge maximal des données selon l'heure : 1 min au départ, 10 min le jour, rien la nuit. */
const maxAge = (now = Date.now()) => {
    if (inLeaveWindow(now)) return 60_000;
    const m = localParts(now, TZ).minutes;
    return m >= 6 * 60 && m < 23 * 60 ? 10 * 60_000 : Infinity;
};

// --- Alertes du matin ---

/** De 20 min avant le départ de quelqu'un jusqu'à la fin de sa fenêtre. */
const inAlertWindow = (now = Date.now()) => windowsNow(now, config.alertsBeforeMin, 0).length > 0;

let shortage = false; // vélos à sec en ce moment, pour la lampe au départ

// Les personnes dont le trajet du matin est conseillé ailleurs (commute.js) : pas de Telegram BIXI en double
const handled = new Set();
export const handleAlertsFor = (who) => handled.add(who);

const checkAlerts = async () => {
    const now = Date.now();
    if (!inAlertWindow(now) || !inSeason(now)) {
        shortage = false;
        return;
    }
    const view = await getView();
    const leaving = windowsNow(now, config.alertsBeforeMin, 0).map((c) => c.who);
    const alerts = departureAlerts(view);
    shortage = alerts.some((a) => a.key === 'bikes');
    if (!config.alerts || leaving.every((who) => handled.has(who))) return;
    if (presence.anyoneHome() === false) return;
    const today = localParts(now, TZ).date;
    if (config.sent.date !== today) config.sent = { date: today, keys: [] };
    const fresh = alerts.filter((a) => !config.sent.keys.includes(a.key) && !handled.has(a.key.split(':')[1]));
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
        ebikes: classicBikes(st) == null ? null : st.num_ebikes_available || 0,
        docks: freeDocks(st),
        installed: Boolean(st?.is_installed),
    };
};

export const getView = async ({ fresh = false } = {}) => {
    const now = Date.now();
    await ensureFresh(fresh ? 60_000 : Math.min(maxAge(now), 10 * 60_000));
    const configured = config.homeStations.length > 0;
    const riders = activeCommuters(now);
    // Le titre de la carte : la fenêtre de départ du premier qui part aujourd'hui
    const firstWindow = riders.map((c) => leaveWindowOf(c, now)).find(Boolean);
    const base = { enabled: config.enabled, configured, window: inLeaveWindow(now), leaveFrom: firstWindow?.from || config.leaveFrom, leaveTo: firstWindow?.to || config.leaveTo };
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

    const starts = assignStarts(home.filter((s) => s.bikes != null), extras, riders.length);
    // En secours : la station la plus proche avec un vélo électrique
    const ebikeAt = [...home, ...extras].filter((s) => s.ebikes > 0).sort((a, b) => a.dist - b.dist)[0] || null;
    const trips = riders.map((c, i) => {
        const from = starts[i];
        const to = pickDest((c.dest || []).map((id) => station(id)).filter(Boolean));
        const leave = leaveWindowOf(c, now);
        return {
            who: c.who,
            leave: leave && { from: leave.from, to: leave.to },
            from: from && { id: from.id, name: from.name, dist: from.dist, bikes: from.bikes, ebikes: from.ebikes, scarce: from.scarce, fallback: from.fallback, trend: home.find((h) => h.id === from.id)?.trend ?? null },
            to: to && { id: to.id, name: to.name, docks: to.docks, low: to.low, alt: to.alt },
            ebike: ebikeAt && { id: ebikeAt.id, name: ebikeAt.name, dist: ebikeAt.dist, ebikes: ebikeAt.ebikes },
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

/** Position et état d'une station (pour le conseil de trajet et la mini-carte). */
export const stationById = (id) => station(id);

/**
 * Les stations ouvertes autour d'un point, avec leurs vélos, pour la mini-carte.
 * @returns [{ id, name, lat, lon, dist, bikes, ebikes, docks }] triées par distance
 */
export const stationsAround = async (point, radiusM = 600) => {
    await ensureFresh(maxAge() === Infinity ? 10 * 60_000 : maxAge());
    if (!point) return [];
    return [...info.byId.keys()].map((id) => station(id, point)).filter((s) => s && s.bikes != null && s.dist <= radiusM).sort((a, b) => a.dist - b.dist);
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
        const md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
        const win = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
        config.commuters = patch.commuters.slice(0, 4).map((c) => {
            if (!c?.who) throw new Error('commuters : « who » requis');
            const out = { who: String(c.who).slice(0, 24), dest: ids(c.dest || []).slice(0, 4) };
            if (c.season === null) out.season = null;
            else if (c.season !== undefined) {
                if (!md.test(c.season?.from) || !md.test(c.season?.to)) throw new Error('commuters : season { from, to } en MM-JJ');
                out.season = { from: c.season.from, to: c.season.to };
            }
            if (c.days) {
                out.days = {};
                for (const [d, w] of Object.entries(c.days)) {
                    if (!/^[0-6]$/.test(d) || !win.test(w)) throw new Error('commuters : days { "1": "08:00-08:30" }');
                    out.days[d] = w;
                }
            }
            return out;
        });
    }
    for (const key of ['seasonFrom', 'seasonTo']) {
        if (patch[key] === undefined) continue;
        if (patch[key] !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(patch[key])) throw new Error(`${key} invalide (MM-JJ)`);
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
