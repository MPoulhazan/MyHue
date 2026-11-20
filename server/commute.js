/**
 * Trajet du matin : BIXI, BIXI électrique, bus ou à pied, selon les vélos, la météo et le bus en temps réel.
 *
 * Réglages dans data/commute.json, jamais dans le code (le dépôt est public) :
 *   people: [{ id, who, bixiWho, work: { lat, lon }, days: { '2': '08:00-08:30' }, rest: ['3'],
 *              walkMin?, bus: { label, route, stop, stopName, stopLat, stopLon, alight,
 *                               walkToStopMin, rideMin, walkFromStopMin, weekday: ['07:45', …] } }]
 * Bus en temps réel : flux GTFS-Realtime de la STM (même clé que l'état du métro, dans city.json).
 */
import axios from 'axios';
import protobuf from 'protobufjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { getLocation } from './weather.js';
import * as bixi from './bixi.js';
import * as city from './city.js';
import * as myDay from './myDay.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import { distM, rideMinutes } from './bixiLogic.js';
import { todayPlan, phase, busDepartures, commuteOptions, adviceText, walkMinutes } from './commuteLogic.js';

const FILE = dataFile('commute.json');
const TZ = process.env.TZ || 'America/Toronto';
const RT_URL = 'https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates';
const RT_MAX_AGE = 60_000;
const ALERT_BEFORE_MIN = 20;

const DEFAULTS = { enabled: true, alerts: true, people: [], sent: {} };
let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ commute.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du trajet impossible:', err.message);
    }
};

// --- Bus en temps réel (GTFS-Realtime, juste les champs utiles) ---

const FeedMessage = protobuf.Root.fromJSON({
    nested: {
        FeedMessage: { fields: { header: { id: 1, type: 'FeedHeader' }, entity: { id: 2, rule: 'repeated', type: 'FeedEntity' } } },
        FeedHeader: { fields: { version: { id: 1, type: 'string' }, timestamp: { id: 3, type: 'uint64' } } },
        FeedEntity: { fields: { id: { id: 1, type: 'string' }, tripUpdate: { id: 3, type: 'TripUpdate' } } },
        TripUpdate: { fields: { trip: { id: 1, type: 'TripDescriptor' }, stopTimeUpdate: { id: 2, rule: 'repeated', type: 'StopTimeUpdate' } } },
        TripDescriptor: { fields: { tripId: { id: 1, type: 'string' }, routeId: { id: 5, type: 'string' } } },
        StopTimeUpdate: { fields: { arrival: { id: 2, type: 'StopTimeEvent' }, departure: { id: 3, type: 'StopTimeEvent' }, stopId: { id: 4, type: 'string' } } },
        StopTimeEvent: { fields: { delay: { id: 1, type: 'int32' }, time: { id: 2, type: 'int64' } } },
    },
}).lookupType('FeedMessage');

let rt = { at: 0, byStop: new Map(), error: null };
let rtInflight = null;

const readRealtime = async () => {
    const key = city.stmKey();
    if (!key) {
        rt = { at: Date.now(), byStop: new Map(), error: 'pas de clé STM' };
        return;
    }
    try {
        const { data } = await axios.get(RT_URL, { responseType: 'arraybuffer', timeout: 20_000, headers: { apiKey: key, Accept: 'application/x-protobuf' } });
        const msg = FeedMessage.toObject(FeedMessage.decode(new Uint8Array(data)), { longs: Number });
        const byStop = new Map();
        for (const p of config.people) {
            const b = p.bus;
            if (!b?.stop) continue;
            const list = [];
            for (const e of msg.entity || []) {
                const tu = e.tripUpdate;
                if (!tu || String(tu.trip?.routeId) !== String(b.route)) continue;
                const stops = tu.stopTimeUpdate || [];
                const a = stops.find((s) => s.stopId === b.stop);
                const t = a?.departure?.time || a?.arrival?.time;
                if (!t) continue;
                const z = stops.find((s) => s.stopId === b.alight);
                const tz = z?.arrival?.time || z?.departure?.time;
                list.push({ at: t * 1000, ...(tz > t ? { rideMin: Math.max(1, Math.round((tz - t) / 60)) } : {}) });
            }
            byStop.set(`${b.route}:${b.stop}`, list);
        }
        rt = { at: Date.now(), byStop, error: null };
    } catch (err) {
        const code = err.response?.status;
        rt = { at: Date.now(), byStop: new Map(), error: code === 401 || code === 403 ? 'clé STM refusée pour le temps réel' : err.message };
    }
};

