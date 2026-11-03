/**
 * Le ciel de la nuit : lune, planètes, pluies d'étoiles filantes et éclipses calculées en local
 * (astronomy-engine), aurores d'après l'indice Kp prévu par la NOAA, nuages d'Open-Meteo.
 * Les fonctions pures (fenêtre d'observation, conditions, aurores) sont testées dans astro.test.js.
 */
import axios from 'axios';
import * as A from 'astronomy-engine';
import { getForecast, getLocation } from './weather.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Kp à partir duquel une aurore devient visible depuis Montréal (pollution lumineuse comprise)
export const AURORA_KP = 6;
export const AURORA_WATCH_KP = 5;

/** Grandes pluies d'étoiles filantes : `night` = soir de la nuit du pic (heure locale). */
export const SHOWERS = [
    { id: 'quadrantids', name: 'Quadrantides', month: 1, night: 3, zhr: 110 },
    { id: 'lyrids', name: 'Lyrides', month: 4, night: 21, zhr: 18 },
    { id: 'perseids', name: 'Perséides', month: 8, night: 12, zhr: 100 },
    { id: 'orionids', name: 'Orionides', month: 10, night: 20, zhr: 20 },
    { id: 'leonids', name: 'Léonides', month: 11, night: 16, zhr: 15 },
    { id: 'geminids', name: 'Géminides', month: 12, night: 13, zhr: 150 },
];

// Noms traditionnels des pleines lunes, par mois
const FULL_MOON_NAMES = [
    'Lune du loup', 'Lune des neiges', 'Lune des vers', 'Lune rose', 'Lune des fleurs', 'Lune des fraises',
    'Lune du cerf', 'Lune de l’esturgeon', 'Lune des moissons', 'Lune du chasseur', 'Lune du castor', 'Lune froide',
];

const PLANETS = [
    { body: A.Body.Venus, id: 'venus', name: 'Vénus' },
    { body: A.Body.Jupiter, id: 'jupiter', name: 'Jupiter' },
    { body: A.Body.Mars, id: 'mars', name: 'Mars' },
    { body: A.Body.Saturn, id: 'saturn', name: 'Saturne' },
    { body: A.Body.Mercury, id: 'mercury', name: 'Mercure' },
];

// --- Petits calculs purs ---

/** Nom de la phase d'après l'angle de phase d'astronomy-engine (0 = nouvelle, 180 = pleine). */
export function phaseName(deg) {
    const p = ((deg % 360) + 360) % 360;
    if (p < 6 || p >= 354) return 'Nouvelle lune';
    if (p < 84) return 'Premier croissant';
    if (p < 96) return 'Premier quartier';
    if (p < 174) return 'Gibbeuse croissante';
    if (p < 186) return 'Pleine lune';
    if (p < 264) return 'Gibbeuse décroissante';
    if (p < 276) return 'Dernier quartier';
    return 'Dernier croissant';
}

export function compass(az) {
    return ['au nord', 'au nord-est', 'à l’est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l’ouest', 'au nord-ouest'][Math.round(az / 45) % 8];
}

/** Début de « cette nuit » (17 h locale) : la nuit en cours avant 5 h, sinon celle qui vient (briefing de 6 h compris). */
export function nightStart(now, offsetSec) {
    const local = now + offsetSec * 1000;
    const dayStart = Math.floor(local / DAY) * DAY;
    let start = dayStart + 17 * HOUR - offsetSec * 1000;
    if (new Date(local).getUTCHours() < 5) start -= DAY;
    return start;
}

/** Qualité d'une heure pour observer (0 à 1) : obscurité × ciel clair × lune discrète. */
export function hourScore(h) {
    const dark = h.sky === 'night' ? 1 : h.sky === 'twilight' ? 0.5 : 0;
    const clear = h.cloud == null ? 0.7 : 1 - h.cloud / 100;
    const moon = h.moonUp ? 1 - h.moonFraction * 0.5 : 1;
    return Math.round(dark * clear * moon * 100) / 100;
}

/** Plus longue suite d'heures « observables » (score ≥ 0,5), la meilleure en cumul. */
export function bestWindow(hours) {
    let best = null;
    let run = [];
    const close = () => {
        if (!run.length) return;
        const total = run.reduce((s, h) => s + h.score, 0);
        if (!best || total > best.total) best = { from: run[0].ts, to: run[run.length - 1].ts + HOUR, total, avg: total / run.length };
        run = [];
    };
    for (const h of hours) {
        if (h.score >= 0.5) run.push(h);
        else close();
    }
    close();
    if (!best) return null;
    return { from: best.from, to: best.to, score: Math.round(best.avg * 100) / 100 };
}

