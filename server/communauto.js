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
import { RADII, DURATIONS, carsWithin, newArrivals, foundText, carLabel, whereLabel, walkLink } from './communautoLogic.js';

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
    search: null, // { radiusM, startedAt, until, by, announced: [ids], found: [car] }
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ communauto.json illisible, réglages par défaut:', err.message);
}
const save = () => {
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

/** Prévient partout : Telegram (avec « J'ai réservé »), enceinte de la cuisine, lampe. */
const tell = async (cars) => {
    const text = foundText(cars);
    const first = cars[0];
    await notifier.notify({
        text: `🚗 ${text}\nItinéraire : ${walkLink(first)}`,
        buttons: [
            { label: '✅ J’ai réservé', run: async () => (stop('Telegram', 'réservée'), 'Super, recherche arrêtée.') },
            { label: '🔎 Continuer', run: async () => 'Je continue de chercher.' },
        ],
    }).catch((err) => console.warn('[Communauto] Telegram :', err.message));
    journal.log({ kind: 'system', title: `Communauto trouvée : ${carLabel(first)}, ${whereLabel(first)}`, data: { cars: cars.map((c) => c.id) } });

    const minutes = localParts(Date.now(), TZ).minutes;
    if (config.voice && presence.anyoneHome() !== false && minutes >= 7 * 60 && minutes < 23 * 60) {
        const speaker = await kitchenSpeaker();
        if (speaker) await announce([speaker], text, { volume: 0.6 }).catch((err) => console.warn('[Communauto] voix :', err.message));
    }
    if (config.lamp) await lightSignals.pulse(['communauto'], 'Communauto').catch((err) => console.warn('[Communauto] lampe :', err.message));
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
    const fresh = newArrivals(cars, s.announced);
    if (!fresh.length) return save();
    for (const c of fresh.slice(0, 3)) c.street = await streetOf(c);
    s.announced.push(...fresh.map((c) => c.id));
    s.found = [...fresh, ...s.found].slice(0, 6);
    save();
    // Sans attendre : la lampe respire 15 s, la réponse à la carte ou à la voix part tout de suite
    tell(fresh).catch((err) => console.warn('[Communauto] annonce :', err.message));
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
export const startSearch = async ({ radiusM, durationMin, by = 'MyHue' } = {}) => {
    const r = Number(radiusM ?? config.radiusM);
    const d = Number(durationMin ?? config.durationMin);
    if (!Number.isFinite(r) || r < 100 || r > 2000) throw new Error('rayon invalide (100 à 2000 m)');
    if (!Number.isFinite(d) || d < 5 || d > 240) throw new Error('durée invalide (5 à 240 min)');
    config.radiusM = Math.round(r);
    config.durationMin = Math.round(d);
    const now = Date.now();
    config.search = { radiusM: config.radiusM, startedAt: now, until: now + config.durationMin * 60_000, by, announced: [], found: [] };
    save();
    journal.log({ kind: 'system', title: `Recherche Communauto lancée (${config.radiusM} m, ${config.durationMin} min, ${by})` });
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

const strip = ({ lat, lon, ...c }) => ({ ...c, walk: walkLink({ lat, lon }) });

export const getView = async ({ fresh = false } = {}) => {
    await ensureFresh(isActive() ? SEARCH_EVERY_MS : fresh ? 15_000 : IDLE_MAX_AGE_MS);
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
            found: s.found.map(strip),
        },
    };
};

// --- Réglages ---

export const getSettings = () => {
    const { search, ...rest } = config;
    return structuredClone(rest);
};

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
