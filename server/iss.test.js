import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPasses, isSunlit, dirName, brightness } from './iss.js';
import { issSoon, pickHighlight } from './astro.js';

const MIN = 60_000;
const s = (i, el, az, sunlit = true, dark = true) => ({ ts: i * 30_000, el, az, sunlit, dark });

test('findPasses garde la partie éclairée sous un ciel sombre', () => {
    const samples = [s(0, 5, 200), s(1, 12, 225), s(2, 40, 180), s(3, 60, 135), s(4, 30, 100, false), s(5, 15, 90, false), s(6, 5, 90)];
    const [p] = findPasses(samples);
    assert.equal(p.start, 30_000);
    assert.equal(p.end, 90_000);
    assert.equal(p.maxEl, 60);
    assert.equal(p.from, 'sud-ouest');
    assert.equal(p.to, 'sud-est');
    assert.equal(p.brightness, 'très brillante');
    // Ciel trop clair : rien
    assert.deepEqual(findPasses(samples.map((x) => ({ ...x, dark: false }))), []);
});

test('isSunlit : ombre cylindrique de la Terre', () => {
    const sun = { x: 1, y: 0, z: 0 };
    assert.equal(isSunlit({ x: 6800, y: 0, z: 0 }, sun), true); // côté jour
    assert.equal(isSunlit({ x: -6800, y: 0, z: 0 }, sun), false); // derrière la Terre
    assert.equal(isSunlit({ x: -3000, y: 6700, z: 0 }, sun), true); // côté nuit mais hors du cône d'ombre
});

test('dirName et brightness', () => {
    assert.equal(dirName(0), 'nord');
    assert.equal(dirName(359), 'nord');
    assert.equal(dirName(225), 'sud-ouest');
    assert.equal(brightness(20), 'basse sur l’horizon');
    assert.equal(brightness(45), 'brillante');
});

test('un passage haut ce soir passe en tête de la home, sauf aurore', () => {
    const now = 0;
    const pass = { start: 2 * 60 * MIN, end: 2 * 60 * MIN + 5 * MIN, maxEl: 70, from: 'ouest', to: 'est', durationMin: 5, brightness: 'très brillante' };
    const moon = { nextFull: { name: 'Lune du castor' } };
    assert.equal(issSoon([pass], now), pass);
    assert.equal(issSoon([{ ...pass, maxEl: 20 }], now), null);
    assert.equal(pickHighlight({ aurora: null, events: [], planets: [], moon, iss: [pass] }, now).kind, 'iss');
    assert.equal(pickHighlight({ aurora: { level: 'alert', label: 'x', maxTonight: 7 }, events: [], planets: [], moon, iss: [pass] }, now).kind, 'aurora');
});
