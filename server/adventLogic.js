// ── Calendrier de l'Avent : ce que montre l'écran ────────────────────────────
//
// Fonctions pures, testées dans adventLogic.test.js. advent.js garde les cases ouvertes
// et sert /api/advent.

import { ADVENT_DAYS, KIND_LABEL } from './adventDays.js';

/**
 * La vue du calendrier.
 * Une case à venir ne montre rien de son contenu ; une case passée non ouverte se rattrape.
 * @param opened { [n]: ts } les cases ouvertes cette année
 * @param season christmasSeason()
 */
export function adventView(opened = {}, season) {
    const today = season?.adventDay ?? (season?.phase === 'christmas' || season?.phase === 'after' ? 25 : 0);
    const days = ADVENT_DAYS.map((d) => {
        const open = d.n <= today;
        const base = { n: d.n, today: d.n === season?.adventDay, openable: open, openedAt: opened[d.n] ?? null };
        if (!open) return base;
        return { ...base, kind: d.kind, label: KIND_LABEL[d.kind], title: d.title, body: d.body, photo: d.photo ?? null, playable: Boolean(d.query) };
    });
    const todayCase = season?.adventDay ? days[season.adventDay - 1] : null;
    return {
        season: season ?? null,
        today: season?.adventDay ?? null,
        todayOpened: Boolean(todayCase?.openedAt),
        openedCount: days.filter((d) => d.openedAt).length,
        days,
    };
}

/** La pastille et la pertinence de la carte de l'accueil. */
export function adventRelevance(view) {
    const s = view?.season;
    if (!s?.on) return { id: 'advent', relevance: 'hidden', summary: 'hors saison', until: null };
    const state = (relevance, summary) => ({ id: 'advent', relevance, summary, until: null });
    if (s.phase === 'before') return state('calm', s.daysToAdvent > 1 ? `ouvre dans ${s.daysToAdvent} jours` : 'ouvre demain');
    if (s.phase === 'advent') {
        if (!view.todayOpened) return state('now', `case ${view.today} à ouvrir`);
        return state('calm', `case ${view.today} ouverte`);
    }
    if (s.phase === 'christmas') return state('calm', 'joyeux Noël');
    return state('calm', `${view.openedCount} cases ouvertes`);
}

/** Phrase du briefing du matin. */
export function adventBriefingLine(view) {
    const s = view?.season;
    if (!s?.on) return null;
    if (s.phase === 'before') return s.daysToAdvent > 1 ? `Le calendrier de l’Avent ouvre dans ${s.daysToAdvent} jours.` : 'Le calendrier de l’Avent ouvre demain.';
    if (s.phase === 'advent') {
        const dodos = s.daysToChristmas > 1 ? `Plus que ${s.daysToChristmas} dodos avant Noël` : 'Plus qu’un dodo avant Noël';
        return view.todayOpened ? `${dodos}.` : `${dodos}, et la case ${view.today} du calendrier vous attend.`;
    }
    if (s.phase === 'christmas') return 'Joyeux Noël !';
    return null;
}

/** « Ouvre la case du jour », « ouvre le calendrier de l'Avent ». */
export const isAdventCommand = (text) => {
    const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /\b(ouvr\w*|montre\w*)\b.*\b(case|calendrier|avent)\b/.test(t) || /\bcase du jour\b/.test(t);
};
