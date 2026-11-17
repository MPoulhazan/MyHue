/**
 * Habitudes d'écoute : un journal des lectures lancées, et la suggestion du créneau en cours.
 * Pas d'apprentissage compliqué : on compte les jours où une même source a été lancée sur le même créneau
 * (semaine ou week-end × moment de la journée), les jours récents pesant plus.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dataFile } from './dataDir.js';

const TZ = process.env.TZ || 'America/Toronto';
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 56; // 8 semaines
const MIN_DAYS = 3; // en dessous, ce n'est pas une habitude
const DECAY = 0.97; // poids d'un jour vieux de n jours : 0.97^n

export const BANDS = [
    { id: 'nuit', label: 'la nuit', from: 0, to: 5 },
    { id: 'matin', label: 'le matin', from: 5, to: 9 },
    { id: 'matinee', label: 'en matinée', from: 9, to: 12 },
    { id: 'midi', label: 'le midi', from: 12, to: 14 },
    { id: 'aprem', label: 'l’après-midi', from: 14, to: 18 },
    { id: 'soir', label: 'le soir', from: 18, to: 22 },
    { id: 'nuit', label: 'la nuit', from: 22, to: 24 },
];

/** Date et heure locales (Montréal) d'un instant. */
export const localParts = (t, tz = TZ) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
};

/** Créneau d'un instant : semaine/week-end et moment de la journée. */
export const slotOf = (t, tz = TZ) => {
    const { hour, weekend, day } = localParts(t, tz);
    const band = BANDS.find((b) => hour >= b.from && hour < b.to);
    return { weekend, band: band.id, label: band.label, day };
};

const keyOf = (e) => `${e.kind}:${e.id}`;

/**
 * Meilleure habitude pour l'instant `now`, ou null.
 * entries : [{ t, kind, id, name, thumbnail }] ; exclude : clé « kind:id » à ignorer (ce qui joue déjà).
 */
export function suggest(entries, now, { exclude = null, tz = TZ } = {}) {
    const slot = slotOf(now, tz);
    const groups = new Map();
    for (const e of entries) {
        if (now - e.t > WINDOW_DAYS * DAY_MS || e.t > now) continue;
        const s = slotOf(e.t, tz);
        if (s.weekend !== slot.weekend || s.band !== slot.band) continue;
        const key = keyOf(e);
        if (key === exclude) continue;
        const g = groups.get(key) || { entry: e, days: new Map() };
        g.entry = e.t > g.entry.t ? e : g.entry; // nom et vignette les plus récents
        g.days.set(s.day, e.t);
        groups.set(key, g);
    }
    let best = null;
    for (const g of groups.values()) {
        if (g.days.size < MIN_DAYS) continue;
        const score = [...g.days.values()].reduce((sum, t) => sum + DECAY ** ((now - t) / DAY_MS), 0);
        if (!best || score > best.score) best = { ...g, score };
    }
    if (!best) return null;
    const { kind, id, name, thumbnail } = best.entry;
    const when = `${slot.weekend ? 'les week-ends' : 'en semaine'}, ${slot.label}`;
    return {
        kind, id, name, thumbnail: thumbnail || null, habit: true, days: best.days.size,
        reason: `Lancé ${best.days.size} fois ${when}, ces 8 dernières semaines`,
    };
}

/** Ambiance proposée par défaut quand aucune habitude ne se dégage encore. */
export function defaultMood(now, tz = TZ) {
    const { band } = slotOf(now, tz);
    const id = { matin: 'zen', matinee: 'focus', midi: 'diner', aprem: 'focus', soir: 'diner', nuit: 'dodo' }[band];
    const reason = { matin: 'Pour commencer la journée en douceur', matinee: 'Pour se concentrer', midi: 'Pour le repas', aprem: 'Pour se concentrer', soir: 'Pour la soirée', nuit: 'Pour s’endormir' }[band];
    return { kind: 'mood', id, habit: false, reason };
}

// --- Journal sur disque ---

const FILE = dataFile('music-history.json');
const KEEP_DAYS = 150;
const KEEP_MAX = 3000;
let entries = (() => {
    try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf-8')) : []; } catch { return []; }
})();

export const getEntries = () => entries;

/** Ajoute une lecture au journal ; la même source relancée dans la demi-heure ne compte qu'une fois. */
export function record({ kind, id, name, thumbnail = null, deviceId = null }, now = Date.now()) {
    if (!kind || !id || kind === 'resume') return;
    const last = entries[entries.length - 1];
    if (last && keyOf(last) === `${kind}:${id}` && now - last.t < 30 * 60_000) return;
    entries.push({ t: now, kind, id, name: name || id, thumbnail, deviceId });
    entries = entries.filter((e) => now - e.t < KEEP_DAYS * DAY_MS).slice(-KEEP_MAX);
    try { writeFileSync(FILE, JSON.stringify(entries)); } catch (err) { console.error('music history:', err?.message); }
}

/** Dernières sources distinctes (pour « Récents »). */
export function recent(limit = 8) {
    const seen = new Set();
    const out = [];
    for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
        const e = entries[i];
        if (seen.has(keyOf(e))) continue;
        seen.add(keyOf(e));
        out.push(e);
    }
    return out;
}
