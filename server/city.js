/**
 * Alertes de la ville : météo dangereuse (Environnement Canada + verglas prévu par Open-Meteo),
 * avis de la Ville de Montréal pour notre quartier (ébullition, coupure d'eau, rue fermée)
 * et événements ajoutés à la main (marathon, festivals…).
 *
 * Danger : Telegram avec son, lampe signal, écran d'alerte sur la tablette jusqu'à « J'ai vu ».
 * À prévoir : Telegram silencieux (la veille à 19 h pour les événements à date fixe).
 * Info : la carte « En ville » et le briefing.
 *
 * Réglages dans data/city.json (le dépôt est public : jamais les rues du quartier dans le code).
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
import * as bixi from './bixi.js';
import { fromEccc, icePreview, fromCityNotices, fromManual, fromStm, merge, whenLabel, bucket, telegramText, weekendText, briefingLine as line, lampKind } from './cityLogic.js';

const FILE = dataFile('city.json');
const TZ = process.env.TZ || 'America/Toronto';
const ECCC = 'https://api.weather.gc.ca/collections/weather-alerts/items';
const NOTICES = 'https://donnees.montreal.ca/api/3/action/datastore_search';
const NOTICES_RESOURCE = 'fc6e5f85-7eba-451c-8243-bdf35c2ab336'; // « Avis et alertes »
const STM = 'https://api.stm.info/pub/od/i3/v2/messages/etatservice';
const TICK_MS = 60_000;
const AGE = { eccc: 10 * 60_000, ville: 30 * 60_000, meteo: 15 * 60_000, stm: 3 * 60_000 };
const UA = { 'User-Agent': 'MyHue (domotique maison)' };

const DEFAULTS = {
    enabled: true,
    areas: [], // arrondissements suivis dans les avis de la Ville
    streets: [], // rues du quartier : un avis qui les nomme devient grave
    events: [], // { id, title, date, endDate?, from?, to?, level?, detail?, advice? }
    telegram: true,
    lamp: true,
    takeover: true, // écran d'alerte sur la tablette
    dayFrom: '07:00', // en dehors : messages silencieux, pas de lampe
    dayTo: '22:00',
    // Métro : clé gratuite du portail développeurs STM, lignes suivies, alertes au départ en semaine
    stmKey: null,
    metroLines: ['2'],
    metroStation: null,
    commuteFrom: '07:40',
    commuteTo: '08:30',
    sent: {}, // id → envoyé le (ms)
    acked: [], // dangers déjà vus sur la tablette
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ city.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des alertes de la ville impossible:', err.message);
    }
};

const sources = {
    eccc: { at: 0, ok: null, events: [] },
    ville: { at: 0, ok: null, events: [], records: [] },
    meteo: { at: 0, ok: null, events: [] },
    stm: { at: 0, ok: null, events: [], status: [], error: null },
};

// Autres modules qui ajoutent des lignes à la carte (la collecte du soir) : () => [événements]
const extra = [];
export const addSource = (fn) => extra.push(fn);
const extraEvents = () => extra.flatMap((fn) => {
    try {
        return fn() || [];
    } catch {
        return [];
    }
});

const read = async (key, fn) => {
    const s = sources[key];
    if (Date.now() - s.at < AGE[key]) return;
    s.at = Date.now();
    try {
        await fn(s);
        s.ok = true;
    } catch (err) {
        s.ok = false;
        console.warn(`[Ville] ${key} :`, err.message);
    }
};

const refresh = async () => {
    const loc = await getLocation().catch(() => null);
    await Promise.all([
        loc && read('eccc', async (s) => {
            const d = 0.02;
            const { data } = await axios.get(ECCC, { timeout: 15_000, headers: UA, params: { f: 'json', lang: 'fr', limit: 50, bbox: [loc.lon - d, loc.lat - d, loc.lon + d, loc.lat + d].join(',') } });
            s.events = fromEccc(data.features || []);
        }),
        read('ville', async (s) => {
            const { data } = await axios.get(NOTICES, { timeout: 20_000, headers: UA, params: { resource_id: NOTICES_RESOURCE, limit: 300, sort: 'date_debut desc' } });
            s.records = data.result?.records || [];
        }),
        config.stmKey && read('stm', async (s) => {
            try {
                const { data } = await axios.get(STM, { timeout: 15_000, headers: { apiKey: config.stmKey, Accept: 'application/json' } });
                Object.assign(s, fromStm(data, config.metroLines), { error: null });
            } catch (err) {
                s.error = err.response?.status === 400 || err.response?.status === 401 ? 'clé STM refusée' : err.message;
                throw err;
            }
        }),
        read('meteo', async (s) => {
            const forecast = await getForecast();
            s.events = [icePreview(forecast?.hours || [])].filter(Boolean);
        }),
    ]);
};

/** Tous les événements en cours ou à venir, du plus grave au moins grave. */
export const getEvents = (now = Date.now()) => merge([
    sources.eccc.events,
    sources.meteo.events,
    fromCityNotices(sources.ville.records, { areas: config.areas, streets: config.streets, now }),
    config.events.map((e) => fromManual(e, now, TZ)),
    config.stmKey ? sources.stm.events : [],
    extraEvents(),
], now);

