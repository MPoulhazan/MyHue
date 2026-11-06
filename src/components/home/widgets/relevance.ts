// ── Pertinence des widgets de l'accueil ──────────────────────────────────────
//
// Fonctions pures, sans React ni réseau : chaque widget dit, d'après son propre
// état, s'il a quelque chose à dire. `arrange` en déduit les cartes de la colonne
// « Maintenant » et les pastilles du bandeau « Rien de neuf ».
// Les types d'entrée ne gardent que les champs lus, pour rester testables seuls.

/** alert : il faut agir · now : utile maintenant · calm : rien de neuf · hidden : rien à montrer */
export type Relevance = 'alert' | 'now' | 'calm' | 'hidden';
/** Réglage par widget : Auto suit la pertinence, Toujours garde la carte, Masqué l'enlève. */
export type Pin = 'auto' | 'always' | 'hidden';

export type WidgetId = 'city' | 'cooper' | 'mail' | 'house' | 'bixi' | 'metro' | 'sky' | 'journal';

export interface WidgetState {
    id: WidgetId;
    relevance: Relevance;
    /** Pourquoi, en une courte phrase (débogage, puis l'écran de réglages) */
    reason: string;
}

/** Ordre du registre : il départage deux widgets de même pertinence. */
export const WIDGET_ORDER: WidgetId[] = ['city', 'cooper', 'mail', 'house', 'bixi', 'metro', 'sky', 'journal'];

export interface WidgetMeta {
    label: string;
    /** Quand il passe en carte en Auto (ligne de l'écran de réglages) */
    when: string;
    /** Place actuelle sur la tablette, en attendant la colonne « Maintenant » */
    zone: 'center' | 'side';
    /** Absent de l'accueil du téléphone */
    tabletOnly?: boolean;
}

export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
    city: { label: 'En ville', when: 'Alerte météo, collecte la veille au soir, avis du quartier', zone: 'side' },
    cooper: { label: 'Cooper', when: 'Autour de midi et 18 h, en alerte s’il est oublié', zone: 'side' },
    mail: { label: 'Courrier', when: 'Du passage du facteur jusqu’à l’ouverture de la boîte', zone: 'side' },
    house: { label: 'Maison', when: 'Une porte ou une fenêtre ouverte, une pile faible', zone: 'side' },
    bixi: { label: 'BIXI', when: 'De 7 h à 9 h en semaine', zone: 'center' },
    metro: { label: 'Métro', when: 'Hors saison BIXI, si une ligne est perturbée', zone: 'center' },
    sky: { label: 'Ciel ce soir', when: 'Le soir, et toujours quand une aurore est possible', zone: 'side' },
    journal: { label: 'Journal', when: 'Jamais en carte : pastille seulement', zone: 'side', tabletOnly: true },
};

/** Cooper reste toujours une carte : c'est le widget préféré de la maison. */
export const DEFAULT_PINS: Record<WidgetId, Pin> = {
    city: 'auto', cooper: 'always', mail: 'auto', house: 'auto', bixi: 'auto', metro: 'auto', sky: 'auto', journal: 'auto',
};

/** Cartes pleines au plus dans « Maintenant », Cooper compris. */
export const MAX_CARDS = 5;

const state = (id: WidgetId, relevance: Relevance, reason: string): WidgetState => ({ id, relevance, reason });

// ── Un widget à la fois ──────────────────────────────────────────────────────

interface CityIn {
    enabled: boolean;
    events: { level: string; bucket: string; action?: string }[];
    takeover: unknown | null;
}
export function cityRelevance(v: CityIn | null): WidgetState {
    if (!v?.enabled || !v.events.length) return state('city', 'hidden', 'rien en ville');
    if (v.takeover || v.events.some((e) => e.level === 'danger')) return state('city', 'alert', 'alerte en ville');
    if (v.events.some((e) => e.action === 'collecte')) return state('city', 'now', 'collecte à sortir');
    if (v.events.some((e) => e.bucket === 'now' || e.bucket === 'today')) return state('city', 'now', 'avis pour aujourd’hui');
    return state('city', 'calm', 'rien d’urgent');
}

interface CooperIn {
    enabled: boolean;
    sensor: unknown | null;
    mood: string;
    meals: { status: string }[];
}
export function cooperRelevance(v: CooperIn | null): WidgetState {
    if (!v?.enabled || !v.sensor) return state('cooper', 'hidden', 'pas de capteur');
    if (v.mood === 'late' && v.meals.some((m) => m.status === 'late')) return state('cooper', 'alert', 'repas oublié');
    if (v.meals.some((m) => m.status === 'soon' || m.status === 'due')) return state('cooper', 'now', 'repas bientôt');
    return state('cooper', 'calm', 'repas en ordre');
}

