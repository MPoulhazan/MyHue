/**
 * Communauto Flex : trouver une auto libre autour de la maison.
 *
 * Flux public de Communauto (sans compte, ~90 Ko compressé) : toutes les autos Flex
 * libres de Montréal avec leur position. On ne réserve rien : on prévient
 * (Telegram, enceinte de la cuisine, lampe signal) et la réservation se fait dans l'appli.
 *
 * Recherche lancée à la main (carte, voix, Telegram) : relecture toutes les 20 s
 * jusqu'à « J'ai réservé » ou la fin du délai. Hors recherche, la carte lit le flux
 * au plus une fois par minute, seulement quand on la regarde.
 *
 * Réglages et recherche en cours dans data/communauto.json (la maison vient de
 * weather.getLocation : jamais d'adresse dans le code, le dépôt est public).
 */
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { getLocation } from './weather.js';
import { localParts } from './cooper.js';
import { announce, getSpeakers } from './briefing.js';
import * as notifier from './notifier.js';
import * as presence from './presence.js';
import * as journal from './journal.js';
import * as lightSignals from './lightSignals.js';
import { RADII, DURATIONS, carsWithin, newArrivals, foundText, carLabel, whereLabel, walkLink, carAppLink } from './communautoLogic.js';
import { weekCount } from './communautoAppLogic.js';
import * as app from './communautoApp.js';

const FILE = dataFile('communauto.json');
const TZ = process.env.TZ || 'America/Toronto';
const FEED = 'https://www.reservauto.net/WCF/LSI/LSIBookingServiceV3.svc/GetAvailableVehicles?BranchID=1&LanguageID=2';
const SEARCH_EVERY_MS = 20_000;
const IDLE_MAX_AGE_MS = 60_000;
// Assez loin pour la carte au repos, même quand on cherche dans un petit rayon
const NEARBY_MAX = 6;

const DEFAULTS = {
    radiusM: 500, // dernier rayon choisi
    durationMin: 30, // durée d'une recherche
    voice: true, // annonce sur l'enceinte de la cuisine si quelqu'un est là
    lamp: true, // la lampe signal respire en vert
    search: null, // { radiusM, startedAt, until, by, autoBook, announced: [ids], found: [car] }
    tablet: null, // { host, port } : la tablette murale, pilotée par ADB pour bloquer une Flex
    bookings: [], // horodatages des Flex bloquées par MyHue (30 jours)
    lastBooking: null, // { car, at, until } : la Flex bloquée en ce moment
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ communauto.json illisible, réglages par défaut:', err.message);
}
app.setTarget(config.tablet);

const save = () => {
    if (config.tablet) config.tablet.port = app.currentTarget()?.port ?? config.tablet.port; // le port change après une réactivation
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde Communauto impossible:', err.message);
    }
};

// --- Lecture du flux ---

let feed = { at: 0, vehicles: [], error: null };
let inflight = null;

const refresh = async () => {
    try {
        const { data } = await axios.get(FEED, { timeout: 15_000, headers: { 'User-Agent': 'MyHue-home/1.0' } });
        if (!data?.d?.Success || !Array.isArray(data.d.Vehicles)) throw new Error('réponse inattendue');
        feed = { at: Date.now(), vehicles: data.d.Vehicles, error: null };
    } catch (err) {
        feed = { ...feed, error: err.message };
        console.warn('[Communauto]', err.message);
    }
};

const ensureFresh = async (maxAgeMs) => {
    if (Date.now() - feed.at < maxAgeMs) return;
    inflight ??= refresh().finally(() => (inflight = null));
    await inflight;
};

// --- Nom de rue (OpenStreetMap), seulement pour une auto trouvée ---

const streets = new Map(); // « lat,lon » arrondis → rue
const streetOf = async (car) => {
    const key = `${car.lat.toFixed(4)},${car.lon.toFixed(4)}`;
    if (streets.has(key)) return streets.get(key);
    try {
        const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: { lat: car.lat, lon: car.lon, format: 'jsonv2', zoom: 17, 'accept-language': 'fr' },
            headers: { 'User-Agent': 'MyHue-home/1.0' },
            timeout: 8_000,
        });
        const a = data?.address || {};
        const street = a.road || a.pedestrian || a.residential || null;
        streets.set(key, street);
        return street;
    } catch {
        return null;
    }
};