// --- Envois ---

const daytime = (now = Date.now()) => {
    const m = localParts(now, TZ).minutes;
    return m >= toMin(config.dayFrom) && m < toMin(config.dayTo);
};

/** Un événement à date fixe se prévient la veille à 19 h (ou tout de suite s'il est plus proche). */
const dueForHeadsUp = (e, now) => {
    if (!e.id.startsWith('perso:') || !e.start) return true;
    return e.start - now < 24 * 3600_000 && (localParts(now, TZ).minutes >= 19 * 60 || ['now', 'today'].includes(bucket(e, now, TZ)));
};

/** En semaine, à l'heure de partir au travail. */
const commuting = (now = Date.now()) => {
    const { date, minutes } = localParts(now, TZ);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    return wd >= 1 && wd <= 5 && minutes >= toMin(config.commuteFrom) && minutes <= toMin(config.commuteTo);
};

const send = async (key, text, { silent }) => {
    config.sent[key] = Date.now();
    save();
    if (config.telegram) await notifier.notify({ text, silent }).catch((err) => console.warn('[Ville] Telegram :', err.message));
    journal.log({ kind: 'system', title: `Ville : ${text.replace(/^\S+\s/, '').slice(0, 140)}`, data: { key } });
};

const dispatch = async () => {
    const now = Date.now();
    const events = getEvents(now);
    const day = daytime(now);
    for (const e of events) {
        if (config.sent[e.id] || e.level === 'info' || e.notify === false) continue;
        if (e.kind === 'metro') {
            // Le métro ne compte qu'au moment de partir : Telegram avec son, pas de lampe
            if (commuting(now)) await send(e.id, `🚇 ${e.title} : ${e.detail}`, { silent: false });
        } else if (e.level === 'danger') {
            // La nuit : message silencieux, la lampe et l'écran attendent le matin
            await send(e.id, telegramText(e, now, TZ), { silent: !day });
            if (day && config.lamp && presence.anyoneHome() !== false) {
                await lightSignals.pulse([lampKind(e)], 'alerte de la ville').catch((err) => console.warn('[Ville] lampe :', err.message));
            }
        } else if (day && dueForHeadsUp(e, now)) {
            await send(e.id, telegramText(e, now, TZ), { silent: true });
        }
    }
    // Jeudi soir : le programme du week-end
    const local = localParts(now, TZ);
    const thursday = new Date(`${local.date}T12:00:00Z`).getUTCDay() === 4;
    if (thursday && local.minutes >= 19 * 60 && day && !config.sent[`weekend:${local.date}`]) {
        const text = weekendText(events, now, TZ);
        if (text) await send(`weekend:${local.date}`, text, { silent: true });
        else config.sent[`weekend:${local.date}`] = now;
    }
    // Ménage : on oublie ce qui a plus d'un mois, et les « vu » des dangers terminés
    const ids = new Set(events.map((e) => e.id));
    // Une alerte météo disparue depuis 12 h pourra être renvoyée si elle revient (autre épisode)
    for (const [k, at] of Object.entries(config.sent)) {
        const gone = /^(eccc|meteo):/.test(k) && !ids.has(k) && now - at > 12 * 3600_000;
        if (gone || now - at > 30 * 24 * 3600_000) delete config.sent[k];
    }
    const acked = config.acked.filter((id) => ids.has(id));
    if (acked.length !== config.acked.length) {
        config.acked = acked;
        save();
    }
};

