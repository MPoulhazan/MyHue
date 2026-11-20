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

export type WidgetId = 'guard' | 'city' | 'cooper' | 'mail' | 'music' | 'house' | 'bixi' | 'metro' | 'communauto' | 'sky' | 'journal';

export interface WidgetState {
    id: WidgetId;
    relevance: Relevance;
    /** Ce que dit la pastille, en quelques mots */
    summary: string;
}

/** Ordre du registre : il départage deux widgets de même pertinence. */
export const WIDGET_ORDER: WidgetId[] = ['guard', 'city', 'cooper', 'mail', 'music', 'house', 'bixi', 'metro', 'communauto', 'sky', 'journal'];

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
    bixi: { label: 'BIXI', when: 'De 7 h à 9 h en semaine' },
    metro: { label: 'Métro', when: 'Hors saison BIXI : de 7 h à 9 h en semaine, ou si une ligne est perturbée' },
    communauto: { label: 'Communauto', when: 'Pendant une recherche, en tête quand une auto est trouvée' },
    sky: { label: 'Ciel', when: 'Le soir, et toujours quand une aurore est possible' },
    journal: { label: 'Journal', when: 'Jamais en carte : pastille seulement', tabletOnly: true },
};

/** Cooper reste toujours une carte : c'est le widget préféré de la maison. */
export const DEFAULT_PINS: Record<WidgetId, Pin> = {
    guard: 'auto', city: 'auto', cooper: 'always', mail: 'auto', music: 'auto', house: 'auto', bixi: 'auto', metro: 'auto', communauto: 'auto', sky: 'auto', journal: 'auto',
};

/** Cartes pleines au plus dans « Maintenant », Cooper compris. */
export const MAX_CARDS = 5;

const state = (id: WidgetId, relevance: Relevance, summary: string): WidgetState => ({ id, relevance, summary });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ── Heures du mode Auto (heure de la tablette, à Montréal) ───────────────────

/** Heure de pointe du matin : de 7 h à 9 h, du lundi au vendredi. */
export const isCommute = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 7 && d.getHours() < 9;
/** Le soir : de 18 h à 1 h du matin. */
export const isEvening = (d: Date) => d.getHours() >= 18 || d.getHours() < 1;

// ── Un widget à la fois ──────────────────────────────────────────────────────

interface GuardIn {
    mode: string | null;
    events: { at: number }[];
}
export function guardRelevance(v: GuardIn | null, now = Date.now()): WidgetState {
    if (!v) return state('guard', 'hidden', 'alarme pas encore lue');
    if (!v.mode) return state('guard', 'calm', 'désactivée');
    const label = v.mode === 'vacation' ? 'mode vacances' : 'mode alarme';
    // Un passage dans la dernière demi-heure : la carte passe en tête
    if (v.events.some((e) => now - e.at < 30 * 60_000)) return state('guard', 'alert', `passage, ${label}`);
    return state('guard', 'now', `${label} actif`);
}

interface CityIn {
    enabled: boolean;
    events: { level: string; bucket: string; title: string; action?: string }[];
    takeover: unknown | null;
}
export function cityRelevance(v: CityIn | null): WidgetState {
    if (!v?.enabled || !v.events.length) return state('city', 'hidden', 'rien en ville');
    const danger = v.events.find((e) => e.level === 'danger');
    if (v.takeover || danger) return state('city', 'alert', danger?.title ?? 'alerte en ville');
    const bin = v.events.find((e) => e.action === 'collecte');
    if (bin) return state('city', 'now', bin.title);
    const today = v.events.find((e) => e.bucket === 'now' || e.bucket === 'today');
    if (today) return state('city', 'now', today.title);
    return state('city', 'calm', plural(v.events.length, 'avis'));
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
    today?: { delivery: number | null };
}
export function mailRelevance(v: MailIn | null): WidgetState {
    if (!v?.enabled || !v.sensor) return state('mail', 'hidden', 'pas de capteur');
    if (v.night) return state('mail', 'alert', 'ouverte la nuit');
    if (v.waiting) return state('mail', 'now', 'courrier dans la boîte');
    if (v.pending) return state('mail', 'now', 'passage à confirmer');
    return state('mail', 'calm', v.today?.delivery ? 'courrier relevé' : 'pas encore passé');
}