// --- Recherche ---

const isActive = (now = Date.now()) => Boolean(config.search && config.search.until > now);

const kitchenSpeaker = async () => {
    const speakers = await getSpeakers().catch(() => []);
    return speakers.find((s) => s.available && (/cuisine|kitchen/i.test(s.name) || /cuisine|kitchen/i.test(s.id)))?.id || null;
};

const speak = async (text) => {
    const minutes = localParts(Date.now(), TZ).minutes;
    if (!config.voice || presence.anyoneHome() === false || minutes < 7 * 60 || minutes >= 23 * 60) return;
    const speaker = await kitchenSpeaker();
    if (speaker) await announce([speaker], text, { volume: 0.6 }).catch((err) => console.warn('[Communauto] voix :', err.message));
};

/** Prévient partout : Telegram (avec « J'ai réservé »), enceinte de la cuisine, lampe. */
const tell = async (cars, note = '') => {
    const text = foundText(cars);
    const first = cars[0];
    await notifier.notify({
        text: `🚗 ${text}${note ? `\n(${note})` : ''}\nItinéraire : ${walkLink(first)}`,
        buttons: [
            { label: '✅ J’ai réservé', run: async () => (stop('Telegram', 'réservée'), 'Super, recherche arrêtée.') },
            { label: '🔎 Continuer', run: async () => 'Je continue de chercher.' },
        ],
    }).catch((err) => console.warn('[Communauto] Telegram :', err.message));
    journal.log({ kind: 'system', title: `Communauto trouvée : ${carLabel(first)}, ${whereLabel(first)}`, data: { cars: cars.map((c) => c.id) } });
    await speak(text);
    if (config.lamp) await lightSignals.pulse(['communauto'], 'Communauto').catch((err) => console.warn('[Communauto] lampe :', err.message));
};

// --- Réservation automatique (appli pilotée sur la tablette) ---

const BLOCK_MS = 30 * 60_000; // une Flex bloquée attend 30 min
const WEEK_WARN = 5; // au-delà, un avertissement « pas abuser », jamais un refus
let booking = false;

const bookedText = (car, count) => {
    const warn = count >= WEEK_WARN ? `\n⚠️ Ça fait ${count} Flex bloquées en 7 jours, on y va mollo.` : '';
    return `✅ Communauto bloquée pour toi : ${carLabel(car)}, ${whereLabel(car)}. Tu as 30 min pour la rejoindre.${warn}`;
};

/** Essaie de bloquer les autos trouvées, de la plus proche à la plus loin ; sinon alerte simple. */
const tryBook = async (cars) => {
    booking = true;
    try {
        let failure = null;
        for (const car of cars.slice(0, 3)) {
            const res = await app.block(car.id);
            if (res.ok) {
                const now = Date.now();
                config.bookings = [...(config.bookings || []).filter((t) => now - t < 30 * 24 * 3600_000), now];
                config.lastBooking = { car, at: now, until: now + BLOCK_MS };
                config.search = null;
                save();
                schedule();
                const count = weekCount(config.bookings, now);
                journal.log({ kind: 'system', title: `Communauto bloquée automatiquement : ${carLabel(car)}, ${whereLabel(car)} (${count} en 7 jours)` });
                await notifier.notify({
                    text: `${bookedText(car, count)}\nItinéraire : ${walkLink(car)}`,
                    buttons: [{ label: '❌ Annuler le blocage', run: async () => (await cancelBooking('Telegram'), 'Blocage annulé.') }],
                }).catch((err) => console.warn('[Communauto] Telegram :', err.message));
                await speak(`J’ai bloqué une Communauto : ${carLabel(car)}, ${whereLabel(car)}. Tu as 30 minutes.`);
                if (config.lamp) await lightSignals.pulse(['communauto'], 'Communauto bloquée').catch(() => {});
                return;
            }
            failure = res;
            console.warn(`[Communauto] blocage de ${car.id} impossible : ${res.reason} (${res.detail})`);
            if (res.reason !== 'gone') break; // tablette ou écran : inutile d'essayer la suivante
        }
        // Toutes prises avant qu'on les bloque : rien à annoncer, la recherche continue
        if (failure && failure.reason !== 'gone') await tell(cars, `je n’ai pas pu la bloquer : ${failure.detail}`);
    } finally {
        booking = false;
    }
};