export function skyQuality(window) {
    if (!window) return { level: 'bad', label: 'Mauvais pour observer' };
    if (window.score >= 0.7 && window.to - window.from >= 2 * HOUR) return { level: 'good', label: 'Bon pour observer' };
    return { level: 'fair', label: 'Moyen pour observer' };
}

/** Conditions d'une pluie d'étoiles filantes d'après la lumière de la lune au cœur de la nuit (0 à 1). */
export function showerCondition(moonLight) {
    if (moonLight < 0.15) return { level: 'excellent', label: 'Excellent, sans lune' };
    if (moonLight < 0.4) return { level: 'good', label: 'Bon, lune discrète' };
    if (moonLight < 0.7) return { level: 'fair', label: 'Moyen, lune gênante' };
    return { level: 'poor', label: 'Lune très gênante' };
}

/** Flux NOAA (tableau d'objets ; ancien format : tableau de tableaux avec en-tête) → [{ ts, kp, observed }]. */
export function parseKp(raw) {
    if (!Array.isArray(raw)) return [];
    const rows = Array.isArray(raw[0])
        ? raw.slice(1).map((r) => ({ time_tag: r[0], kp: r[1], observed: r[2] }))
        : raw;
    return rows
        .map((r) => ({ ts: Date.parse(`${String(r.time_tag).replace(' ', 'T')}Z`), kp: Number(r.kp), observed: r.observed === 'observed' }))
        .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.kp));
}

/** Perspective d'aurore pour la nuit : alerte seulement si Kp suffisant pendant des heures noires et dégagées. */
export function auroraOutlook(kp, hours, now = Date.now()) {
    const series = kp.filter((k) => k.ts + 3 * HOUR > now && k.ts < now + 72 * HOUR)
        .map((k) => ({ ts: k.ts, kp: Math.round(k.kp * 10) / 10 }));
    const dark = hours.filter((h) => h.sky === 'night' && h.ts + HOUR > now);
    const bucket = (h) => series.find((k) => h.ts >= k.ts && h.ts < k.ts + 3 * HOUR);
    const tonight = dark.map((h) => ({ h, kp: bucket(h)?.kp ?? 0 }));
    const maxTonight = tonight.reduce((m, x) => Math.max(m, x.kp), 0);
    const max = series.reduce((m, k) => Math.max(m, k.kp), 0);
    const strong = tonight.filter((x) => x.kp >= AURORA_KP);
    const clear = strong.filter((x) => x.h.cloud == null || x.h.cloud <= 50);
    let level = 'calm';
    let window = null;
    if (clear.length) {
        level = 'alert';
        window = { from: clear[0].h.ts, to: clear[clear.length - 1].h.ts + HOUR };
    } else if (strong.length) level = 'cloudy';
    else if (maxTonight >= AURORA_WATCH_KP) level = 'watch';
    const label = {
        alert: 'Aurores possibles ce soir',
        cloudy: 'Aurores possibles, mais ciel couvert',
        watch: 'Activité magnétique en hausse',
        calm: 'Rien à signaler',
    }[level];
    return { level, label, maxTonight, max, window, series };
}

// --- Astronomie (astronomy-engine) ---

function horizon(body, date, obs) {
    const eq = A.Equator(body, date, obs, true, true);
    return A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
}

const riseSet = (body, obs, dir, from, days) => A.SearchRiseSet(body, obs, dir, from, days)?.date.getTime() ?? null;

function moonInfo(now, obs, offsetSec) {
    const date = new Date(now);
    const phase = A.MoonPhase(date);
    const fraction = A.Illumination(A.Body.Moon, date).phase_fraction;
    const nextFull = A.SearchMoonPhase(180, date, 35).date.getTime();
    const nextNew = A.SearchMoonPhase(0, date, 35).date.getTime();
    const fullMonth = new Date(nextFull + offsetSec * 1000).getUTCMonth();
    return {
        phase: Math.round(phase * 10) / 10,
        name: phaseName(phase),
        fraction: Math.round(fraction * 1000) / 1000,
        waxing: phase < 180,
        up: horizon(A.Body.Moon, date, obs).altitude > 0,
        rise: riseSet(A.Body.Moon, obs, +1, date, 1.5),
        set: riseSet(A.Body.Moon, obs, -1, date, 1.5),
        nextFull: { ts: nextFull, name: FULL_MOON_NAMES[fullMonth] },
        nextNew,
    };
}