const ensureRealtime = async () => {
    if (Date.now() - rt.at < RT_MAX_AGE) return;
    rtInflight ??= readRealtime().finally(() => (rtInflight = null));
    await rtInflight;
};

// --- Vue ---

/** Minutes écoulées depuis minuit, heure de Montréal. */
const localMin = (now) => {
    const [h, m] = new Date(now).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};

const personOf = (id) => config.people.find((p) => p.id === id) || config.people[0] || null;

/**
 * Le conseil de trajet d'une personne, avec de quoi dessiner la mini-carte.
 * @param id identifiant du profil (people.json) ; par défaut la première personne réglée
 */
export const getView = async (id = null) => {
    const p = personOf(id);
    if (!config.enabled || !p) return { enabled: config.enabled, configured: false };
    const now = Date.now();
    const plan = todayPlan(p, now, TZ);
    const ph = phase(plan, now, TZ);
    const home = await getLocation().catch(() => null);

    const base = {
        enabled: true,
        configured: true,
        person: { id: p.id, who: p.who },
        plan: plan.kind === 'work' ? { kind: 'work', from: plan.from, to: plan.to } : { kind: plan.kind },
        phase: ph,
        updatedAt: now,
    };
    const map = async () => ({
        home: home && { lat: home.lat, lon: home.lon },
        work: p.work,
        stop: p.bus?.stopLat ? { lat: p.bus.stopLat, lon: p.bus.stopLon, name: p.bus.stopName } : null,
        stations: (await bixi.stationsAround(home, 600).catch(() => [])).map(({ id: sid, name, lat, lon, dist, bikes, ebikes, docks }) => ({ id: sid, name, lat, lon, dist, bikes, ebikes, docks })),
    });

    if (plan.kind === 'rest') return { ...base, rest: { idea: myDay.soloIdea(p.id) }, map: await map() };

    // Heure de départ prise en compte : maintenant, ou le début de la fenêtre si on regarde en avance
    const today0 = now - (now % 60_000) - localMin(now) * 60_000;
    const start = plan.kind === 'work' && (ph === 'before' || ph === 'soon') ? today0 + plan.fromMin * 60_000 : now;

    const view = await bixi.getView().catch(() => null);
    const trip = view?.trips?.find((t) => t.who === (p.bixiWho || p.who)) || null;
    const st = (sid) => (sid ? bixi.stationById(sid) : null);
    const dest = st(trip?.to?.id);
    const destWalkMin = dest && p.work ? walkMinutes(distM(dest, p.work)) : 3;
    const eb = st(trip?.ebike?.id);
    const ebikeRideMin = eb && dest ? rideMinutes(eb, dest) : null;
    const walkMin = p.walkMin || (home && p.work ? walkMinutes(distM(home, p.work)) : null);

    let bus = null;
    if (p.bus?.stop) {
        await ensureRealtime();
        const live = rt.byStop.get(`${p.bus.route}:${p.bus.stop}`);
        const weekday = new Date(new Date(now).toLocaleString('en-US', { timeZone: TZ })).getDay();
        const schedule = weekday >= 1 && weekday <= 5 ? p.bus.weekday || [] : [];
        // Le temps réel ne couvre que l'heure qui vient : au-delà, l'horaire prévu
        const useLive = live?.length && start - now < 45 * 60_000;
        bus = { ...p.bus, departures: busDepartures({ realtime: useLive ? live : null, schedule, from: start - p.bus.walkToStopMin * 60_000, tz: TZ, count: 3 }) };
    }

    const verdict = view?.verdict || { level: 'ok', text: '' };
    const { best, options } = commuteOptions({ trip, verdict, destWalkMin, ebikeRideMin, bus, walkMin, start, tz: TZ });
    return {
        ...base,
        start,
        verdict,
        best,
        options,
        text: adviceText(p.who, best, verdict, TZ),
        bus: bus && { label: bus.label, stopName: bus.stopName, departures: bus.departures, realtime: !rt.error && Boolean(rt.byStop.get(`${bus.route}:${bus.stop}`)?.length), error: rt.error },
        map: await map(),
    };
};

/** Réponse de Jean-Claude à « Comment j'y vais ? » */
export const speech = async (id = null) => {
    const v = await getView(id);
    if (!v.configured) return null;
    if (v.plan.kind === 'rest') {
        const idea = v.rest.idea;
        return `${v.person.who}, c’est ton jour de repos.${idea ? ` Une idée : ${idea.title}${idea.where ? `, ${idea.where}` : ''}.` : ''}`;
    }
    return v.text.replace(/ · /g, ', ');
};

