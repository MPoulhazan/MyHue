// ── Matin de Noël « Il est passé ! » : ce qui se décide sans toucher à la maison ──
//
// Fonctions pures, testées dans noelLogic.test.js. noel.js écoute le premier mouvement
// du 25 au matin, fait scintiller le salon, joue un chant et affiche l'écran de la tablette.

import { christmasSeason } from './seasonLogic.js';

/** La fenêtre du matin de Noël : de 5 h à midi. */
export const MORNING_FROM_H = 5;
export const MORNING_TO_H = 12;
/** Le salon redevient normal au bout de 5 min. */
export const MAGIC_MS = 5 * 60_000;
/** Le scintillement doré dure la première minute et demie. */
export const SPARKLE_MS = 90_000;

const hourAt = (now, tz) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));

/** Le 25 décembre entre 5 h et midi. */
export function isChristmasMorning(now, tz) {
    if (christmasSeason(now, tz).phase !== 'christmas') return false;
    const h = hourAt(now, tz);
    return h >= MORNING_FROM_H && h < MORNING_TO_H;
}

/**
 * Le premier mouvement du matin déclenche la magie, une fois par an,
 * pas en mode alarme ou vacances (la maison est vide).
 */
export const shouldFire = ({ now, tz, firedYear, year, guardMode }) =>
    isChristmasMorning(now, tz) && firedYear !== year && !guardMode;

/** Or de Noël (xy Hue) : doré clair, doré chaud, ambre. */
const GOLD_XY = [[0.48, 0.43], [0.5, 0.42], [0.53, 0.41]];

/** Une étincelle : une lampe monte d'un coup en or vif, puis redescend au pas suivant. */
export function sparkleStep(rand = Math.random) {
    const bright = rand() < 0.5;
    return { on: true, xy: GOLD_XY[Math.floor(rand() * GOLD_XY.length)], bri: bright ? 254 : 110, transitiontime: bright ? 2 : 8 };
}

/** L'état doré calme qui suit le scintillement. */
export const goldState = () => ({ on: true, xy: [0.5, 0.42], bri: 200, transitiontime: 20 });

/** Ce que Cooper a vu cette nuit. */
export const COOPER_LINES = [
    'Cooper a monté la garde toute la nuit. Il jure qu’un gros monsieur en rouge lui a gratté les oreilles.',
    'Cooper a entendu des grelots vers 3 h. Il a fait semblant de dormir, comme on lui avait dit.',
    'Cooper a trouvé une miette de biscuit sous le sapin. Il ne dira rien, mais il sait.',
];
export const cooperLine = (year) => COOPER_LINES[Math.abs(Number(year) || 0) % COOPER_LINES.length];

/**
 * « Le père Noël est passé ? » ; « Est-ce qu'il est passé ? » seulement le 25
 * (le reste de l'année, c'est plutôt le facteur).
 */
export function isSantaQuestion(text, phase = null) {
    const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/\b(pere noel|santa)\b/.test(t)) return true;
    if (phase !== 'christmas' || /\b(facteur|postier|courrier|colis|livreur|poste)\b/.test(t)) return false;
    return /\best[- ]il passe\b/.test(t) || /\bil est passe\b/.test(t);
}