function buildHours(start, obs, forecast) {
    const hours = [];
    for (let i = 0; i <= 14; i++) {
        const ts = start + i * HOUR;
        const mid = new Date(ts + HOUR / 2);
        const sunAlt = horizon(A.Body.Sun, mid, obs).altitude;
        const moon = horizon(A.Body.Moon, mid, obs);
        const f = forecast?.hours.find((x) => Math.abs(x.ts - ts) < HOUR / 2);
        const h = {
            ts,
            sky: sunAlt > -0.833 ? 'day' : sunAlt > -18 ? 'twilight' : 'night',
            cloud: f?.cloud ?? null,
            moonUp: moon.altitude > 0,
            moonFraction: A.Illumination(A.Body.Moon, mid).phase_fraction,
        };
        h.score = hourScore(h);
        hours.push(h);
    }
    return hours;
}

function buildPlanets(hours, obs) {
    const samples = hours.filter((h) => h.sky !== 'day');
    const out = [];
    for (const p of PLANETS) {
        let best = null;
        let from = null;
        for (const h of samples) {
            const pos = horizon(p.body, new Date(h.ts + HOUR / 2), obs);
            if (pos.altitude >= 10 && from == null) from = h.ts;
            if (!best || pos.altitude > best.alt) best = { ts: h.ts, alt: pos.altitude, az: pos.azimuth };
        }
        if (!best || best.alt < 10) continue;
        const mag = A.Illumination(p.body, new Date(best.ts)).mag;
        if (mag > 1.5) continue;
        out.push({
            id: p.id, name: p.name, mag: Math.round(mag * 10) / 10,
            from, bestTs: best.ts, alt: Math.round(best.alt), dir: compass(best.az),
        });
    }
    return out.sort((a, b) => a.mag - b.mag);
}

/** Lumière de la lune entre 1 h et 5 h du matin, la nuit qui commence au soir `eveningTs` (0 à 1). */
function moonLightAt(eveningTs, obs) {
    let sum = 0;
    for (const h of [8, 10, 12]) {
        const d = new Date(eveningTs + h * HOUR); // 17 h + 8, 10, 12 h = 1 h, 3 h, 5 h
        if (horizon(A.Body.Moon, d, obs).altitude > 0) sum += A.Illumination(A.Body.Moon, d).phase_fraction;
    }
    return sum / 3;
}

function buildShowers(now, obs, offsetSec, limitDays = 120) {
    const year = new Date(now + offsetSec * 1000).getUTCFullYear();
    const list = [];
    for (const s of SHOWERS) {
        for (const y of [year, year + 1]) {
            const evening = Date.UTC(y, s.month - 1, s.night, 17) - offsetSec * 1000;
            if (evening + 14 * HOUR < now || evening > now + limitDays * DAY) continue;
            const cond = showerCondition(moonLightAt(evening, obs));
            const day = new Date(evening + offsetSec * 1000);
            const next = new Date(evening + offsetSec * 1000 + DAY);
            list.push({
                type: 'shower', id: s.id, ts: evening, title: s.name, zhr: s.zhr,
                night: `nuit du ${day.getUTCDate()} au ${next.getUTCDate()} ${MONTHS[next.getUTCMonth()]}`,
                level: cond.level, label: cond.label,
            });
        }
    }
    return list.sort((a, b) => a.ts - b.ts);
}

function buildEclipses(now, obs, limitDays = 400) {
    const limit = now + limitDays * DAY;
    const out = [];
    const LUNAR = { partial: 'Éclipse partielle de Lune', total: 'Éclipse totale de Lune' };
    let e = A.SearchLunarEclipse(new Date(now));
    while (e && e.peak.date.getTime() < limit) {
        const ts = e.peak.date.getTime();
        if (LUNAR[e.kind] && horizon(A.Body.Moon, e.peak.date, obs).altitude > 0) {
            out.push({ type: 'eclipse', ts, title: LUNAR[e.kind], level: 'good', label: 'Visible d’ici' });
        }
        e = A.NextLunarEclipse(e.peak);
    }
    const SOLAR = { partial: 'Éclipse partielle de Soleil', annular: 'Éclipse annulaire de Soleil', total: 'Éclipse totale de Soleil' };
    let s = A.SearchLocalSolarEclipse(new Date(now), obs);
    while (s && s.peak.time.date.getTime() < limit) {
        if (s.peak.altitude > 0) {
            out.push({ type: 'eclipse', ts: s.peak.time.date.getTime(), title: SOLAR[s.kind] || 'Éclipse de Soleil', level: 'good', label: 'Lunettes spéciales obligatoires' });
        }
        s = A.NextLocalSolarEclipse(s.peak.time, obs);
    }
    return out;
}

