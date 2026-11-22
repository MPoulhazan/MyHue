/**
 * Fiche sortie (lot 1 de « Sortie à deux v2 ») : décisions pures, testées dans outingLogic.test.js.
 * Ce que la tâche Claude dépose est nettoyé ici, puis la maison ajoute ce qu'elle sait seule :
 * distance et temps de trajet (sans Google Routes), vélos BIXI, météo du soir, agendas libres.
 */
import { distM, rideMinutes } from './bixiLogic.js';
import { walkMinutes } from './commuteLogic.js';

export const KINDS = ['event', 'cinema', 'concert', 'museum', 'resto', 'activity'];
export const FILTERS = ['all', 'tonight', 'weekend', 'free', 'resto', 'culture'];
const CULTURE = new Set(['event', 'cinema', 'concert', 'museum']);

// L'île de Montréal, large : une coordonnée hors de ce cadre est une erreur de la recherche
const ISLAND = { latMin: 45.38, latMax: 45.72, lonMin: -73.98, lonMax: -73.47 };

const clean = (s, max = 400) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u.trim()) ? u.trim() : null);

/** Identifiant YouTube à partir d'un id nu ou d'une adresse youtube.com / youtu.be. */
export const youtubeId = (v) => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
};

const coord = (lat, lon) => {
    const a = Number(lat);
    const b = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a < ISLAND.latMin || a > ISLAND.latMax || b < ISLAND.lonMin || b > ISLAND.lonMax) return null;
    return { lat: Math.round(a * 1e5) / 1e5, lon: Math.round(b * 1e5) / 1e5 };
};

/**
 * Une idée telle que la tâche Claude la dépose, nettoyée.
 * @param personIds ids des profils connus (champ person des idées de jour de repos)
 */
export const normalizeIdea = (o, i, personIds = [], now = Date.now()) => {
    const at = coord(o.lat, o.lon);
    return {
        id: `o${now}-${i}`,
        kind: KINDS.includes(o.kind) ? o.kind : 'activity',
        title: clean(o.title, 140),
        when: clean(o.when, 80) || null,
        where: clean(o.where, 120) || null,
        why: clean(o.why, 300) || null,
        url: /^https?:\/\//.test(o.url || '') ? o.url : null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : null,
        person: personIds.includes(o.person) ? o.person : null,
        price: clean(o.price, 40) || null,
        free: o.free === true || /^gratuit/i.test(clean(o.price, 40)),
        duration: clean(o.duration, 30) || null,
        times: clean(o.times, 80) || null,
        address: clean(o.address, 120) || null,
        lat: at?.lat ?? null,
        lon: at?.lon ?? null,
        image: https(o.image),
        bookingUrl: https(o.bookingUrl),
        indoor: typeof o.indoor === 'boolean' ? o.indoor : null,
        trailer: youtubeId(o.trailer),
        // Concert : le nom de l'artiste, cherché dans l'écran Musique
        artist: clean(o.artist, 80) || null,
        // Expo, resto : quelques photos pour le diaporama (https, sans doublon, l'image d'abord)
        photos: [...new Set([o.image, ...(Array.isArray(o.photos) ? o.photos : [])].map(https).filter(Boolean))].slice(0, 6),
    };
};

/**
 * Le trajet depuis la maison, estimé sans service de calcul d'itinéraire.
 * @param start station BIXI de départ près de la maison { lat, lon, dist, bikes, name } ou null
 * @param end   station BIXI d'arrivée près du lieu { lat, lon, docks, name } ou null
 * @returns { distM, walk, bike, transit, bikes, startName } ou null sans coordonnées
 */