interface MailIn {
    enabled: boolean;
    sensor: unknown | null;
    waiting: unknown | null;
    pending: boolean;
    night: unknown | null;
}
export function mailRelevance(v: MailIn | null): WidgetState {
    if (!v?.enabled || !v.sensor) return state('mail', 'hidden', 'pas de capteur');
    if (v.night) return state('mail', 'alert', 'boîte ouverte la nuit');
    if (v.waiting) return state('mail', 'now', 'courrier dans la boîte');
    if (v.pending) return state('mail', 'now', 'passage à confirmer');
    return state('mail', 'calm', 'boîte vide');
}

interface SensorIn {
    type: string;
    isOnline: boolean;
    props: { battery: number | null; isOpen: boolean | null; leak?: boolean | null };
}
export function houseRelevance(sensors: SensorIn[]): WidgetState {
    if (sensors.some((s) => s.type === 'water_leak' && s.props.leak)) return state('house', 'alert', 'fuite d’eau');
    if (sensors.some((s) => s.type === 'door' && s.props.isOpen)) return state('house', 'now', 'porte ouverte');
    if (sensors.some((s) => s.props.battery != null && s.props.battery < 20)) return state('house', 'now', 'pile faible');
    if (sensors.some((s) => !s.isOnline)) return state('house', 'now', 'capteur hors ligne');
    return state('house', 'calm', 'tout est fermé');
}

interface BixiIn {
    enabled: boolean;
    configured: boolean;
    season: string;
    window: boolean;
}
export function bixiRelevance(v: BixiIn | null): WidgetState {
    if (!v?.enabled || !v.configured || v.season === 'closed') return state('bixi', 'hidden', 'hors saison');
    if (v.window) return state('bixi', 'now', 'heure de départ');
    return state('bixi', 'calm', 'pas l’heure de partir');
}

interface MetroIn {
    metro: { show: boolean; error: string | null; lines: { ok: boolean }[] } | null;
}
export function metroRelevance(v: MetroIn | null): WidgetState {
    const m = v?.metro;
    if (!m?.show) return state('metro', 'hidden', 'saison BIXI');
    if (!m.error && m.lines.some((l) => !l.ok)) return state('metro', 'now', 'ligne perturbée');
    return state('metro', 'calm', m.error ? 'état inconnu' : 'service normal');
}

interface SkyIn {
    aurora: { level: string } | null;
    highlight: { kind: string };
}
export function skyRelevance(v: SkyIn | null): WidgetState {
    if (!v) return state('sky', 'hidden', 'ciel pas encore lu');
    if (v.highlight.kind === 'aurora' && v.aurora?.level === 'alert') return state('sky', 'alert', 'aurore possible');
    return state('sky', 'calm', 'ciel ordinaire');
}

/** Le journal ne devient jamais une carte en Auto : pastille seulement. */
export const journalRelevance = (): WidgetState => state('journal', 'calm', 'journal');

// ── Mise en page ─────────────────────────────────────────────────────────────

const RANK: Record<Relevance, number> = { alert: 0, now: 1, calm: 2, hidden: 3 };

export interface Arrangement {
    /** Cartes pleines de « Maintenant », de la plus pressante à la moins pressante */
    cards: WidgetId[];
    /** Pastilles du bandeau du bas, dans l'ordre du registre */
    chips: WidgetId[];
}

/**
 * Range les widgets. Une carte « Toujours » ne devient jamais une pastille ; les
 * autres passent en carte quand elles ont quelque chose à dire, dans la limite de
 * `max` cartes, et les plus calmes retombent dans le bandeau.
 */
export function arrange(states: WidgetState[], pins: Partial<Record<WidgetId, Pin>> = {}, max = MAX_CARDS): Arrangement {
    const pinOf = (id: WidgetId) => pins[id] ?? DEFAULT_PINS[id];
    const order = (id: WidgetId) => WIDGET_ORDER.indexOf(id);
    const visible = states.filter((s) => s.relevance !== 'hidden' && pinOf(s.id) !== 'hidden');

    const wanted = visible
        .filter((s) => pinOf(s.id) === 'always' || s.relevance === 'alert' || s.relevance === 'now')
        .sort((a, b) => RANK[a.relevance] - RANK[b.relevance] || order(a.id) - order(b.id));

    // Les cartes « Toujours » gardent leur place, les autres remplissent ce qui reste
    const always = wanted.filter((s) => pinOf(s.id) === 'always');
    const room = Math.max(0, max - always.length);
    const kept = new Set([...always, ...wanted.filter((s) => pinOf(s.id) !== 'always').slice(0, room)].map((s) => s.id));

    return {
        cards: wanted.filter((s) => kept.has(s.id)).map((s) => s.id),
        chips: visible.filter((s) => !kept.has(s.id)).sort((a, b) => order(a.id) - order(b.id)).map((s) => s.id),
    };
}
