import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLights, whiteActions, paletteHues, randomActions, WHITES } from './lightMoods.js';
import { parseIntent } from './intentParser.js';

// Pseudo-hasard reproductible
const seeded = (seed = 1) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

const lights = {
    1: { name: 'Salon couleur', state: { on: true, reachable: true, bri: 120, hue: 1000, sat: 200, xy: [0.3, 0.3], ct: 300 } },
    2: { name: 'Salon blanc', state: { on: true, reachable: true, bri: 80, ct: 300 } },
    3: { name: 'Chambre éteinte', state: { on: false, reachable: true, bri: 80, hue: 0, xy: [0.3, 0.3], ct: 300 } },
    4: { name: 'Entrée', state: { on: true, reachable: true, bri: 200, hue: 0, xy: [0.3, 0.3], ct: 300 } },
    5: { name: 'Buanderie', state: { on: true, reachable: true, bri: 200, ct: 300 } },
    6: { name: 'Plafonnier simple', state: { on: true, reachable: true, bri: 200 } },
    7: { name: 'Débranchée', state: { on: true, reachable: false, bri: 200, hue: 0, xy: [0.3, 0.3] } },
    16: { name: 'Lampe du bar', state: { on: true, reachable: true, bri: 200, hue: 0, xy: [0.3, 0.3], ct: 300 } },
};
const groups = {
    1: { name: 'Salon', type: 'Room', lights: ['1', '2', '6'] },
    2: { name: 'Entrée', type: 'Room', lights: ['4'] },
    3: { name: 'Buanderie', type: 'Room', lights: ['5'] },
    4: { name: 'Bar', type: 'Room', lights: ['16'] },
};

test('seules les lampes allumées, joignables, hors entrée et buanderie', () => {
    const ids = pickLights(lights, groups).map((l) => l.id);
    assert.deepEqual(ids.sort(), ['1', '16', '2']);
});

test('les blancs ne touchent que la teinte, jamais l’intensité ni l’allumage', () => {
    const actions = whiteActions(pickLights(lights, groups), WHITES['tres-chaud']);
    assert.equal(actions.length, 3);
    for (const a of actions) {
        assert.equal(a.state.ct, 500);
        assert.equal(a.state.bri, undefined);
        assert.equal(a.state.on, undefined);
    }
});

test('rien d’allumé : aucune action', () => {
    assert.deepEqual(whiteActions(pickLights({ 3: lights[3] }, groups), 370), []);
    assert.deepEqual(randomActions(pickLights({ 3: lights[3] }, groups)).actions, []);
});

test('palette : des teintes variées mais regroupées autour de 2 à 4 couleurs', () => {
    const rand = seeded(42);
    for (let run = 0; run < 50; run++) {
        const { hues } = paletteHues(8, rand);
        assert.equal(hues.length, 8);
        // Les 8 lampes ne sont pas toutes de la même couleur
        const spread = Math.max(...hues) - Math.min(...hues);
        assert.ok(spread > 40, `palette trop uniforme : ${hues}`);
    }
});

test('un nouvel appui s’éloigne de la palette précédente', () => {
    const rand = seeded(7);
    let last = null;
    for (let run = 0; run < 30; run++) {
        const { base } = paletteHues(4, rand, last);
        if (last != null) {
            const d = Math.abs(base - last) % 360;
            assert.ok(Math.min(d, 360 - d) >= 60 || run === 0);
        }
        last = base;
    }
});

test('aléatoire : couleur pour les lampes couleur, blanc au hasard pour les autres, lampe du bar incluse', () => {
    const { actions } = randomActions(pickLights(lights, groups), { rand: seeded(3) });
    const byId = Object.fromEntries(actions.map((a) => [a.id, a.state]));
    assert.ok(byId[1].hue !== undefined && byId[1].sat >= 200);
    assert.ok(byId[16].hue !== undefined);
    assert.ok(byId[2].ct >= 250 && byId[2].ct <= 500);
    assert.equal(byId[1].bri, undefined);
});

test('aléatoire appui long : une seule couleur partout', () => {
    const { actions } = randomActions(pickLights(lights, groups), { same: true, rand: seeded(9) });
    const hues = new Set(actions.filter((a) => a.state.hue !== undefined).map((a) => a.state.hue));
    assert.equal(hues.size, 1);
});

// --- Voix ---

const voiceCtx = {
    lights: [{ id: '1', name: 'Bibliothèque', on: true }],
    groups: [{ id: '1', name: 'Salon', type: 'Room', lights: ['1'] }],
};
const moment = (text, ctx = voiceCtx) => parseIntent(text, ctx)?.actions?.[0];

test('voix : les trois blancs et l’aléatoire', () => {
    assert.deepEqual(moment('lumière très chaude'), { type: 'run_moment', id: 'tres-chaud' });
    assert.deepEqual(moment('mets les lumières chaudes'), { type: 'run_moment', id: 'chaud' });
    assert.deepEqual(moment('lumière neutre'), { type: 'run_moment', id: 'neutre' });
    assert.deepEqual(moment('couleurs aléatoires'), { type: 'run_moment', id: 'aleatoire' });
    assert.deepEqual(moment('une couleur au hasard partout'), { type: 'run_moment', id: 'aleatoire', same: true });
});

test('voix : une pièce citée reste un réglage de pièce', () => {
    assert.notEqual(moment('mets le salon en blanc chaud')?.type, 'run_moment');
});

test('voix : rien d’allumé, on le dit sans rien changer', () => {
    const r = parseIntent('lumière très chaude', { ...voiceCtx, lights: [{ id: '1', name: 'Bibliothèque', on: false }] });
    assert.deepEqual(r.actions, []);
    assert.match(r.message, /Aucune lampe/);
});

test('voix : le chauffage en mode chaud n’est pas une teinte', () => {
    assert.equal(moment('mets le chauffage en mode chaud')?.type, 'set_heating');
});
