// ── Pertinence des widgets de l'accueil (liste « Maintenant ») ───────────────
//
// Fonctions pures, testées dans homeFeedLogic.test.js. Chaque widget dit, d'après son
// propre état et l'heure de Montréal, s'il a quelque chose à dire, ce que dit sa pastille
// et jusqu'à quand c'est vrai (`until`). `arrange` en déduit les cartes de « Maintenant »
// et les pastilles du bandeau. homeFeed.js va chercher les données et sert /api/home-feed
// à la tablette, au téléphone, à l'écran de la cuisine et au briefing.

/** alert : il faut agir · now : utile maintenant · calm : rien de neuf · hidden : rien à montrer */
export const RELEVANCES = ['alert', 'now', 'calm', 'hidden'];

/** Ordre du registre : il départage deux widgets de même pertinence. */
export const WIDGET_ORDER = ['guard', 'city', 'cooper', 'mail', 'music', 'house', 'moves', 'sky', 'journal'];

/** Cooper reste toujours une carte : c'est le widget préféré de la maison. */
export const DEFAULT_PINS = Object.fromEntries(WIDGET_ORDER.map((id) => [id, id === 'cooper' ? 'always' : 'auto']));

/** Cartes pleines au plus dans « Maintenant », Cooper compris. */
export const MAX_CARDS = 5;

const TZ = 'America/Toronto';
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const firstLower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const state = (id, relevance, summary, extra = {}) => ({ id, relevance, summary, until: null, ...extra });

// ── Heure de Montréal ────────────────────────────────────────────────────────

/** Minutes écoulées depuis minuit, heure locale. */
export const localMinutes = (now, tz = TZ) => {
    const [h, m] = new Date(now).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};
const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
/** Le prochain passage à l'une de ces heures (en minutes depuis minuit), aujourd'hui ou demain. */
export const nextAt = (now, minutes, tz = TZ) => {
    const day0 = now - (now % 60_000) - localMinutes(now, tz) * 60_000;
    const today = minutes.map((m) => day0 + m * 60_000).filter((t) => t > now).sort((a, b) => a - b);
    return today[0] ?? day0 + 24 * 3600_000 + Math.min(...minutes) * 60_000;
};

const MORNING = [7 * 60, 9 * 60];
/** Le matin : de 7 h à 9 h. */
export const isMorning = (now, tz = TZ) => {
    const m = localMinutes(now, tz);
    return m >= MORNING[0] && m < MORNING[1];
};
const EVENING = [18 * 60, 60];
/** Le soir : de 18 h à 1 h du matin. */
export const isEvening = (now, tz = TZ) => {
    const m = localMinutes(now, tz);
    return m >= EVENING[0] || m < EVENING[1];
};

// ── Un widget à la fois ──────────────────────────────────────────────────────

export function guardRelevance(v, now = Date.now()) {
    if (!v) return state('guard', 'hidden', 'alarme pas encore lue');
    if (!v.mode) return state('guard', 'calm', 'désactivée');
    const label = v.mode === 'vacation' ? 'mode vacances' : 'mode alarme';
    // Un passage dans la dernière demi-heure : la carte passe en tête
    const recent = v.events.filter((e) => now - e.at < 30 * 60_000);
    if (recent.length) return state('guard', 'alert', `passage, ${label}`, { until: Math.max(...recent.map((e) => e.at)) + 30 * 60_000 });
    return state('guard', 'now', `${label} actif`);
}

export function cityRelevance(v) {
    if (!v?.enabled || !v.events?.length) return state('city', 'hidden', 'rien en ville');
    const danger = v.events.find((e) => e.level === 'danger');
    if (v.takeover || danger) return state('city', 'alert', danger?.title ?? 'alerte en ville');
    const bin = v.events.find((e) => e.action === 'collecte');
    if (bin) return state('city', 'now', bin.title);
    const today = v.events.find((e) => e.bucket === 'now' || e.bucket === 'today');
    if (today) return state('city', 'now', today.title);
    return state('city', 'calm', plural(v.events.length, 'avis'));
}

export function cooperRelevance(v) {
    if (!v?.enabled || !v.sensor) return state('cooper', 'hidden', 'pas de capteur');
    if (v.mood === 'late' && v.meals.some((m) => m.status === 'late')) return state('cooper', 'alert', 'repas oublié');
    if (v.meals.some((m) => m.status === 'soon' || m.status === 'due')) return state('cooper', 'now', 'repas bientôt');
    return state('cooper', 'calm', 'repas en ordre');
}

