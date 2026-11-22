// Types partagés par la carte « Pour vous deux » (Ma journée) et la fiche sortie

export type OutingKind = 'event' | 'cinema' | 'concert' | 'museum' | 'resto' | 'activity';

export const KIND_LABEL: Record<OutingKind, string> = {
    event: 'Événement',
    cinema: 'Cinéma',
    concert: 'Concert',
    museum: 'Musée',
    resto: 'Resto',
    activity: 'Activité',
};

export interface Idea {
    id: string;
    kind: OutingKind;
    title: string;
    when: string | null;
    where: string | null;
    why: string | null;
    url: string | null;
    date: string | null;
    price?: string | null;
    free?: boolean;
    duration?: string | null;
    times?: string | null;
    address?: string | null;
    lat?: number | null;
    lon?: number | null;
    image?: string | null;
    bookingUrl?: string | null;
    indoor?: boolean | null;
    trailer?: string | null;
    artist?: string | null;
    photos?: string[];
}

/** Un écran Cast où envoyer une bande-annonce : le projecteur (tv) ou le Hub de la cuisine. */
export interface Screen { id: 'tv' | 'kitchen'; name: string; online: boolean }

export interface Trip {
    distM: number;
    walk: number;
    bike: number | null;
    transit: number | null;
    bikes: number | null;
    startName: string | null;
    end: { lat: number; lon: number; name: string; docks: number } | null;
}

export interface OutingIdea extends Idea {
    trip: Trip | null;
    freeLine: string | null;
    match: boolean;
}

export interface PlanPerson { id: string; name: string; initial: string; color: string }

/** La sortie prévue et où en est l'invitation Google Agenda. */
export interface Plan {
    ideaId: string;
    title: string;
    kind: OutingKind;
    where: string | null;
    start: number;
    end: number;
    by: PlanPerson | null;
    to: PlanPerson | null;
    status: 'sent' | 'pending' | 'confirmed' | 'declined';
    tracked: boolean;
    guestInvited: boolean;
}

export interface OutingsView {
    plan: Plan | null;
    screens?: Screen[];
    search?: SearchState;
    at: number | null;
    filter: string;
    home: { lat: number; lon: number } | null;
    start: { lat: number; lon: number; name: string; bikes: number } | null;
    liked: string | null;
    ideas: OutingIdea[];
    hidden: { id: string; title: string; reason: string }[];
}

/** « 850 m », « 2,4 km » */
export const distLabel = (m: number) => (m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** « Ce soir à deux » : le programme du jour d'une sortie prévue (server/tonightLogic.js). */
export interface Tonight {
    ideaId: string;
    title: string;
    where: string | null;
    start: number;
    end: number;
    status: Plan['status'];
    to: PlanPerson | null;
    mode: 'bike' | 'transit' | 'walk' | null;
    modeLabel: string | null;
    travelMin: number | null;
    leaveAt: number | null;
    homeAt: number;
    bikes: number | null;
    station: string | null;
    bikeSkipped: boolean;
    weather: { go: string | null; back: string | null };
    cooper: { awayMin: number; before: number } | null;
    reminded: boolean;
}

/** Une sortie faite, dans « Nos sorties » (server/historyLogic.js). */
export interface HistoryEntry {
    id: string;
    ideaId: string;
    title: string;
    kind: OutingKind;
    where: string | null;
    start: number;
    end: number;
    by: PlanPerson | null;
    to: PlanPerson | null;
    price: string | null;
    spent: number | null;
    rating: 'super' | 'correct' | 'bof' | null;
    /** Adresse de la photo souvenir sur le serveur de la maison, ou null */
    photo: string | null;
}

export interface HistoryView {
    items: HistoryEntry[];
    month: { count: number; total: number; unknown: number };
}

/** « Trouve-moi autre chose » : la recherche en cours (tâche Claude ou Groq). */
export interface SearchState {
    running: boolean;
    via: 'claude' | 'groq' | null;
    at: number | null;
    error: string | null;
    added: number | null;
    available: 'claude' | 'groq' | null;
}

export const RATING_LABEL: Record<NonNullable<HistoryEntry['rating']>, string> = { super: 'Super', correct: 'Correct', bof: 'Bof' };

/** « 27 $ », « 13,50 $ » */
export const money = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} $`;