export const tripTo = (home, place, start = null, end = null) => {
    if (!home || place?.lat == null || place?.lon == null) return null;
    const d = distM(home, place);
    const walk = walkMinutes(d);
    const bike = start && start.bikes > 0 && end && end.docks > 0
        ? walkMinutes(start.dist ?? distM(home, start)) + rideMinutes(start, end) + walkMinutes(distM(end, place)) + 1
        : null;
    // Bus ou métro, porte à porte : marche et attente, puis ~15 km/h de moyenne. Inutile à moins de 1,2 km.
    const transit = d >= 1200 ? Math.round(8 + ((d * 1.3) / 1000 / 15) * 60) : null;
    return {
        distM: d,
        walk,
        bike: bike && bike < walk ? bike : null,
        transit: transit && transit < walk ? transit : null,
        bikes: start?.bikes ?? null,
        startName: start?.name ?? null,
    };
};

/** « 850 m », « 2,4 km » */
export const distLabel = (m) => (m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

const dayOf = (ts, tz) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
const hourOf = (ts, tz) => Number(new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2));
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/**
 * Une sortie en plein air se cache si la soirée prévue est trop mouillée ou trop froide.
 * Sans prévision pour ce jour-là (trop loin), on ne cache rien.
 * @param hours heures de la prévision [{ ts, rainProb, feels, snow }]
 * @returns { hide: boolean, reason: string } ou null
 */
export const weatherCheck = (idea, hours = [], now = Date.now(), tz = 'America/Toronto') => {
    if (idea.indoor !== false) return null;
    const day = idea.date || dayOf(now, tz);
    const evening = hours.filter((h) => dayOf(h.ts, tz) === day && hourOf(h.ts, tz) >= 17 && hourOf(h.ts, tz) <= 22 && h.ts >= now - 3600_000);
    if (!evening.length) return null;
    const rain = Math.max(...evening.map((h) => h.rainProb ?? 0));
    const feels = Math.min(...evening.map((h) => h.feels ?? 0));
    if (rain >= 60) return { hide: true, reason: `pluie probable (${rain} %)` };
    if (feels <= -20) return { hide: true, reason: `trop froid (ressenti ${Math.round(feels)}°)` };
    return { hide: false, reason: '' };
};

/** Une idée passe-t-elle le filtre choisi en haut de la fiche ? */
export const matchesFilter = (idea, filter, now = Date.now(), tz = 'America/Toronto') => {
    const today = dayOf(now, tz);
    const wd = weekday(today);
    switch (filter) {
        case 'tonight':
            // Datée d'aujourd'hui, ou sans date un soir où l'on sort (mercredi à samedi)
            return idea.date ? idea.date === today : wd >= 3;
        case 'weekend': {
            if (!idea.date) return true;
            const d = weekday(idea.date);
            const ahead = (Date.parse(`${idea.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
            return (d === 5 || d === 6) && ahead >= 0 && ahead < 7;
        }
        case 'free':
            return idea.free === true;
        case 'resto':
            return idea.kind === 'resto';
        case 'culture':
            return CULTURE.has(idea.kind);
        default:
            return true;
    }
};

/** Les idées à deux encore valables : ni écartées, ni déjà faites, ni passées, dans l'ordre déposé. */
export const validIdeas = (store, now = Date.now(), tz = 'America/Toronto') => {
    const today = dayOf(now, tz);
    const done = new Set(store.done || []);
    const skipped = new Set(store.skipped || []);
    return (store.outings?.ideas || []).filter((o) => !o.person && !skipped.has(o.id) && !done.has(o.title) && (!o.date || o.date >= today));
};

/** « Vous êtes libres tous les deux samedi soir », d'après les agendas branchés. */
export const freeLine = (idea, evenings = [], calendars = 0) => {
    if (!idea.date || !calendars) return null;
    const e = evenings.find((x) => x.date === idea.date);
    if (!e) return null;
    const day = new Date(`${idea.date}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', timeZone: 'UTC' });
    if (e.free) return calendars > 1 ? `Vous êtes libres tous les deux ${day} soir.` : `Rien à l’agenda ${day} soir.`;
    return `${e.busy.join(' et ')} : déjà pris ${day} soir.`;
};