export function mailRelevance(v) {
    if (!v?.enabled || !v.sensor) return state('mail', 'hidden', 'pas de capteur');
    if (v.night) return state('mail', 'alert', 'ouverte la nuit');
    if (v.waiting) return state('mail', 'now', 'courrier dans la boîte');
    if (v.pending) return state('mail', 'now', 'passage à confirmer');
    return state('mail', 'calm', v.today?.delivery ? 'courrier relevé' : 'pas encore passé');
}

export function houseRelevance(sensors = []) {
    if (sensors.some((s) => s.type === 'smoke' && s.props.smoke)) return state('house', 'alert', 'fumée');
    if (sensors.some((s) => s.type === 'water_leak' && s.props.leak)) return state('house', 'alert', 'fuite d’eau');
    const open = sensors.filter((s) => s.type === 'door' && s.props.isOpen).length;
    if (open) return state('house', 'now', open > 1 ? `${open} portes ouvertes` : 'porte ouverte');
    if (sensors.some((s) => s.props.battery != null && s.props.battery < 20)) return state('house', 'now', 'pile faible');
    if (sensors.some((s) => !s.isOnline)) return state('house', 'now', 'capteur hors ligne');
    return state('house', 'calm', 'tout est fermé');
}

/** Le soir, sauf si le ciel est bouché et qu'il n'y a rien d'autre que la lune ; toujours pour une aurore. */
export function skyRelevance(v, now = Date.now(), tz = TZ) {
    if (!v) return state('sky', 'hidden', 'ciel pas encore lu');
    if (v.highlight.kind === 'aurora' && v.aurora?.level === 'alert') return state('sky', 'alert', 'aurore possible');
    const said = v.moon ? `lune ${Math.round(v.moon.fraction * 100)} %` : 'ciel ordinaire';
    const worth = v.night?.quality.level !== 'bad' || v.highlight.kind !== 'moon';
    return state('sky', isEvening(now, tz) && worth ? 'now' : 'calm', said, { until: nextAt(now, EVENING, tz) });
}

/** Une habitude d'écoute sur ce créneau, ou le matin : la carte propose de lancer la musique. */
export function musicRelevance(v, playing, now = Date.now(), tz = TZ) {
    if (!v?.suggestion) return state('music', 'hidden', 'pas encore lu');
    if (playing) return state('music', 'calm', 'en lecture');
    const name = v.suggestion.name;
    if (v.suggestion.habit) return state('music', 'now', name);
    return state('music', isMorning(now, tz) ? 'now' : 'calm', `${name} proposé`, { until: nextAt(now, MORNING, tz) });
}

/** Le journal ne devient jamais une carte en Auto : pastille seulement. */
export const journalRelevance = (count = 0) =>
    state('journal', 'calm', count ? plural(count, 'évènement') : 'rien pour l’instant');

// ── Déplacements : BIXI et trajet, métro, Communauto dans une seule carte ───

/**
 * La forme de la carte : Communauto en cours, conseil de trajet (saison BIXI), métro (hors
 * saison), Communauto au repos. Envoyée avec la pastille : la carte montre la même chose.
 * @param v { commute, bixi, city, communauto } les vues de /api/commute, /api/bixi, /api/city, /api/communauto
 */
export function movesForm(v) {
    const ca = v.communauto;
    if (ca?.booked || ca?.search?.active) return 'communauto';
    const b = v.bixi;
    if (b?.enabled && b.configured && b.season !== 'closed') return 'trip';
    if (v.city?.metro?.show) return 'metro';
    return ca ? 'communauto-idle' : null;
}

/** L'horaire de la personne réglé sur le Pi : 45 min avant sa fenêtre, puis la fenêtre elle-même. */
const commuteOn = (c) => Boolean(c?.enabled && c.configured);
const leaving = (c) => commuteOn(c) && (c.phase === 'soon' || c.phase === 'now');
/** La prochaine bascule de phase (avant → bientôt → maintenant → après). */
const phaseUntil = (c, now, tz) => {
    if (!commuteOn(c) || c.plan?.kind !== 'work' || !c.plan.from || !c.plan.to) return null;
    const from = toMin(c.plan.from);
    const to = toMin(c.plan.to);
    return nextAt(now, [from - 45, from, to + 1], tz);
};

/**
 * En carte à l'heure de départ de chacun, pendant une recherche Communauto ou si une ligne
 * de métro est perturbée ; après le départ, pastille.
 */