/** Annule dans l'appli le blocage fait par MyHue. */
export const cancelBooking = async (by = 'MyHue') => {
    await app.cancelBlock();
    const car = config.lastBooking?.car;
    config.lastBooking = null;
    save();
    journal.log({ kind: 'system', title: `Blocage Communauto annulé${car ? ` : ${carLabel(car)}` : ''} (${by})` });
    return getView();
};

// Une seule relecture à la fois : l'annonce peut durer plus que l'intervalle
let checking = null;
const check = () => (checking ??= doCheck().finally(() => (checking = null)));

const doCheck = async () => {
    const s = config.search;
    if (!s) return;
    if (!isActive()) {
        const found = s.found.some((c) => !c.gone);
        config.search = null;
        save();
        journal.log({ kind: 'system', title: `Recherche Communauto terminée${found ? '' : ', aucune auto trouvée'}` });
        if (!found) await notifier.notify({ text: `🚗 Recherche Communauto terminée : aucune auto à moins de ${s.radiusM} m.`, silent: true }).catch(() => {});
        return;
    }
    await ensureFresh(SEARCH_EVERY_MS - 2_000);
    if (!feed.at) return;
    const home = await getLocation();
    const cars = carsWithin(feed.vehicles, home, s.radiusM);
    const here = new Set(cars.map((c) => c.id));

    // Les autos déjà trouvées qui ne sont plus libres : quelqu'un d'autre les a prises
    for (const c of s.found) c.gone = !here.has(c.id);
    if (booking) return save(); // la tablette est en train de bloquer une auto
    const fresh = newArrivals(cars, s.announced);
    if (!fresh.length) return save();
    for (const c of fresh.slice(0, 3)) c.street = await streetOf(c);
    s.announced.push(...fresh.map((c) => c.id));
    s.found = [...fresh, ...s.found].slice(0, 6);
    save();
    // Sans attendre : la tablette met ~15 s à bloquer, la lampe respire 15 s ;
    // la réponse à la carte ou à la voix part tout de suite
    if (s.autoBook && config.tablet?.host) tryBook(fresh).catch((err) => console.warn('[Communauto] blocage :', err.message));
    else tell(fresh).catch((err) => console.warn('[Communauto] annonce :', err.message));
};

let timer = null;
const schedule = () => {
    clearInterval(timer);
    timer = null;
    if (!config.search) return;
    timer = setInterval(() => check().catch((err) => console.warn('[Communauto]', err.message)), SEARCH_EVERY_MS);
    timer.unref?.();
};

/** Lance (ou relance) une recherche ; une auto déjà dans le rayon est annoncée tout de suite. */
export const startSearch = async ({ radiusM, durationMin, autoBook = false, by = 'MyHue' } = {}) => {
    if (autoBook && !config.tablet?.host) throw new Error('la tablette n’est pas appairée pour réserver');
    if (autoBook && config.lastBooking) {
        await ensureFresh(15_000);
        checkBookingStillHeld();
        if (config.lastBooking && config.lastBooking.until > Date.now()) throw new Error('une Flex est déjà bloquée');
    }
    const r = Number(radiusM ?? config.radiusM);
    const d = Number(durationMin ?? config.durationMin);
    if (!Number.isFinite(r) || r < 100 || r > 2000) throw new Error('rayon invalide (100 à 2000 m)');
    if (!Number.isFinite(d) || d < 5 || d > 240) throw new Error('durée invalide (5 à 240 min)');
    config.radiusM = Math.round(r);
    config.durationMin = Math.round(d);
    const now = Date.now();
    config.search = { radiusM: config.radiusM, startedAt: now, until: now + config.durationMin * 60_000, by, autoBook: Boolean(autoBook), announced: [], found: [] };
    save();
    journal.log({ kind: 'system', title: `Recherche Communauto lancée (${config.radiusM} m, ${config.durationMin} min${autoBook ? ', réservation auto' : ''}, ${by})` });
    feed.at = 0; // relire tout de suite
    await check();
    schedule();
    return getView();
};

