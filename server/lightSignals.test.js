// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalsFor, inLeaveWindow, isEntrance } from './lightSignals.js';
import { buildRainSoon } from './weather.js';

const H = 3600_000;
const now = 100 * H;

test('signalsFor : rien, pluie, tempête, les deux', () => {
    const calm = { rainSoon: null, storm: { level: 'calm', window: null } };
    assert.deepEqual(signalsFor(calm, now), []);
    assert.deepEqual(signalsFor({ ...calm, rainSoon: { at: now } }, now), ['rain']);
    const storm = { rainSoon: null, storm: { level: 'likely', window: { from: now + 6 * H, to: now + 12 * H } } };
    assert.deepEqual(signalsFor(storm, now), ['storm']);
    assert.deepEqual(signalsFor({ ...storm, rainSoon: { at: now } }, now), ['rain', 'storm']);
});

test('signalsFor : tempête trop lointaine ou seulement « à surveiller », pas de signal', () => {
    assert.deepEqual(signalsFor({ storm: { level: 'likely', window: { from: now + 30 * H, to: now + 34 * H } } }, now), []);
    assert.deepEqual(signalsFor({ storm: { level: 'watch', window: { from: now + H, to: now + 2 * H } } }, now), []);
});

test('inLeaveWindow : de 1 h 30 avant à 1 h après la sortie de 8 h', () => {
    assert.equal(inLeaveWindow(6 * 60 + 29, 8), false);
    assert.equal(inLeaveWindow(6 * 60 + 30, 8), true);
    assert.equal(inLeaveWindow(9 * 60, 8), true);
    assert.equal(inLeaveWindow(9 * 60 + 1, 8), false);
    assert.equal(inLeaveWindow(18 * 60, 8), false);
});

test('isEntrance : la porte d’entrée, pas la porte balcon', () => {
    assert.equal(isEntrance('Porte d\'entrée'), true);
    assert.equal(isEntrance('Porte entree'), true);
    assert.equal(isEntrance('Porte balcon'), false);
});

test('buildRainSoon : premier quart d’heure pluvieux dans les 30 min', () => {
    const q = (min, precip, prob = 0) => ({ ts: now + min * 60_000, precip, prob });
    const dry = { quarters: [q(0, 0), q(15, 0), q(30, 0), q(45, 2)], hours: [] };
    assert.equal(buildRainSoon(dry, now), null);
    const wet = { quarters: [q(0, 0), q(15, 0.4), q(30, 1)], hours: [] };
    assert.equal(buildRainSoon(wet, now).at, now + 15 * 60_000);
    const likely = { quarters: [q(0, 0, 70)], hours: [] };
    assert.equal(buildRainSoon(likely, now).at, now);
});