export function movesRelevance(v, now = Date.now(), tz = TZ) {
    const form = movesForm(v);
    const ca = v.communauto;
    const c = v.commute;
    if (!form) return state('moves', 'hidden', 'rien à montrer', { form });

    if (form === 'communauto') {
        if (ca.booked) return state('moves', 'alert', `${ca.booked.car.model} bloquée`, { form, until: ca.booked.until ?? null });
        const s = ca.search;
        const live = s.found.filter((x) => !x.gone);
        if (live.length) return state('moves', 'alert', `${live[0].model} à ${live[0].dist} m`, { form, until: s.until ?? null });
        return state('moves', 'now', `recherche Communauto ${s.radiusM} m`, { form, until: s.until ?? null });
    }

    if (form === 'trip') {
        const verdict = v.bixi?.verdict ? firstLower(v.bixi.verdict.text) : null;
        const best = commuteOn(c) ? c.best : null;
        const said = best?.minutes != null ? `${best.title}, ${best.minutes} min` : verdict ?? 'conseil de trajet';
        // Sans horaire de trajet réglé, la fenêtre de départ des trajets BIXI
        const on = commuteOn(c) ? leaving(c) : Boolean(v.bixi?.window);
        return state('moves', on ? 'now' : 'calm', on ? said : verdict ?? said, { form, until: phaseUntil(c, now, tz) });
    }

    if (form === 'metro') {
        const m = v.city.metro;
        if (!m.error && m.lines.some((l) => !l.ok)) return state('moves', 'now', 'métro perturbé', { form });
        return state('moves', leaving(c) ? 'now' : 'calm', m.error ? 'métro : état inconnu' : 'métro : service normal', { form, until: phaseUntil(c, now, tz) });
    }

    // Communauto au repos : la plus proche, à lancer depuis la carte
    if (!ca?.updatedAt) return state('moves', 'calm', 'Communauto ne répond pas', { form });
    const n = ca.nearby.length;
    return state('moves', 'calm', n ? `${n} Communauto à ${ca.radiusM} m` : `aucune Communauto à ${ca.radiusM} m`, { form });
}

// ── Mise en page ─────────────────────────────────────────────────────────────

const RANK = { alert: 0, now: 1, calm: 2, hidden: 3 };

/**
 * Range les widgets. Une carte « Toujours » ne devient jamais une pastille ; les
 * autres passent en carte quand elles ont quelque chose à dire, dans la limite de
 * `max` cartes, et les plus calmes retombent dans le bandeau.
 * @returns { cards, chips } des identifiants, cartes de la plus pressante à la plus calme
 */
export function arrange(states, pins = {}, max = MAX_CARDS) {
    const pinOf = (id) => pins[id] ?? DEFAULT_PINS[id] ?? 'auto';
    const order = (id) => WIDGET_ORDER.indexOf(id);
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

/**
 * La liste complète servie par /api/home-feed.
 * @param d { guard, city, cooper, mail, music, playing, sensors, commute, bixi, communauto, sky, journalCount }
 */
export function buildFeed(d, pins = {}, now = Date.now(), tz = TZ) {
    const states = [
        guardRelevance(d.guard, now),
        cityRelevance(d.city),
        cooperRelevance(d.cooper),
        mailRelevance(d.mail),
        musicRelevance(d.music, d.playing, now, tz),
        houseRelevance(d.sensors),
        movesRelevance({ commute: d.commute, bixi: d.bixi, city: d.city, communauto: d.communauto }, now, tz),
        skyRelevance(d.sky, now, tz),
        journalRelevance(d.journalCount),
    ];
    const { cards, chips } = arrange(states, pins);
    const shown = [...cards, ...chips];
    const items = states.map((s) => ({ ...s, order: shown.includes(s.id) ? shown.indexOf(s.id) : null }));
    const untils = items.map((i) => i.until).filter((t) => t != null && t > now);
    return {
        generatedAt: now,
        items,
        cards,
        chips,
        // L'écran relit la liste à ce moment-là au plus tard
        nextChange: untils.length ? Math.min(...untils) : null,
    };
}

const BRIEF = { guard: 'Alarme', cooper: 'Cooper', house: 'Maison', moves: 'Déplacements' };

/**
 * Phrase du briefing : ce que « Maintenant » montre d'urgent et que le briefing ne dit pas
 * déjà (la ville, le courrier et le ciel ont leur propre phrase).
 */
export function feedBriefingLine(feed) {
    const said = (feed?.items || [])
        .filter((i) => BRIEF[i.id] && (i.relevance === 'alert' || (i.relevance === 'now' && i.id !== 'cooper')))
        .map((i) => `${BRIEF[i.id]}, ${i.summary}`);
    return said.length ? `À voir sur l’écran : ${said.join(' ; ')}.` : null;
}
