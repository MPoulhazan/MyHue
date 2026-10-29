/**
 * Moments : un geste qui règle plusieurs choses à la fois (lumières, clim).
 * Les scènes Hue sont retrouvées par leur nom ; sans scène, on se rabat sur un réglage simple.
 */
import * as broadlinkService from './broadlinkService.js';
import * as journal from './journal.js';
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

export const MOMENTS = [
    {
        id: 'cinema',
        label: 'Cinéma',
        icon: 'screen',
        actions: () => sceneOr(/cin[ée]ma/i, [{ type: 'set_group_state', id: '0', state: { on: true, bri: 25, ct: 450 } }]),
    },
    {
        id: 'apero',
        label: 'Apéro',
        icon: 'glass',
        actions: () => sceneOr(/ap[ée]ro/i, [{ type: 'set_group_state', id: '0', state: { on: true, bri: 150, ct: 400 } }]),
    },
    {
        id: 'dodo',
        label: 'Dodo',
        icon: 'moon',
        actions: async () => allOff,
    },
    {
        id: 'depart',
        label: 'Je pars',
        icon: 'leave',
        actions: async () => {
            const heating = broadlinkService.getState();
            // Clim allumée en chauffage : on passe en éco plutôt que de couper (pas de maison glacée au retour)
            const eco = heating.power && heating.mode === 'heat' && heating.temperature > 17
                ? [{ type: 'set_heating', temperature: 17 }]
                : [];
            return [...allOff, ...eco];
        },
    },
];

export const list = () => MOMENTS.map(({ id, label, icon }) => ({ id, label, icon }));

export const run = async (id) => {
    const moment = MOMENTS.find((m) => m.id === id);
    if (!moment) throw new Error(`Moment inconnu: ${id}`);
    const results = await executeActions(await moment.actions(), `moment « ${moment.label} »`);
    const failed = results.filter((r) => r.status === 'error');
    journal.log({ kind: 'system', title: `Moment « ${moment.label} »${failed.length ? ' (incomplet)' : ''}`, data: { moment: id } });
    bus.emit('moment', { id });
    return { ok: failed.length === 0, results };
};
