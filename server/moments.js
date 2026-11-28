/**
 * Moments : un geste qui règle plusieurs choses à la fois (lumières, clim).
 * Les boutons visibles sont les teintes : trois blancs + aléatoire (voir lightMoods.js).
 * Cinéma, Apéro, Dodo et Je pars n'ont plus de bouton mais restent utilisés par la voix,
 * les automatismes (Je pars quand plus personne n'est là) et le rappel des poubelles (Dodo).
 * Les scènes Hue sont retrouvées par leur nom ; sans scène, on se rabat sur un réglage simple.
 */
import * as journal from './journal.js';
import * as lightMoods from './lightMoods.js';
import { getHueScenes } from './hue.js';
import { executeActions } from './actions.js';
import { bus } from './events.js';

const findScene = async (pattern) => {
    const scenes = await getHueScenes();
    // Une scène de pièce plutôt qu'une scène « LightScene » isolée
    return (
        scenes.find((s) => pattern.test(s.name) && s.type === 'GroupScene') ||
        scenes.find((s) => pattern.test(s.name)) ||
        null
    );
};

const sceneOr = async (pattern, fallback) => {
    const scene = await findScene(pattern);
    return scene ? [{ type: 'activate_scene', sceneId: scene.id }] : fallback;
};

const allOff = [{ type: 'set_group_state', id: '0', state: { on: false } }];

const white = (id, label, icon) => ({
    id,
    label,
    icon,
    actions: async () => lightMoods.whiteActions(await lightMoods.currentTargets(), lightMoods.WHITES[id]),
});

let lastRandomBase = null; // pour qu'un nouvel appui change vraiment de palette

export const MOMENTS = [
    white('neutre', 'Neutre', 'sun'),
    white('chaud', 'Chaud', 'lights'),
    white('tres-chaud', 'Très chaud', 'flame'),
    {
        id: 'aleatoire',
        label: 'Aléatoire',
        icon: 'dice',
        actions: async ({ same = false } = {}) => {
            const { base, actions } = lightMoods.randomActions(await lightMoods.currentTargets(), { same, avoid: lastRandomBase });
            lastRandomBase = base;
            return actions;
        },
    },
    {
        id: 'cinema',
        label: 'Cinéma',
        icon: 'screen',
        hidden: true,
        actions: () => sceneOr(/cin[ée]ma/i, [{ type: 'set_group_state', id: '0', state: { on: true, bri: 25, ct: 450 } }]),
    },
    {
        id: 'apero',
        label: 'Apéro',
        icon: 'glass',
        hidden: true,
        actions: () => sceneOr(/ap[ée]ro/i, [{ type: 'set_group_state', id: '0', state: { on: true, bri: 150, ct: 400 } }]),
    },
    {
        id: 'dodo',
        label: 'Dodo',
        icon: 'moon',
        hidden: true,
        actions: async () => allOff,
    },
    {
        id: 'depart',
        label: 'Je pars',
        icon: 'leave',
        hidden: true,
        // Le chauffage n'est plus touché ici : heatingAway.js baisse par paliers et remet la consigne au retour
        actions: async () => allOff,
    },
];

/** Tous les moments (cube, automatismes) ; `visible` = seulement ceux qui ont un bouton. */
export const list = ({ visible = false } = {}) =>
    MOMENTS.filter((m) => !visible || !m.hidden).map(({ id, label, icon }) => ({ id, label, icon }));

/** @param {{ same?: boolean }} [opts] same = une seule couleur partout (Aléatoire, appui long) */
export const run = async (id, opts = {}) => {
    const moment = MOMENTS.find((m) => m.id === id);
    if (!moment) throw new Error(`Moment inconnu: ${id}`);
    const actions = await moment.actions(opts);
    // Rien d'allumé : on n'allume rien (on allume soi-même si on veut)
    if (!actions.length) return { ok: true, empty: true, results: [] };
    const results = await executeActions(actions, `moment « ${moment.label} »`);
    const failed = results.filter((r) => r.status === 'error');
    journal.log({ kind: 'system', title: `Moment « ${moment.label} »${failed.length ? ' (incomplet)' : ''}`, data: { moment: id } });
    bus.emit('moment', { id });
    return { ok: failed.length === 0, results };
};
