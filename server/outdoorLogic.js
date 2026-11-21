/**
 * Sonde du balcon : logique pure (pas d'E/S), testée dans outdoorLogic.test.js.
 *
 * - localOutdoor : la mesure du balcon si elle est fraîche et plausible, sinon null (repli météo).
 * - coolingAdvice : aérer gratuitement quand dehors est plus frais, refermer quand ça s'inverse.
 * - frostLine : gel ou verglas de la nuit, pour le briefing.
 * - records : plus froid de l'hiver, plus chaud de l'année, premier gel, premiers −10/−20/−30.
 */
import { roleOf } from './sensorRoles.js';

const MAX_AGE_MS = 90 * 60_000; // l'Aqara envoie au moins toutes les heures
const MAX_GAP = 8; // écart avec la météo au-delà duquel la sonde est au soleil ou collée au mur

export const round1 = (n) => Math.round(n * 10) / 10;
export const fmt = (n) => String(round1(n)).replace('.', ',').replace('-', '−');

/**
 * Mesure du balcon utilisable, ou null.
 * @param sensors capteurs (getSensors)
 * @param forecastTemp température météo du moment (contrôle de vraisemblance), null si inconnue
 */
export const localOutdoor = (sensors, forecastTemp = null, now = Date.now()) => {
    const s = (sensors || []).find((x) => roleOf(x) === 'outdoor' && x.props?.temperature != null);
    if (!s) return null;
    const ts = s.lastUpdated ? Date.parse(s.lastUpdated) : 0;
    if (!ts || now - ts > MAX_AGE_MS) return null;
    const t = s.props.temperature;
    if (typeof forecastTemp === 'number' && Math.abs(t - forecastTemp) > MAX_GAP) return null;
    return { temperature: round1(t), humidity: s.props.humidity != null ? Math.round(s.props.humidity) : null, ts, name: s.name, did: s.did };
};

// --- Aérer gratuitement (saison chaude) ---

/**
 * @param {{ indoor: number|null, outdoor: number|null, doorOpen: boolean, heatingMode: string|null, raining: boolean }} p
 * @returns {'open'|'close'|null}
 */
export const coolingAdvice = ({ indoor, outdoor, doorOpen, heatingMode, raining }) => {
    if (indoor == null || outdoor == null) return null;
    if (heatingMode === 'heat') return null; // on chauffe : rien à rafraîchir
    if (!doorOpen && !raining && indoor >= 24 && outdoor <= indoor - 2) return 'open';
    if (doorOpen && indoor >= 23 && outdoor >= indoor + 0.5) return 'close';
    return null;
};

export const coolingText = (advice, { indoor, outdoor, door = 'la porte terrasse' }) =>
    advice === 'open'
        ? `🌬️ Il fait ${fmt(outdoor)}° dehors et ${fmt(indoor)}° dedans : ouvre ${door} pour rafraîchir gratuitement.`
        : `☀️ Il fait maintenant plus chaud dehors (${fmt(outdoor)}°) que dedans (${fmt(indoor)}°) : ferme ${door} pour garder la fraîcheur.`;

// --- Gel et verglas (briefing du matin) ---

/**
 * @param night { min (12 dernières h), max (24 h), humidityAtMin, precip (mm sur 18 h, pluie ou neige) }, ou null
 * @param cooper true pour la phrase des pattes de Cooper
 */
export const frostLine = (night, { cooper = true } = {}) => {
    if (!night || night.min == null || night.min > 0.5) return null;
    // De l'eau au sol (pluie, neige fondue, air saturé) qui a gelé : verglas
    const wet = (night.humidityAtMin != null && night.humidityAtMin >= 90) || (night.precip ?? 0) >= 0.5;
    const paws = cooper ? ' Du sel sur les trottoirs : on essuie les pattes de Cooper au retour.' : '';
    if (wet) return `Attention, verglas possible ce matin : il a fait ${fmt(night.min)}° au balcon cette nuit.${paws}`;
    if (night.min <= 0) return `Gelé cette nuit : ${fmt(night.min)}° au balcon.`;
    return null;
};

