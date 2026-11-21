// ── Données de /api/advent (server/advent.js) ───────────────────────────────

export type AdventKind = 'song' | 'mission' | 'fact' | 'cooper' | 'outing';

export interface AdventDay {
    n: number;
    /** La case du jour */
    today: boolean;
    /** Passée ou du jour : son contenu est connu */
    openable: boolean;
    openedAt: number | null;
    kind?: AdventKind;
    label?: string;
    title?: string;
    body?: string;
    photo?: string | null;
    /** Une chanson à jouer sur l'enceinte */
    playable?: boolean;
}

export interface ChristmasSeason {
    on: boolean;
    year: number;
    phase: 'before' | 'advent' | 'christmas' | 'after' | null;
    adventDay: number | null;
    daysToChristmas: number | null;
    daysToAdvent: number | null;
}

export interface AdventView {
    season: ChristmasSeason | null;
    today: number | null;
    todayOpened: boolean;
    openedCount: number;
    days: AdventDay[];
}

export interface AdventOpenResult {
    view: AdventView;
    day: AdventDay;
    /** Nom de l'enceinte où joue la chanson */
    played: string | null;
    error: string | null;
}

/** « Plus que 13 dodos », « Plus qu'un dodo », « C'est Noël » */
export function dodos(season: ChristmasSeason | null) {
    const d = season?.daysToChristmas;
    if (d == null) return null;
    if (d === 0) return 'C’est Noël';
    return d > 1 ? `Plus que ${d} dodos` : 'Plus qu’un dodo';
}