const daysUntil = (ts, now) => Math.round((ts - now) / DAY);

/** Ce que la home met en avant, par ordre d'importance. */
export function pickHighlight({ aurora, events, planets, moon }, now = Date.now()) {
    if (aurora?.level === 'alert') return { kind: 'aurora', title: aurora.label, text: `Kp ${aurora.maxTonight} prévu, regarde plein nord, loin des lampadaires.` };
    const soon = (e, d) => e.ts - now < d * DAY;
    const eclipse = events.find((e) => e.type === 'eclipse' && soon(e, 7));
    if (eclipse) return { kind: 'eclipse', title: eclipse.title, text: eclipse.label };
    const shower = events.find((e) => e.type === 'shower' && soon(e, 30));
    if (shower) {
        const d = daysUntil(shower.ts, now);
        const when = d <= 0 ? 'cette nuit' : d === 1 ? 'demain soir' : `dans ${d} jours`;
        return { kind: 'shower', title: `${shower.title} ${when}`, text: `Pic la ${shower.night}, jusqu’à ${shower.zhr} par heure sous un ciel noir. ${shower.label}.` };
    }
    if (aurora && aurora.level !== 'calm') return { kind: 'aurora', title: aurora.label, text: `Kp ${aurora.maxTonight} prévu cette nuit.` };
    const planet = planets[0];
    if (planet) return { kind: 'planet', title: `${planet.name} ${planet.dir}`, text: 'Visible à l’œil nu ce soir.' };
    return { kind: 'moon', title: moon.nextFull.name, text: 'Prochaine pleine lune.' };
}

// --- Phrases (Jarvis, briefing, Telegram) ---

const sayH = (ts, offsetSec) => {
    const h = new Date(ts + offsetSec * 1000).getUTCHours();
    return h === 0 ? 'minuit' : h === 12 ? 'midi' : `${h} heures`;
};
const pctWord = (f) => `${Math.round(f * 100)} pour cent`;
const kpWord = (kp) => String(Math.round(kp * 10) / 10).replace('.', ',');

/** Une question sur le ciel (et pas une commande de lampe). */
export function isSkyQuestion(text) {
    const t = String(text || '').toLowerCase();
    // Mots entiers, accents compris (\b ignore les lettres accentuées)
    const word = (alt) => new RegExp(`(?<!\\p{L})(?:${alt})(?!\\p{L})`, 'u');
    if (word('allume|allumer|éteins|eteins|éteindre|mets|met|baisse|monte|joue|lance').test(t)) return false;
    const topic = word('ciel|lune|aurores?|boréales?|boreales?|étoiles? filantes?|etoiles? filantes?|planètes?|planetes?|éclipses?|eclipses?|astronomie|perséides|géminides|léonides').test(t);
    const ask = t.includes('?') || word("qu['’]?est[- ]ce|quoi|quel|quelle|quand|y a|y aura|voit|voir|visible|ce soir|cette nuit|phase").test(t);
    return topic && ask;
}

/** Réponse parlée complète : lune, conditions de la nuit, planètes, aurores, prochain événement. */
export function skySpeech(sky, now = Date.now()) {
    const off = sky.offsetSec ?? 0;
    const parts = [];
    const m = sky.moon;
    const next = m.up ? `elle se couche vers ${sayH(m.set, off)}` : `elle se lève vers ${sayH(m.rise, off)}`;
    const phase = /^(Pleine|Nouvelle) lune$/.test(m.name) ? `C'est la ${m.name.toLowerCase()}` : `La lune est en ${m.name.toLowerCase()}`;
    parts.push(`${phase}, éclairée à ${pctWord(m.fraction)}, ${(m.up ? m.set : m.rise) ? next : 'toute la nuit'}.`);
    const w = sky.night.window;
    if (w) parts.push(`Cette nuit, le meilleur moment pour observer, c'est de ${sayH(w.from, off)} à ${sayH(w.to, off)}.`);
    else parts.push('Cette nuit, le ciel sera trop couvert pour observer.');
    if (sky.planets.length) parts.push(`Planètes visibles : ${sky.planets.slice(0, 3).map((p) => `${p.name} ${p.dir}`).join(', ')}.`);
    const a = sky.aurora;
    if (a?.level === 'alert') parts.push(`Bonne nouvelle : aurores possibles, Kp ${kpWord(a.maxTonight)} prévu.`);
    else if (a?.level === 'cloudy') parts.push(`Aurores possibles avec un Kp de ${kpWord(a.maxTonight)}, mais les nuages risquent de les cacher.`);
    else if (a) parts.push('Pas d’aurores en vue.');
    const e = sky.events.find((x) => x.type !== 'fullmoon') || sky.events[0];
    if (e) {
        const d = daysUntil(e.ts, now);
        const when = d <= 0 ? 'cette nuit' : d === 1 ? 'demain' : `dans ${d} jours`;
        parts.push(`Prochain rendez-vous : ${e.title} ${when}${e.type === 'shower' ? `, ${e.label.toLowerCase()}` : ''}.`);
    }
    return parts.join(' ');
}