interface SensorIn {
    type: string;
    isOnline: boolean;
    props: { battery: number | null; isOpen: boolean | null; leak?: boolean | null; smoke?: boolean | null };
}
export function houseRelevance(sensors: SensorIn[]): WidgetState {
    if (sensors.some((s) => s.type === 'smoke' && s.props.smoke)) return state('house', 'alert', 'fumée');
    if (sensors.some((s) => s.type === 'water_leak' && s.props.leak)) return state('house', 'alert', 'fuite d’eau');
    const open = sensors.filter((s) => s.type === 'door' && s.props.isOpen).length;
    if (open) return state('house', 'now', open > 1 ? `${open} portes ouvertes` : 'porte ouverte');
    if (sensors.some((s) => s.props.battery != null && s.props.battery < 20)) return state('house', 'now', 'pile faible');
    if (sensors.some((s) => !s.isOnline)) return state('house', 'now', 'capteur hors ligne');
    return state('house', 'calm', 'tout est fermé');
}

interface BixiIn {
    enabled: boolean;
    configured: boolean;
    season: string;
    window: boolean;
    verdict?: { text: string };
}
export function bixiRelevance(v: BixiIn | null, now = new Date()): WidgetState {
    if (!v?.enabled || !v.configured || v.season === 'closed') return state('bixi', 'hidden', 'hors saison');
    const said = v.verdict?.text.toLowerCase();
    // La fenêtre de départ du serveur, ou toute l'heure de pointe du matin
    if (v.window || isCommute(now)) return state('bixi', 'now', said ?? 'heure de départ');
    return state('bixi', 'calm', said ?? 'pas l’heure de partir');
}

interface MetroIn {
    metro: { show: boolean; error: string | null; lines: { ok: boolean }[] } | null;
}
export function metroRelevance(v: MetroIn | null, now = new Date()): WidgetState {
    const m = v?.metro;
    if (!m?.show) return state('metro', 'hidden', 'saison BIXI');
    if (!m.error && m.lines.some((l) => !l.ok)) return state('metro', 'now', 'ligne perturbée');
    const said = m.error ? 'état inconnu' : 'service normal';
    return state('metro', isCommute(now) ? 'now' : 'calm', said);
}

interface CommunautoIn {
    updatedAt: number | null;
    radiusM: number;
    nearby: { dist: number }[];
    search: { active: boolean; radiusM: number; found: { gone?: boolean; dist: number; model: string }[] } | null;
    booked?: { car: { model: string } } | null;
}
/** Recherche en cours : carte ; une auto trouvée et encore libre : en tête. Au repos : pastille. */
export function communautoRelevance(v: CommunautoIn | null): WidgetState {
    if (!v) return state('communauto', 'hidden', 'pas encore lu');
    if (v.booked) return state('communauto', 'alert', `${v.booked.car.model} bloquée`);
    if (v.search?.active) {
        const live = v.search.found.filter((c) => !c.gone);
        if (live.length) return state('communauto', 'alert', `${live[0].model} à ${live[0].dist} m`);
        return state('communauto', 'now', `recherche ${v.search.radiusM} m`);
    }
    if (!v.updatedAt) return state('communauto', 'calm', 'pas de réponse');
    const n = v.nearby.length;
    return state('communauto', 'calm', n ? `${n} à ${v.radiusM} m` : `aucune à ${v.radiusM} m`);
}

interface SkyIn {
    aurora: { level: string } | null;
    highlight: { kind: string };
    moon?: { fraction: number };
    night?: { quality: { level: string } };
}
export function skyRelevance(v: SkyIn | null, now = new Date()): WidgetState {
    if (!v) return state('sky', 'hidden', 'ciel pas encore lu');
    if (v.highlight.kind === 'aurora' && v.aurora?.level === 'alert') return state('sky', 'alert', 'aurore possible');
    const said = v.moon ? `lune ${Math.round(v.moon.fraction * 100)} %` : 'ciel ordinaire';
    // Le soir, sauf si le ciel est bouché et qu'il n'y a rien d'autre que la lune
    const worth = v.night?.quality.level !== 'bad' || v.highlight.kind !== 'moon';
    return state('sky', isEvening(now) && worth ? 'now' : 'calm', said);
}

interface MusicIn {
    suggestion: { habit: boolean; name: string };
}
/** Une habitude d'écoute sur ce créneau, ou le matin : la carte propose de lancer la musique. */
export function musicRelevance(v: MusicIn | null, playing: boolean, now = new Date()): WidgetState {
    if (!v) return state('music', 'hidden', 'pas encore lu');
    if (playing) return state('music', 'calm', 'en lecture');
    const name = v.suggestion.name;
    if (v.suggestion.habit) return state('music', 'now', name);
    const morning = now.getHours() >= 7 && now.getHours() < 9;
    return state('music', morning ? 'now' : 'calm', `${name} proposé`);
}

/** Le journal ne devient jamais une carte en Auto : pastille seulement. */
export const journalRelevance = (count = 0): WidgetState =>
    state('journal', 'calm', count ? plural(count, 'évènement') : 'rien pour l’instant');

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
