// ── Veillée de Noël : ce qui se décide sans toucher à la maison ─────────────
//
// Fonctions pures, testées dans veilleeLogic.test.js. veillee.js lance la bûche,
// le jazz, le feu de cheminée et le degré de plus, puis remet tout comme avant.

/** La veillée ne s'affiche qu'en décembre (calendrier, Noël, après Noël). */
export const veilleeAvailable = (season) => ['advent', 'christmas', 'after'].includes(season?.phase);

/** Durée d'une veillée : elle s'arrête seule au bout de 3 h. */
export const VEILLEE_MS = 3 * 3600_000;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pièces du feu : le salon et la salle à manger. */
export const FIRE_ROOMS = /\b(salon|salle a manger)\b/;

/**
 * Le rôle de chaque lampe des pièces du feu.
 * Le plafonnier s'éteint, les rubans et les Play font les flammes, les autres font les braises.
 * Une prise (pas de couleur) ne bouge pas.
 * @param lights [{ id, name, color }]
 */
export function fireLightPlan(lights = []) {
    const plan = { off: [], flame: [], ember: [] };
    for (const l of lights) {
        const name = norm(l.name);
        if (/plafon|plafond|suspension|lustre/.test(name)) plan.off.push(l.id);
        else if (!l.color) continue;
        else if (/play|strip|ruban|canape/.test(name)) plan.flame.push(l.id);
        else plan.ember.push(l.id);
    }
    // Sans ruban ni Play, une braise sur deux fait les flammes
    if (!plan.flame.length && plan.ember.length > 1) plan.flame = plan.ember.filter((_, i) => i % 2 === 0);
    plan.ember = plan.ember.filter((id) => !plan.flame.includes(id));
    return plan;
}

/** Couleurs d'un feu de bois (xy Hue) : orange profond, ambre, rouge braise. */
const FIRE_XY = [[0.6, 0.38], [0.57, 0.4], [0.63, 0.35], [0.66, 0.33]];

/** État d'une braise : ambre, lumière basse. */
export const emberState = () => ({ on: true, xy: [0.56, 0.4], bri: 70, transitiontime: 30 });

/**
 * Un pas de flamme : une couleur et une luminosité qui varient doucement.
 * @param rand () => [0, 1)
 */
export function flameStep(rand = Math.random) {
    const xy = FIRE_XY[Math.floor(rand() * FIRE_XY.length)];
    return { on: true, xy, bri: Math.round(70 + rand() * 90), transitiontime: Math.round(15 + rand() * 20) };
}

/** Consigne de la veillée : un degré de plus que la consigne du moment, 25 °C au plus. */
export const cozyTarget = (current) => (typeof current === 'number' ? Math.min(25, current + 1) : null);

/** Pertinence de la carte de l'accueil. */
export function veilleeRelevance(status, season) {
    const state = (relevance, summary, until = null) => ({ id: 'veillee', relevance, summary, until });
    if (status?.active) return state('now', 'veillée en cours', status.endsAt ?? null);
    if (!veilleeAvailable(season)) return state('hidden', 'hors décembre');
    return state('calm', 'à lancer ce soir');
}

/**
 * « Lance la veillée », « mode veillée », « fin de la veillée », « arrête la veillée ».
 * @returns 'start' | 'stop' | null
 */
export function veilleeCommand(text) {
    const t = norm(text);
    if (!/\bveillee\b/.test(t)) return null;
    if (/\b(arret\w*|stop\w*|fin|termin\w*|coupe\w*|eteins?)\b/.test(t)) return 'stop';
    return 'start';
}