/** Ligne du briefing du matin, seulement les jours où le ciel vaut le détour (sinon null). */
export function skyBriefingLine(sky, now = Date.now()) {
    const off = sky.offsetSec ?? 0;
    const a = sky.aurora;
    if (a?.level === 'alert') {
        return `Ce soir, aurores boréales possibles${a.window ? ` entre ${sayH(a.window.from, off)} et ${sayH(a.window.to, off)}` : ''} : regarde plein nord.`;
    }
    const tonight = (e) => e.ts - now < 20 * HOUR;
    const eclipse = sky.events.find((e) => e.type === 'eclipse' && tonight(e));
    if (eclipse) return `Aujourd'hui, ${eclipse.title.charAt(0).toLowerCase()}${eclipse.title.slice(1)}, visible d'ici.`;
    const shower = sky.events.find((e) => e.type === 'shower' && tonight(e));
    if (shower && shower.level !== 'poor') {
        return `Cette nuit, pic des ${shower.title}${sky.night.window ? '' : ', mais le ciel sera couvert'}.`;
    }
    const full = sky.events.find((e) => e.type === 'fullmoon' && tonight(e));
    if (full) return `Pleine lune ce soir, la ${full.title.replace(/^Lune/, 'lune')}.`;
    return null;
}

// --- Aurores (NOAA, cache 30 min) ---

let kpCache = { at: 0, value: null };
async function getKp() {
    if (kpCache.value && Date.now() - kpCache.at < 30 * 60_000) return kpCache.value;
    const { data } = await axios.get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', { timeout: 10000 });
    kpCache = { at: Date.now(), value: parseKp(data) };
    return kpCache.value;
}

// --- Assemblage (cache 10 min) ---

let skyCache = { at: 0, value: null };
export async function getSky() {
    if (skyCache.value && Date.now() - skyCache.at < 10 * 60_000) return skyCache.value;
    const now = Date.now();
    const [loc, forecast, kp] = await Promise.all([
        getLocation(),
        getForecast().catch((err) => { console.warn('[Ciel] Prévision indisponible :', err.message); return null; }),
        getKp().catch((err) => { console.warn('[Ciel] Indice Kp indisponible :', err.message); return null; }),
    ]);
    const offsetSec = forecast?.offsetSec ?? -new Date().getTimezoneOffset() * 60;
    const obs = new A.Observer(loc.lat, loc.lon, 0);
    const start = nightStart(now, offsetSec);
    const hours = buildHours(start, obs, forecast);
    const window = bestWindow(hours);
    const moon = moonInfo(now, obs, offsetSec);
    const planets = buildPlanets(hours, obs);
    const aurora = kp ? auroraOutlook(kp, hours, now) : null;
    const events = [
        ...buildShowers(now, obs, offsetSec),
        ...buildEclipses(now, obs),
        { type: 'fullmoon', ts: moon.nextFull.ts, title: moon.nextFull.name, level: 'moon', label: 'Pleine lune' },
    ].sort((a, b) => a.ts - b.ts).slice(0, 4);
    const value = {
        updatedAt: now,
        offsetSec,
        moon,
        sun: { set: riseSet(A.Body.Sun, obs, -1, new Date(start - 4 * HOUR), 1), rise: riseSet(A.Body.Sun, obs, +1, new Date(start), 1) },
        night: { hours: hours.map(({ moonFraction: _f, ...h }) => h), window, quality: skyQuality(window) },
        planets,
        aurora,
        events,
    };
    value.highlight = pickHighlight(value, now);
    skyCache = { at: now, value };
    return value;
}
