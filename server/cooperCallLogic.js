/**
 * Cooper appelle en visio sur la tablette murale : décisions pures (testées dans cooperCall.test.js).
 *
 * - Repas oublié (au moment de l'alerte, 30 min après l'heure) ou promenade pas faite à 9 h 30.
 * - « Parfois » : 1 fois sur 3, au plus un appel spontané par jour et jamais deux jours de suite.
 * - Entre 8 h et 21 h 30 seulement.
 * - Raccroché sans le nourrir : il rappelle une fois, plus fâché (10 min après « Dans 10 min »,
 *   20 min après « Raccrocher » ou un appel resté sans réponse).
 */

export const CALL_MODES = ['never', 'sometimes', 'always'];
export const CHANCE = 1 / 3;
export const HOURS = { from: 8 * 60, to: 21 * 60 + 30 };
export const WALK = { at: 9 * 60 + 30, until: 11 * 60 };
export const WAKE = 8 * 60;
/** Au-delà, l'appel resté ouvert compte comme sans réponse */
export const RING_MAX_MS = 4 * 60_000;

/** Voix C, « l'ado blasé » : lente et traînante. Le navigateur la ralentit encore un peu. */
export const LINES = {
    meal: [
        "Hey oh. Vous m'avez oublié ou quoi ? J'ai la dalle, là. Filez-moi la croquette… et plus vite que ça.",
        "Allô ? Oui, c'est Cooper. J'appelle de la cuisine. Ma gamelle est vide. Je répète : vide.",
        'Bon. Ça fait trente minutes. Je dis rien… mais je note.',
        "Allô… Le repas de {meal}, ça vous dit quelque chose ? Non ? Ben moi oui.",
    ],
    mealRetry: [
        "C'est encore moi. Deuxième appel. La prochaine fois, j'appelle mon avocat.",
        "Re-bonjour. Toujours rien dans la gamelle. Je commence à le prendre personnellement.",
    ],
    walk: [
        "Allô ? Il est neuf heures et demie. Ça pousse, là. Vraiment. On sort, ou quoi ?",
        "Bon. La laisse est près de la porte. La porte est fermée. Vous voyez le problème ?",
    ],
    walkRetry: ["C'est encore moi. Toujours pas sorti. Je dis ça, je dis rien… mais ça pousse."],
    test: ["Allô ? Oui, c'est Cooper. C'est juste un essai. Mais tant que je vous ai… une croquette, peut-être ?"],
    fed: 'Ah ben voilà ! Merci, bisous. Je raccroche, je mange.',
    walked: 'Ah, enfin. Je prends la laisse, j\'arrive.',
    later: "D'accord. Dix minutes. Je compte.",
    hung: "Tu raccroches ?! Je rappelle dans vingt minutes.",
    hungLast: "Bon. Je n'insiste pas. Mais je m'en souviendrai.",
    testEnd: 'Bon, ben, salut.',
};

export const inCallHours = (minutes) => minutes >= HOURS.from && minutes < HOURS.to;

/** Veille d'une date locale 'YYYY-MM-DD'. */
export const dayBefore = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

/**
 * Un appel spontané (pas un rappel) doit-il sonner ?
 * @param {{ mode: string, date: string, minutes: number, lastCall: string|null, roll: number, chance?: number }} p
 */
export const shouldRing = ({ mode, date, minutes, lastCall, roll, chance = CHANCE }) => {
    if (mode === 'never' || !inCallHours(minutes)) return false;
    if (mode === 'always') return true;
    if (lastCall === date || lastCall === dayBefore(date)) return false;
    return roll < chance;
};

/** Promenade du matin pas encore faite : l'heure de l'appel « Ça pousse ». */
export const walkDue = ({ minutes, walkedAt, now }) => {
    if (minutes < WALK.at || minutes >= WALK.until) return false;
    const wakeAt = now - (minutes - WAKE) * 60_000;
    return !(walkedAt && walkedAt >= wakeAt);
};

/**
 * Après un appel qui finit sans repas : quand rappeler (ms), ou null.
 * Un seul rappel par oubli ; « Dans 10 min » rappelle plus tôt.
 */
export const retryDelay = ({ outcome, wasRetry, kind }) => {
    if (wasRetry || kind === 'test') return null;
    if (outcome === 'later') return 10 * 60_000;
    if (outcome === 'hung' || outcome === 'timeout') return 20 * 60_000;
    return null;
};

/** Phrase de fin, selon comment l'appel s'est terminé. */
export const endLine = ({ outcome, kind, willRetry }) => {
    if (kind === 'test') return LINES.testEnd;
    if (outcome === 'fed') return LINES.fed;
    if (outcome === 'walked') return LINES.walked;
    if (outcome === 'later') return LINES.later;
    return willRetry ? LINES.hung : LINES.hungLast;
};

/** Réplique d'un appel ; {meal} devient « midi » ou « soir ». */
export const pickLine = ({ kind, retry, meal = '' }, roll = Math.random()) => {
    const list = kind === 'walk' ? (retry ? LINES.walkRetry : LINES.walk)
        : kind === 'test' ? LINES.test
            : retry ? LINES.mealRetry : LINES.meal;
    const line = list[Math.min(list.length - 1, Math.floor(roll * list.length))];
    return line.replace('{meal}', meal);
};