export const start = () => {
    if (!config.enabled) return console.log('🏙️  Alertes de la ville désactivées');
    // Au départ, la lampe rappelle un danger en cours (verglas, smog…)
    lightSignals.addSource(() => {
        if (!config.lamp) return [];
        const kinds = getEvents().filter((e) => e.level === 'danger' && bucket(e) !== 'later').map(lampKind);
        return [...new Set(kinds)];
    });
    const tick = () => refresh().then(dispatch).catch((err) => console.warn('[Ville]', err.message));
    tick();
    setInterval(tick, TICK_MS).unref?.();
    console.log(`🏙️  Alertes de la ville : ${config.areas.join(', ') || 'aucun arrondissement'}, ${config.streets.length} rue(s), ${config.events.length} événement(s)`);
};

// --- Vue ---

export const getView = (now = Date.now()) => {
    const events = getEvents(now).map((e) => ({ ...e, when: whenLabel(e, now, TZ), bucket: bucket(e, now, TZ) }));
    const takeover = config.takeover && daytime(now)
        ? events.find((e) => e.level === 'danger' && !config.acked.includes(e.id) && ['now', 'today', 'tomorrow'].includes(e.bucket)) || null
        : null;
    return {
        enabled: config.enabled,
        updatedAt: Math.max(sources.eccc.at, sources.ville.at) || null,
        sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, { ok: s.ok, at: s.at || null }])),
        events,
        takeover: takeover && { ...takeover, lamp: config.lamp ? lampKind(takeover) : null },
        // Carte « Métro » quand la saison BIXI est finie
        metro: config.stmKey ? {
            station: config.metroStation,
            lines: sources.stm.status,
            updatedAt: sources.stm.at || null,
            error: sources.stm.error,
            show: !bixi.inSeason(now),
        } : null,
    };
};

export const briefingLine = () => line(getEvents(), Date.now(), TZ);

export const ack = (id) => {
    if (!config.acked.includes(id)) config.acked.push(String(id).slice(0, 120));
    save();
    return getView();
};

// --- Réglages ---

export const getSettings = () => {
    const { sent, acked, stmKey, ...rest } = config;
    return { ...structuredClone(rest), stmKeySet: Boolean(stmKey) };
};

const strings = (list, max, len = 60) => {
    if (!Array.isArray(list)) throw new Error('liste attendue');
    return list.slice(0, max).map((s) => String(s).trim().slice(0, len)).filter(Boolean);
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const update = (patch = {}) => {
    for (const key of ['enabled', 'telegram', 'lamp', 'takeover']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    if (patch.areas !== undefined) config.areas = strings(patch.areas, 6);
    if (patch.stmKey !== undefined) {
        config.stmKey = patch.stmKey ? String(patch.stmKey).trim().slice(0, 80) : null;
        sources.stm.at = 0;
    }
    if (patch.metroLines !== undefined) config.metroLines = strings(patch.metroLines, 4, 2).filter((l) => /^[1245]$/.test(l));
    if (patch.metroStation !== undefined) config.metroStation = patch.metroStation ? String(patch.metroStation).slice(0, 40) : null;
    if (patch.streets !== undefined) config.streets = strings(patch.streets, 30);
    for (const key of ['dayFrom', 'dayTo', 'commuteFrom', 'commuteTo']) {
        if (patch[key] === undefined) continue;
        if (!HHMM.test(patch[key])) throw new Error(`${key} invalide`);
        config[key] = patch[key];
    }
    if (patch.events !== undefined) {
        if (!Array.isArray(patch.events)) throw new Error('events invalide');
        config.events = patch.events.slice(0, 60).map((e, i) => {
            if (!e?.title || !DATE.test(e.date)) throw new Error(`événement ${i + 1} : titre et date AAAA-MM-JJ requis`);
            if (e.endDate && !DATE.test(e.endDate)) throw new Error(`événement ${i + 1} : endDate invalide`);
            for (const k of ['from', 'to']) if (e[k] && !HHMM.test(e[k])) throw new Error(`événement ${i + 1} : ${k} invalide`);
            if (e.level && !['danger', 'heads', 'info'].includes(e.level)) throw new Error(`événement ${i + 1} : level invalide`);
            const clean = { id: String(e.id || `${e.date}-${e.title}`).slice(0, 60), title: String(e.title).slice(0, 80), date: e.date };
            for (const k of ['endDate', 'from', 'to', 'level']) if (e[k]) clean[k] = e[k];
            for (const k of ['detail', 'advice', 'link']) if (e[k]) clean[k] = String(e[k]).slice(0, 200);
            return clean;
        });
    }
    save();
    sources.ville.at = 0;
    return getSettings();
};
