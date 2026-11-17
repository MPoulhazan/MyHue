/**
 * Teintes de toute la maison : trois blancs (neutre → très chaud) et un tirage de couleurs.
 *
 * - Seules les lampes allumées changent ; l'intensité ne bouge jamais.
 * - L'entrée et la buanderie restent à part (lampes de passage).
 * - Aléatoire : une palette harmonieuse (2 à 4 teintes bien séparées) répartie sur les lampes,
 *   chaque lampe légèrement décalée ; appui long = une seule couleur partout.
 */
import { hueClient, ensureHueConfigured } from './hue.js';

export const EXCLUDED_ROOMS = /\b(entr[ée]e|buanderie)\b/i;
export const TRANSITION = 10; // dixièmes de seconde

// Mireds : 250 = 4000 K, 370 = 2700 K, 500 = 2000 K
export const WHITES = { neutre: 250, chaud: 370, 'tres-chaud': 500 };

// Écarts entre les teintes d'une palette (en degrés) : variées sans faire fête foraine
const SCHEMES = [
    [0, 120, 240], // triade
    [0, 150, 210], // complémentaires éclatées
    [0, 90, 180, 270], // carré
    [0, 45, 180], // deux voisines + l'opposée
    [0, 60, 120], // dégradé large
];

/**
 * Lampes concernées : allumées, joignables, hors pièces exclues.
 * @returns {{ id: string, color: boolean, ct: boolean }[]}
 */
export const pickLights = (lights = {}, groups = {}) => {
    const excluded = new Set(
        Object.values(groups)
            .filter((g) => g.type === 'Room' && EXCLUDED_ROOMS.test(g.name || ''))
            .flatMap((g) => g.lights || []),
    );
    return Object.entries(lights)
        .filter(([id, l]) => !excluded.has(id) && l.state?.on && l.state?.reachable !== false)
        .map(([id, l]) => ({
            id,
            color: l.state.hue !== undefined || l.state.xy !== undefined,
            ct: l.state.ct !== undefined,
        }))
        .filter((l) => l.color || l.ct);
};

/** Même blanc partout : seules les lampes qui savent faire du blanc réglable. */
export const whiteActions = (targets, ct) =>
    targets
        .filter((l) => l.ct)
        .map((l) => ({ type: 'set_light_state', id: l.id, state: { ct, transitiontime: TRANSITION } }));

const shuffle = (arr, rand) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const hueDistance = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
};

/**
 * Teintes (degrés) pour `count` lampes : une palette tirée au hasard, chaque teinte de la palette
 * utilisée à tour de rôle, avec un petit décalage pour que deux lampes ne soient jamais identiques.
 * `avoid` = base du tirage précédent, pour qu'un nouvel appui change vraiment.
 */
export const paletteHues = (count, rand = Math.random, avoid = null) => {
    let base = Math.floor(rand() * 360);
    for (let i = 0; i < 5 && avoid != null && hueDistance(base, avoid) < 60; i++) base = Math.floor(rand() * 360);
    const scheme = SCHEMES[Math.floor(rand() * SCHEMES.length)];
    const anchors = shuffle(scheme.map((o) => (base + o) % 360), rand);
    const hues = [];
    for (let i = 0; i < count; i++) {
        const jitter = Math.round((rand() - 0.5) * 24); // ±12°
        hues.push((anchors[i % anchors.length] + jitter + 360) % 360);
    }
    return { base, hues: shuffle(hues, rand) };
};

const toHue = (deg) => Math.round((deg / 360) * 65535);
const randomCt = (rand) => Math.round(250 + rand() * 250); // 4000 K → 2000 K, jamais bleuté

/**
 * Actions du tirage aléatoire.
 * @param {{ same?: boolean, rand?: () => number, avoid?: number|null }} [opts]
 */
export const randomActions = (targets, { same = false, rand = Math.random, avoid = null } = {}) => {
    const colored = targets.filter((l) => l.color);
    const whites = targets.filter((l) => !l.color && l.ct);
    const { base, hues } = same
        ? { base: Math.floor(rand() * 360), hues: [] }
        : paletteHues(colored.length, rand, avoid);
    const actions = colored.map((l, i) => ({
        type: 'set_light_state',
        id: l.id,
        state: {
            hue: toHue(same ? base : hues[i]),
            sat: Math.round(200 + rand() * 54),
            transitiontime: TRANSITION,
        },
    }));
    const ct = randomCt(rand);
    for (const l of whites) {
        actions.push({ type: 'set_light_state', id: l.id, state: { ct: same ? ct : randomCt(rand), transitiontime: TRANSITION } });
    }
    return { base, actions };
};

/** Lampes allumées de la maison, lues sur le pont. */
export const currentTargets = async () => {
    ensureHueConfigured();
    const [lights, groups] = await Promise.all([hueClient.get('/lights'), hueClient.get('/groups')]);
    return pickLights(lights.data, groups.data);
};
