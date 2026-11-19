/**
 * Heure de départ des rendez-vous de l'agenda : itinéraire en transport en commun depuis la maison
 * (Google Routes API, clé GOOGLE_MAPS_API_KEY dans les options de l'add-on), pour arriver
 * quelques minutes en avance. Un rappel Telegram part 10 minutes avant l'heure de départ.
 */
import axios from 'axios';
import { getLocation } from './weather.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import { MARGIN_MIN, needsRoute, parseRoute } from './departureLogic.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELDS = 'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails';
const TICK_MS = 60_000;
const REMIND_MIN = 10;
const TZ = process.env.TZ || 'America/Toronto';

// clé d'événement -> { at (calcul), departure | null, error }
const cache = new Map();
const reminded = new Set();
let getEvents = () => [];

export const isConfigured = () => Boolean(KEY);
const keyOf = (e) => `${e.start}|${e.location}`;
const hm = (ts) => new Date(ts).toLocaleTimeString('fr-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).replace(':', ' h ').replace(' h 00', ' h');

/** Un calcul reste bon 6 h, mais 20 min seulement quand le départ approche (horaires en temps réel). */
const stale = (entry, e, now) => {
    if (!entry) return true;
    const soon = e.start - now < 2 * 3600_000;
    return now - entry.at > (soon ? 20 * 60_000 : 6 * 3600_000);
};

const compute = async (e) => {
    const home = await getLocation();
    const arriveBy = e.start - MARGIN_MIN * 60_000;
    const { data } = await axios.post(URL, {
        origin: { location: { latLng: { latitude: home.lat, longitude: home.lon } } },
        destination: { address: e.location },
        travelMode: 'TRANSIT',
        arrivalTime: new Date(arriveBy).toISOString(),
        languageCode: 'fr-CA',
        regionCode: 'CA',
    }, {
        headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS },
        timeout: 15_000,
    });
    return parseRoute(data, arriveBy);
};

/** Départ connu pour un rendez-vous (null : pas de lieu, pas encore calculé, ou introuvable). */
export const forEvent = (e) => cache.get(keyOf(e))?.departure ?? null;

const refresh = async (now = Date.now()) => {
    if (!KEY) return;
    const events = getEvents().filter((e) => needsRoute(e, now));
    for (const e of events.slice(0, 6)) {
        const k = keyOf(e);
        if (!stale(cache.get(k), e, now)) continue;
        try {
            cache.set(k, { at: now, departure: await compute(e), error: null });
        } catch (err) {
            const msg = err.response?.data?.error?.message || err.message;
            cache.set(k, { at: now, departure: cache.get(k)?.departure ?? null, error: msg });
            console.warn('[Départ]', msg);
        }
    }
    // Rappel 10 min avant de partir
    for (const e of events) {
        const d = forEvent(e);
        const k = keyOf(e);
        if (!d || !e.remind || reminded.has(k)) continue;
        const left = d.at - now;
        if (left <= REMIND_MIN * 60_000 && left > -5 * 60_000) {
            reminded.add(k);
            const text = `🚶 ${e.title} à ${hm(e.start)} : pars à ${hm(d.at)}${d.via ? ` (${d.via})` : ''}.`;
            notifier.notify({ text }).catch(() => {});
            journal.log({ kind: 'system', title: `Rappel de départ : ${e.title}` });
        }
    }
    for (const k of cache.keys()) if (Number(k.split('|')[0]) < now - 3600_000) cache.delete(k);
};

export const getStatus = () => ({ configured: Boolean(KEY), routes: [...cache.values()].map(({ at, departure, error }) => ({ at, ok: Boolean(departure), error })) });

/** @param eventsGetter () => rendez-vous du jour (profil suivi), avec start, location, allDay, title */
export const start = (eventsGetter) => {
    getEvents = eventsGetter;
    if (!KEY) return console.log('🚌 Heure de départ : pas de clé Google Maps');
    setTimeout(() => refresh().catch(() => {}), 20_000);
    setInterval(() => refresh().catch(() => {}), TICK_MS).unref?.();
    console.log('🚌 Heure de départ active (Google Routes)');
};
