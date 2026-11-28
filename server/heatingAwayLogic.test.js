import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, ecoTarget, DEFAULTS, MIN } from './heatingAwayLogic.js';

const now = Date.UTC(2026, 10, 27, 15, 0);
const on = (temperature) => ({ power: true, mode: 'heat', temperature });

test('ecoTarget : −2° puis 17° après 2 h, 18° minimum par grand froid', () => {
    assert.equal(ecoTarget(21, 0, DEFAULTS), 19);
    assert.equal(ecoTarget(21, 119, DEFAULTS), 19);
    assert.equal(ecoTarget(21, 120, DEFAULTS), 17);
    assert.equal(ecoTarget(21, 300, DEFAULTS, -20), 18);
    assert.equal(ecoTarget(18, 0, DEFAULTS), 17);
    assert.equal(ecoTarget(16, 300, DEFAULTS), 16); // jamais plus haut que la consigne d'avant
});

test('départ : −2°, consigne d’avant gardée', () => {
    const d = decide({ st: null, heating: on(21), home: false, now });
    assert.deepEqual(d.patch, { temperature: 19 });
    assert.equal(d.st.base, 21);
    assert.equal(d.st.sent, 19);
});

test('départ : jamais de relance ni de changement thermopompe éteinte ou en clim', () => {
    assert.equal(decide({ st: null, heating: { power: false, mode: 'heat', temperature: 21 }, home: false, now }), null);
    assert.equal(decide({ st: null, heating: { power: true, mode: 'cool', temperature: 24 }, home: false, now }), null);
});

test('présence inconnue : rien', () => {
    assert.equal(decide({ st: null, heating: on(21), home: null, now }), null);
});

test('absence longue : 17° après 2 h, une seule fois', () => {
    const st = { active: true, base: 21, sent: 19, leftAt: now - 121 * MIN, userTook: false };
    const d = decide({ st, heating: on(19), home: false, now });
    assert.deepEqual(d.patch, { temperature: 17 });
    assert.equal(decide({ st: d.st, heating: on(17), home: false, now: now + 30 * MIN }), null);
});

test('retour : consigne d’avant remise', () => {
    const st = { active: true, base: 21, sent: 17, leftAt: now - 5 * 60 * MIN, userTook: false };
    const d = decide({ st, heating: on(17), home: true, now });
    assert.deepEqual(d.patch, { temperature: 21 });
    assert.equal(d.st, null);
});

test('consigne changée à la main pendant l’absence : on la laisse, même au retour', () => {
    const st = { active: true, base: 21, sent: 19, leftAt: now - 30 * MIN, userTook: false };
    const d = decide({ st, heating: on(22), home: false, now });
    assert.equal(d.st.userTook, true);
    assert.equal(d.patch, undefined);
    assert.equal(decide({ st: d.st, heating: on(22), home: false, now: now + 200 * MIN }), null);
    const back = decide({ st: d.st, heating: on(22), home: true, now });
    assert.equal(back.patch, undefined);
    assert.equal(back.st, null);
});

test('Flex D pendant l’absence : pas une main humaine, pas de palier pendant la pointe', () => {
    const st = { active: true, base: 21, sent: 19, leftAt: now - 200 * MIN, userTook: false };
    const flex = { active: true, base: 19, sent: 17 };
    assert.equal(decide({ st, heating: on(17), home: false, now, flex }), null);
    // Retour pendant la pointe : on remet quand même la consigne d'avant (le module ajoute le décalage Flex D)
    assert.deepEqual(decide({ st, heating: on(17), home: true, now, flex }).patch, { temperature: 21 });
});

test('départ pendant une pointe Flex D : la base est celle d’avant la pointe', () => {
    const d = decide({ st: null, heating: on(19), home: false, now, flex: { active: true, base: 21, sent: 19 } });
    assert.equal(d.st.base, 21);
    assert.equal(d.patch, undefined); // 21 − 2 = 19, déjà là
});

test('consigne déjà basse au départ : rien à remettre au retour', () => {
    const d = decide({ st: null, heating: on(17), home: false, now });
    assert.equal(d.patch, undefined);
    assert.equal(decide({ st: d.st, heating: on(17), home: true, now }).patch, undefined);
});
