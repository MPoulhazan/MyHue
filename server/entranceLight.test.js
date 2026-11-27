// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRange, sceneFor, shouldSweep, whiteState, pickEntrance, countMotion } from './entranceLight.js';
test('whiteState : kelvins en mireds bornés, pourcentage en 1-254', () => {
    assert.deepEqual(whiteState({ ct: 4000, bright: 100 }), { on: true, bri: 254, transitiontime: 3, ct: 250 });
    assert.equal(whiteState({ ct: 2000, bright: 50 }, { min: 153, max: 454 }).ct, 454);
    assert.equal(whiteState({ ct: 2700, bright: 0 }).bri, 1);
    assert.equal(whiteState({ ct: 2700, bright: 100 }, null).ct, undefined, 'ampoule blanche sans température');
});

test('pickEntrance : réglée, sinon nommée Entrée, sinon pièce Entrée', () => {
    const lights = { 1: { name: 'Salon' }, 17: { name: 'Entrée' }, 18: { name: 'Hue white lamp 1' } };
    assert.equal(pickEntrance(lights, {}, '1'), '1');
    assert.equal(pickEntrance(lights, {}, '99'), '17');
    assert.equal(pickEntrance({ 18: lights[18] }, { 86: { type: 'Room', name: 'Entrée', lights: ['18'] } }), '18');
    assert.equal(pickEntrance({ 1: lights[1] }, {}), null);
});

const ts = (hhmm) => Date.parse(`2026-11-16T${hhmm}:00-05:00`);
const cfg = { nightFrom: '22:30', nightTo: '06:30', day: { ct: 4000, bright: 100 }, night: { ct: 2700, bright: 12 } };

test('inRange : plage qui passe minuit', () => {
    assert.equal(inRange(23 * 60, '22:30', '06:30'), true);
    assert.equal(inRange(3 * 60, '22:30', '06:30'), true);
    assert.equal(inRange(6 * 60 + 30, '22:30', '06:30'), false);
    assert.equal(inRange(12 * 60, '22:30', '06:30'), false);
    assert.equal(inRange(12 * 60, '08:00', '18:00'), true);
});

test('sceneFor : douce la nuit, franche le jour', () => {
    assert.equal(sceneFor(ts('23:15'), cfg).mode, 'night');
    assert.equal(sceneFor(ts('05:50'), cfg).bright, 12);
    assert.equal(sceneFor(ts('18:00'), cfg).mode, 'day');
    assert.equal(sceneFor(ts('07:00'), cfg).ct, 4000);
});

test('shouldSweep : on éteint une lampe allumée sans passage récent', () => {
    const now = 1_000_000;
    assert.equal(shouldSweep(now, null, 120, null), true, 'aucun passage depuis le démarrage');
    assert.equal(shouldSweep(now, now - 121_000, 120, null), true, 'dernier passage il y a plus de 2 min');
    assert.equal(shouldSweep(now, now - 30_000, 120, null), false, 'quelqu’un vient de passer');
    assert.equal(shouldSweep(now, now - 500_000, 120, { scene: {} }), false, 'extinction déjà programmée');
});

test('countMotion : vue une 2ᵉ fois pendant qu’elle est allumée, minuterie longue', () => {
    const t0 = 1_000_000;
    const first = countMotion({}, t0);
    assert.deepEqual(first, { motions: 1, lastMotionAt: t0, long: false }, 'un passage en haut de l’escalier');
    assert.equal(countMotion(first, t0 + 5_000).long, false, 'le même message répété ne compte pas');
    const second = countMotion(first, t0 + 70_000);
    assert.equal(second.long, true, 'revue une minute plus tard : quelqu’un est resté en bas');
    assert.equal(countMotion({ motions: 0, long: false }, t0).long, false, 'allumée par la porte, puis un mouvement');
    assert.equal(countMotion(second, t0 + 71_000).long, true, 'reste longue');
});
