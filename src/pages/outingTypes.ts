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
}

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

export interface OutingsView {
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
