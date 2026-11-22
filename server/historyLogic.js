/**
 * « Nos sorties » (lot 5 de « Sortie à deux v2 ») : l'historique des sorties faites, l'avis du
 * lendemain (« C'était bien ? »), les dépenses du mois et les idées ajoutées sur demande.
 * Fonctions pures, testées dans historyLogic.test.js.
 */

export const RATINGS = ['super', 'correct', 'bof'];
export const RATING_LABEL = { super: 'Super', correct: 'Correct', bof: 'Bof' };

const dayOf = (ts, tz) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
const hourOf = (ts, tz) => Number(new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2));

/**
 * Ce que la sortie a coûté à deux, d'après le prix annoncé : « 13,50 $/pers. » → 27, « Gratuit » → 0,
 * « 40 $ » → 40, « $$ » ou rien → null (inconnu, à saisir).
 */
export const spentOf = (price, free = false) => {
    if (free || /^gratuit/i.test(price || '')) return 0;
    const m = typeof price === 'string' ? price.match(/(\d+(?:[.,]\d{1,2})?)\s*\$/) : null;
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    const each = /pers|personne|chacun|par t[êe]te|adulte/i.test(price);
    return Math.round(n * (each ? 2 : 1) * 100) / 100;
};

/** L'entrée d'historique d'une sortie qui vient de finir. */
export const archiveEntry = (plan, idea = null) => ({
    id: `h${plan.start}`,
    ideaId: plan.ideaId,
    title: plan.title,
    kind: plan.kind,
    where: plan.where || null,
    start: plan.start,
    end: plan.end,
    by: plan.by || null,
    to: plan.to || null,
    price: idea?.price ?? plan.price ?? null,
    spent: spentOf(idea?.price ?? plan.price ?? null, idea?.free ?? plan.free ?? false),
    rating: null,
    photo: null,
});

/**
 * La sortie dont on attend l'avis : finie, pas encore notée, et on est encore avant midi le lendemain.
 * Le soir même (après la fin) compte aussi : on peut répondre en rentrant.
 */
export const pendingReview = (history = [], now = Date.now(), tz = 'America/Toronto') => {
    const last = [...history].sort((a, b) => b.start - a.start)[0];
    if (!last || last.rating || last.end > now) return null;
    const today = dayOf(now, tz);
    const day = dayOf(last.start, tz);
    if (day === today) return last;
    const next = dayOf(last.start + 26 * 3600_000, tz) === today || dayOf(last.start + 22 * 3600_000, tz) === today;
    return next && hourOf(now, tz) < 12 ? last : null;
};

/** Le mois en cours : nombre de sorties, total dépensé, et combien n'ont pas de montant. */
export const monthSummary = (history = [], now = Date.now(), tz = 'America/Toronto') => {
    const month = dayOf(now, tz).slice(0, 7);
    const mine = history.filter((h) => dayOf(h.start, tz).slice(0, 7) === month);
    const known = mine.filter((h) => h.spent != null);
    return {
        count: mine.length,
        total: Math.round(known.reduce((s, h) => s + h.spent, 0) * 100) / 100,
        unknown: mine.length - known.length,
    };
};

/** Ce que la tâche Claude du mercredi lit : les sorties notées, pour faire mieux la fois suivante. */
export const ratingsForClaude = (history = []) =>
    [...history].filter((h) => h.rating).sort((a, b) => b.start - a.start).slice(0, 20)
        .map((h) => ({ title: h.title, kind: h.kind, where: h.where, rating: h.rating }));

/**
 * Ajoute des idées à celles de la semaine (« Trouve-moi autre chose ») : sans doublon de titre,
 * en gardant les idées en cours, 16 au plus.
 */
export const appendIdeas = (current = [], added = [], max = 16) => {
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const seen = new Set(current.map((o) => norm(o.title)));
    const fresh = added.filter((o) => {
        const k = norm(o.title);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return [...current, ...fresh].slice(-max);
};

/** Le texte que la tablette renvoie au modèle de secours : un tableau JSON d'idées, sans plus. */
export const parseIdeasJson = (text) => {
    if (typeof text !== 'string') return [];
    const from = text.indexOf('[');
    const to = text.lastIndexOf(']');
    if (from < 0 || to <= from) return [];
    try {
        const arr = JSON.parse(text.slice(from, to + 1));
        return Array.isArray(arr) ? arr.filter((o) => o && typeof o.title === 'string').slice(0, 6) : [];
    } catch {
        return [];
    }
};