export const stop = (by = 'MyHue', why = 'arrêtée') => {
    if (!config.search) return getView();
    config.search = null;
    save();
    schedule();
    journal.log({ kind: 'system', title: `Recherche Communauto ${why} (${by})` });
    return getView();
};

export const start = () => {
    if (config.search && !isActive()) {
        config.search = null;
        save();
    }
    schedule();
    if (config.search) console.log(`🚗 Communauto : recherche reprise (${config.search.radiusM} m)`);
};

// --- Vue ---

const strip = ({ lat, lon, ...c }) => ({ ...c, walk: walkLink({ lat, lon }), app: carAppLink(c.id) });

/**
 * Blocage annulé ailleurs (téléphone, appli) : l'auto redevient libre dans le flux public.
 * Une auto bloquée ou en course n'y figure pas ; on laisse 2 min au flux pour se mettre à jour.
 */
const BLOCK_FEED_LAG_MS = 2 * 60_000;
const checkBookingStillHeld = () => {
    const b = config.lastBooking;
    if (!b || !feed.at || feed.at < b.at + BLOCK_FEED_LAG_MS) return;
    if (b.until <= Date.now() || feed.vehicles.some((v) => String(v.CarId) === b.car.id)) {
        if (b.until > Date.now()) journal.log({ kind: 'system', title: `Blocage Communauto annulé ailleurs : ${carLabel(b.car)} est de nouveau libre` });
        config.lastBooking = null;
        save();
    }
};

export const getView = async ({ fresh = false } = {}) => {
    await ensureFresh(isActive() ? SEARCH_EVERY_MS : fresh || config.lastBooking ? 15_000 : IDLE_MAX_AGE_MS);
    checkBookingStillHeld();
    const home = await getLocation().catch(() => null);
    const s = isActive() ? config.search : null;
    const radiusM = s?.radiusM ?? config.radiusM;
    const nearby = home && feed.at ? carsWithin(feed.vehicles, home, radiusM).slice(0, NEARBY_MAX).map(strip) : [];
    return {
        updatedAt: feed.at || null,
        error: feed.error,
        radiusM,
        durationMin: config.durationMin,
        radii: RADII,
        durations: DURATIONS,
        nearby,
        search: s && {
            active: true,
            radiusM: s.radiusM,
            startedAt: s.startedAt,
            until: s.until,
            by: s.by,
            autoBook: Boolean(s.autoBook),
            found: s.found.map(strip),
        },
        // Réservation automatique : possible si la tablette est appairée
        canAutoBook: Boolean(config.tablet?.host),
        booking,
        booked: config.lastBooking && config.lastBooking.until > Date.now() ? { ...config.lastBooking, car: strip(config.lastBooking.car) } : null,
        weekCount: weekCount(config.bookings),
        weekWarn: WEEK_WARN,
    };
};

// --- Réglages ---

export const getSettings = () => {
    const { search, lastBooking, ...rest } = config;
    return structuredClone(rest);
};

/** Appaire la tablette (code de « Pair device with pairing code »), puis s'y connecte. */
export const pairTablet = async ({ host, pairPort, code, port }) => {
    const out = await app.pair({ host, pairPort, code });
    config.tablet = { host, port: Number(port) || null };
    app.setTarget(config.tablet);
    await app.connect().catch(() => null); // le port de connexion se trouve en mDNS s'il n'est pas donné
    save();
    return { paired: out, ...(await app.status()) };
};

export const tabletStatus = () => app.status();

export const update = (patch = {}) => {
    for (const key of ['voice', 'lamp']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    if (patch.radiusM !== undefined) {
        const n = Number(patch.radiusM);
        if (!Number.isFinite(n) || n < 100 || n > 2000) throw new Error('rayon invalide (100 à 2000 m)');
        config.radiusM = Math.round(n);
    }
    if (patch.durationMin !== undefined) {
        const n = Number(patch.durationMin);
        if (!Number.isFinite(n) || n < 5 || n > 240) throw new Error('durée invalide (5 à 240 min)');
        config.durationMin = Math.round(n);
    }
    save();
    return getSettings();
};
