// ── Widgets de l'accueil : identifiants, libellés et forme de la liste « Maintenant » ──
//
// La pertinence se calcule sur le Pi (server/homeFeedLogic.js, servie par /api/home-feed).
// L'écran garde seulement ce qu'il affiche : les libellés et l'ordre de l'écran de réglages.

/** alert : il faut agir · now : utile maintenant · calm : rien de neuf · hidden : rien à montrer */
export type Relevance = 'alert' | 'now' | 'calm' | 'hidden';
/** Réglage par widget : Auto suit la pertinence, Toujours garde la carte, Masqué l'enlève. */
export type Pin = 'auto' | 'always' | 'hidden';

export type WidgetId = 'guard' | 'city' | 'cooper' | 'mail' | 'music' | 'house' | 'moves' | 'sky' | 'journal';

/** La forme de la carte Déplacements, choisie par le Pi avec la pastille. */
export type MovesForm = 'communauto' | 'trip' | 'metro' | 'communauto-idle' | null;

/** Un widget dans la liste « Maintenant » du Pi. */
export interface FeedItem {
    id: WidgetId;
    relevance: Relevance;
    /** Ce que dit la pastille, en quelques mots */
    summary: string;
    /** Jusqu'à quand c'est vrai (ms), si une heure le décide */
    until: number | null;
    /** Place à l'écran : cartes d'abord, puis pastilles ; null si caché */
    order: number | null;
    form?: MovesForm;
}

export interface HomeFeed {
    generatedAt: number;
    items: FeedItem[];
    /** Cartes pleines de « Maintenant », de la plus pressante à la plus calme */
    cards: WidgetId[];
    /** Pastilles du bandeau, dans l'ordre du registre */
    chips: WidgetId[];
    /** Prochaine bascule d'heure : l'écran relit la liste à ce moment-là */
    nextChange: number | null;
}

/** Ordre du registre (le même que sur le Pi), pour l'écran de réglages. */
export const WIDGET_ORDER: WidgetId[] = ['guard', 'city', 'cooper', 'mail', 'music', 'house', 'moves', 'sky', 'journal'];

export interface WidgetMeta {
    label: string;
    /** Quand il passe en carte en Auto (ligne de l'écran de réglages) */
    when: string;
    /** Absent de l'accueil du téléphone */
    tabletOnly?: boolean;
}

export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
    guard: { label: 'Alarme', when: 'Quand le mode alarme ou vacances est actif' },
    city: { label: 'En ville', when: 'Alerte météo, collecte la veille au soir, avis du quartier' },
    cooper: { label: 'Cooper', when: 'Toujours affiché, en tête s’il est oublié' },
    mail: { label: 'Courrier', when: 'Du passage du facteur jusqu’à l’ouverture de la boîte' },
    music: { label: 'Musique', when: 'Quand tu as l’habitude d’écouter à ce moment, et de 7 h à 9 h' },
    house: { label: 'Maison', when: 'Une porte ou une fenêtre ouverte, une pile faible' },
    moves: { label: 'Déplacements', when: 'BIXI, bus, métro et Communauto : à l’heure de départ de chacun, pendant une recherche Communauto, ou si le métro est perturbé' },
    sky: { label: 'Ciel', when: 'Le soir, et toujours quand une aurore est possible' },
    journal: { label: 'Journal', when: 'Jamais en carte : pastille seulement', tabletOnly: true },
};

/** Cooper reste toujours une carte : c'est le widget préféré de la maison. */
export const DEFAULT_PINS: Record<WidgetId, Pin> = {
    guard: 'auto', city: 'auto', cooper: 'always', mail: 'auto', music: 'auto', house: 'auto', moves: 'auto', sky: 'auto', journal: 'auto',
};