// --- Message du matin : une seule fois, 20 min avant la fenêtre, si le BIXI n'est pas la bonne option ---

const checkMorning = async () => {
    if (!config.alerts) return;
    const now = Date.now();
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: TZ });
    for (const p of config.people) {
        const plan = todayPlan(p, now, TZ);
        if (plan.kind !== 'work') continue;
        const m = localMin(now);
        if (m < plan.fromMin - ALERT_BEFORE_MIN || m > plan.toMin) continue;
        if (config.sent[p.id] === today) continue;
        const v = await getView(p.id);
        if (!v.best) continue;
        const worth = v.best.mode !== 'bike' || v.best.warn;
        config.sent[p.id] = today;
        save();
        if (!worth) continue;
        const icon = { bike: '🚲', ebike: '⚡', bus: '🚌', walk: '🚶' }[v.best.mode];
        await notifier.notify({ text: `${icon} ${v.text}${v.best.mode === 'ebike' ? ' 🪖' : ''}` });
        journal.log({ kind: 'system', title: `Trajet : ${v.best.title}`, data: { person: p.id, mode: v.best.mode } });
    }
};

export const start = () => {
    if (!config.enabled || !config.people.length) return console.log('🚌 Trajet : rien de réglé');
    for (const p of config.people) bixi.handleAlertsFor(p.bixiWho || p.who);
    const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    myDay.setRestDaysProvider(() => config.people.filter((p) => p.rest?.length).map((p) => ({ person: p.id, days: p.rest.map((d) => DAYS[Number(d)]) })));
    setInterval(() => checkMorning().catch((err) => console.warn('[Trajet]', err.message)), 60_000).unref?.();
    console.log(`🚌 Trajet : ${config.people.length} personne(s)`);
};

// --- Réglages ---

export const getSettings = () => {
    const { sent, ...rest } = config;
    return structuredClone(rest);
};

const num = (x, min, max, name) => {
    const n = Number(x);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} invalide`);
    return n;
};
const point = (x, name) => (x ? { lat: num(x.lat, 40, 50, `${name}.lat`), lon: num(x.lon, -80, -70, `${name}.lon`) } : null);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const update = (patch = {}) => {
    for (const key of ['enabled', 'alerts']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    if (patch.people !== undefined) {
        if (!Array.isArray(patch.people)) throw new Error('people invalide');
        config.people = patch.people.slice(0, 4).map((p) => {
            if (!p?.id || !p?.who) throw new Error('people : id et who requis');
            const days = {};
            for (const [d, w] of Object.entries(p.days || {})) {
                const [a, b] = String(w).split('-');
                if (!/^[0-6]$/.test(d) || !HHMM.test(a) || !HHMM.test(b)) throw new Error('days { "2": "08:00-08:30" }');
                days[d] = w;
            }
            const b = p.bus;
            return {
                id: String(p.id).slice(0, 24),
                who: String(p.who).slice(0, 24),
                bixiWho: p.bixiWho ? String(p.bixiWho).slice(0, 24) : null,
                work: point(p.work, 'work'),
                days,
                rest: (p.rest || []).map(String).filter((d) => /^[0-6]$/.test(d)),
                walkMin: p.walkMin ? num(p.walkMin, 1, 120, 'walkMin') : null,
                bus: b ? {
                    label: String(b.label || `Bus ${b.route}`).slice(0, 24),
                    route: String(b.route).slice(0, 8),
                    stop: String(b.stop).slice(0, 12),
                    stopName: String(b.stopName || '').slice(0, 60),
                    stopLat: b.stopLat ? num(b.stopLat, 40, 50, 'stopLat') : null,
                    stopLon: b.stopLon ? num(b.stopLon, -80, -70, 'stopLon') : null,
                    alight: b.alight ? String(b.alight).slice(0, 12) : null,
                    walkToStopMin: num(b.walkToStopMin ?? 2, 0, 30, 'walkToStopMin'),
                    rideMin: num(b.rideMin ?? 6, 1, 90, 'rideMin'),
                    walkFromStopMin: num(b.walkFromStopMin ?? 3, 0, 30, 'walkFromStopMin'),
                    weekday: (b.weekday || []).filter((t) => HHMM.test(t)).sort(),
                } : null,
            };
        });
        for (const p of config.people) bixi.handleAlertsFor(p.bixiWho || p.who);
    }
    save();
    rt.at = 0;
    return getSettings();
};