// --- Records ---

const DAY_MS = 86_400_000;

/** Hiver = juillet → juin (« 2026-2027 ») : les froids d'un même hiver restent ensemble. */
export const winterOf = (dayKey) => {
    const [y, m] = dayKey.split('-').map(Number);
    return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};
export const yearOf = (dayKey) => dayKey.slice(0, 4);
const winterLabel = (w) => `l’hiver ${w}`;

export const emptyRecords = () => ({ installedDay: null, days: {} });

/** Ajoute une mesure à la journée locale `dayKey` (AAAA-MM-JJ). Mutation sur place, renvoie state. */
export const addSample = (state, dayKey, t, ts) => {
    state.installedDay ??= dayKey;
    const d = (state.days[dayKey] ??= { min: t, minAt: ts, max: t, maxAt: ts });
    if (t < d.min) Object.assign(d, { min: t, minAt: ts });
    if (t > d.max) Object.assign(d, { max: t, maxAt: ts });
    return state;
};

/** Ne garde que ~3 ans de journées. */
export const prune = (state, todayKey) => {
    const limit = new Date(Date.parse(todayKey) - 3 * 366 * DAY_MS).toISOString().slice(0, 10);
    for (const k of Object.keys(state.days)) if (k < limit) delete state.days[k];
    return state;
};

const daysOf = (state, pick) => Object.entries(state.days).filter(([k]) => pick(k));

const extreme = (entries, prop, cmp) => {
    let best = null;
    for (const [day, d] of entries) {
        const v = d[prop];
        if (best == null || cmp(v, best.value)) best = { value: v, day, at: d[`${prop}At`] };
    }
    return best;
};

// Premiers seuils de l'hiver : annoncés seulement si la sonde surveillait déjà avant la date limite
const THRESHOLDS = [
    { value: 0, label: 'Premier gel de la saison', emoji: '❄️', trackedBefore: '09-15' },
    { value: -10, label: 'Premier −10° de l’hiver', emoji: '🥶', trackedBefore: '11-25' },
    { value: -20, label: 'Premier −20° de l’hiver', emoji: '🥶', trackedBefore: '12-15' },
    { value: -30, label: 'Premier −30° de l’hiver', emoji: '🧊', trackedBefore: '12-31' },
];

const winterStartYear = (w) => Number(w.slice(0, 4));

/** La sonde surveillait-elle cet hiver depuis avant le « MM-JJ » donné ? */
const trackedSince = (state, w, mmdd) => {
    if (!state.installedDay) return false;
    const [mm] = mmdd.split('-').map(Number);
    const year = mm >= 7 ? winterStartYear(w) : winterStartYear(w) + 1;
    return state.installedDay < `${year}-${mmdd}`;
};

const MIN_DAYS = 21; // pas de « record » sur trois semaines de mesures

