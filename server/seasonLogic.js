// ── Saison de Noël ───────────────────────────────────────────────────────────
//
// Tout ce qui touche à Noël (calendrier de l'Avent, Veillée, musique, neige…) n'existe
// que de la dernière semaine de novembre au 31 décembre, puis disparaît tout seul.
// Fonctions pures, testées dans seasonLogic.test.js.

const TZ = 'America/Toronto';
/** Début de la saison : le 24 novembre, la dernière semaine du mois. */
export const SEASON_START_DAY = 24;

/** Année, mois (1–12) et jour à Montréal. */
export function localDate(now = Date.now(), tz = TZ) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date(now)).map((p) => [p.type, Number(p.value)]));
    return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * Où en est la saison.
 * - on : du 24 novembre au 31 décembre
 * - phase : 'before' (fin novembre), 'advent' (1er–24 décembre), 'christmas' (le 25), 'after' (26–31)
 * - adventDay : la case du jour, du 1er au 24 décembre
 * - daysToChristmas : dodos avant le 25 (0 le jour même), null après
 */
export function christmasSeason(now = Date.now(), tz = TZ) {
    const { year, month, day } = localDate(now, tz);
    const on = (month === 11 && day >= SEASON_START_DAY) || month === 12;
    if (!on) return { on: false, year, phase: null, adventDay: null, daysToChristmas: null, daysToAdvent: null };
    let phase;
    if (month === 11) phase = 'before';
    else if (day <= 24) phase = 'advent';
    else if (day === 25) phase = 'christmas';
    else phase = 'after';
    return {
        on,
        year,
        phase,
        adventDay: phase === 'advent' ? day : null,
        daysToChristmas: month === 11 ? 30 - day + 25 : day <= 25 ? 25 - day : null,
        daysToAdvent: month === 11 ? 30 - day + 1 : null,
    };
}