const dateLabel = (day) =>
    new Date(`${day}T12:00:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });

/**
 * Nouvelles du froid pour la journée `dayKey` (à appeler le matin, une fois la nuit passée).
 * @returns {{ kind, text }[]}
 */
export const coldNews = (state, dayKey) => {
    const today = state.days[dayKey];
    if (!today) return [];
    const w = winterOf(dayKey);
    const before = daysOf(state, (k) => k !== dayKey && winterOf(k) === w);
    const news = [];

    // Premiers seuils franchis (le plus bas seulement)
    const crossed = THRESHOLDS.filter(
        (th) => today.min < th.value && trackedSince(state, w, th.trackedBefore) && !before.some(([, d]) => d.min < th.value),
    ).pop();
    if (crossed) news.push({ kind: 'threshold', text: `${crossed.emoji} ${crossed.label} : ${fmt(today.min)}° au balcon cette nuit.` });

    // Nuit la plus froide de l'hiver
    const record = extreme(before, 'min', (a, b) => a < b);
    if (record && before.length >= MIN_DAYS && today.min < 0 && today.min <= record.value - 0.3) {
        const all = extreme(daysOf(state, (k) => k !== dayKey), 'min', (a, b) => a < b);
        const allTime = all && all.day !== record.day && today.min < all.value && Object.keys(state.days).length > 365;
        news.push({
            kind: 'cold_record',
            text: `🥶 Nuit la plus froide de ${winterLabel(w)} : ${fmt(today.min)}° au balcon (avant : ${fmt(record.value)}° le ${dateLabel(record.day)}).${allTime ? ' Record depuis que la sonde est là !' : ''}`,
        });
    }
    return news;
};

/** Nouvelles du chaud pour la journée `dayKey` (à appeler le soir). */
export const heatNews = (state, dayKey) => {
    const today = state.days[dayKey];
    if (!today) return [];
    const y = yearOf(dayKey);
    const before = daysOf(state, (k) => k !== dayKey && yearOf(k) === y);
    const record = extreme(before, 'max', (a, b) => a > b);
    if (!record || before.length < MIN_DAYS || today.max < 25 || today.max < record.value + 0.3) return [];
    return [{ kind: 'heat_record', text: `🥵 Journée la plus chaude de ${y} : ${fmt(today.max)}° au balcon (avant : ${fmt(record.value)}° le ${dateLabel(record.day)}).` }];
};

/** Résumé pour l'écran météo et l'agent : records de l'hiver en cours et de l'année. */
export const summary = (state, dayKey) => {
    const w = winterOf(dayKey);
    const y = yearOf(dayKey);
    const winterDays = daysOf(state, (k) => winterOf(k) === w);
    const yearDays = daysOf(state, (k) => yearOf(k) === y);
    const firstFrost = winterDays.filter(([, d]) => d.min < 0).sort(([a], [b]) => a.localeCompare(b))[0];
    const pack = (r) => (r ? { value: round1(r.value), day: r.day, at: r.at } : null);
    return {
        since: state.installedDay,
        winter: {
            label: w,
            coldest: pack(extreme(winterDays, 'min', (a, b) => a < b)),
            warmest: pack(extreme(winterDays, 'max', (a, b) => a > b)),
            firstFrost: firstFrost && trackedSince(state, w, '09-15') ? { day: firstFrost[0], value: round1(firstFrost[1].min) } : null,
            frostDays: winterDays.filter(([, d]) => d.min < 0).length,
        },
        year: {
            label: y,
            coldest: pack(extreme(yearDays, 'min', (a, b) => a < b)),
            warmest: pack(extreme(yearDays, 'max', (a, b) => a > b)),
        },
        allTime: {
            coldest: pack(extreme(Object.entries(state.days), 'min', (a, b) => a < b)),
            warmest: pack(extreme(Object.entries(state.days), 'max', (a, b) => a > b)),
        },
    };
};

/** Phrase pour l'agent vocal. */
export const recordsSpeech = (s) => {
    if (!s.since) return 'La sonde du balcon n’a pas encore de mesures.';
    const parts = [];
    if (s.winter.coldest) parts.push(`le plus froid de cet hiver : ${fmt(s.winter.coldest.value)}° le ${dateLabel(s.winter.coldest.day)}`);
    if (s.year.warmest) parts.push(`le plus chaud de ${s.year.label} : ${fmt(s.year.warmest.value)}° le ${dateLabel(s.year.warmest.day)}`);
    if (s.winter.frostDays) parts.push(`${s.winter.frostDays} jour${s.winter.frostDays > 1 ? 's' : ''} de gel cet hiver`);
    return parts.length ? `Au balcon, ${parts.join(', ')} (mesures depuis le ${dateLabel(s.since)}).` : 'Pas encore de record au balcon.';
};
