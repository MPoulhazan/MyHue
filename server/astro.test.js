import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    phaseName, compass, nightStart, hourScore, bestWindow, skyQuality, showerCondition, parseKp, auroraOutlook, pickHighlight,
} from './astro.js';

const HOUR = 3600_000;
const OFF = -5 * 3600; // Montréal en hiver

test('phaseName couvre le cycle', () => {
    assert.equal(phaseName(0), 'Nouvelle lune');
    assert.equal(phaseName(45), 'Premier croissant');
    assert.equal(phaseName(90), 'Premier quartier');
    assert.equal(phaseName(180), 'Pleine lune');
    assert.equal(phaseName(270), 'Dernier quartier');
    assert.equal(phaseName(300), 'Dernier croissant');
    assert.equal(phaseName(358), 'Nouvelle lune');
});

test('compass donne la direction en français', () => {
    assert.equal(compass(0), 'au nord');
    assert.equal(compass(181), 'au sud');
    assert.equal(compass(350), 'au nord');
});

test('nightStart : 17 h du jour, ou de la veille avant 7 h', () => {
    const at = (h) => Date.UTC(2026, 10, 2, h) - OFF * 1000; // heure locale h le 2 nov.
    assert.equal(nightStart(at(21), OFF), at(17));
    assert.equal(nightStart(at(10), OFF), at(17));
    assert.equal(nightStart(at(3), OFF), at(17) - 24 * HOUR);
});

test('hourScore : jour nul, nuit claire sans lune parfaite, lune pleine pénalise', () => {
    assert.equal(hourScore({ sky: 'day', cloud: 0, moonUp: false, moonFraction: 0 }), 0);
    assert.equal(hourScore({ sky: 'night', cloud: 0, moonUp: false, moonFraction: 1 }), 1);
    assert.equal(hourScore({ sky: 'night', cloud: 0, moonUp: true, moonFraction: 1 }), 0.5);
    assert.equal(hourScore({ sky: 'night', cloud: 50, moonUp: false, moonFraction: 0 }), 0.5);
});

test('bestWindow garde la meilleure suite d’heures', () => {
    const hours = [0.2, 0.9, 0.9, 0.3, 0.7, 0.7, 0.7, 0.1].map((score, i) => ({ ts: i * HOUR, score }));
    const w = bestWindow(hours);
    assert.equal(w.from, 4 * HOUR);
    assert.equal(w.to, 7 * HOUR);
    assert.equal(bestWindow(hours.map((h) => ({ ...h, score: 0.1 }))), null);
});

test('skyQuality', () => {
    assert.equal(skyQuality(null).level, 'bad');
    assert.equal(skyQuality({ from: 0, to: 3 * HOUR, score: 0.8 }).level, 'good');
    assert.equal(skyQuality({ from: 0, to: HOUR, score: 0.8 }).level, 'fair');
});

test('showerCondition selon la lune', () => {
    assert.equal(showerCondition(0).level, 'excellent');
    assert.equal(showerCondition(0.3).level, 'good');
    assert.equal(showerCondition(0.5).level, 'fair');
    assert.equal(showerCondition(0.9).level, 'poor');
});

test('parseKp lit le format objet et l’ancien format tableau', () => {
    const obj = parseKp([{ time_tag: '2026-11-02T21:00:00', kp: 2.33, observed: 'predicted' }]);
    assert.deepEqual(obj, [{ ts: Date.UTC(2026, 10, 2, 21), kp: 2.33, observed: false }]);
    const arr = parseKp([['time_tag', 'kp', 'observed', 'noaa_scale'], ['2026-11-02 21:00:00', '6.00', 'observed', 'G2']]);
    assert.deepEqual(arr, [{ ts: Date.UTC(2026, 10, 2, 21), kp: 6, observed: true }]);
    assert.deepEqual(parseKp(null), []);
});

test('auroraOutlook : alerte seulement si Kp fort, nuit noire et ciel dégagé', () => {
    const now = Date.UTC(2026, 10, 2, 22);
    const hours = [0, 1, 2, 3].map((i) => ({ ts: now + i * HOUR, sky: 'night', cloud: i < 2 ? 90 : 20 }));
    const kp = [{ ts: now - HOUR, kp: 7 }, { ts: now + 2 * HOUR, kp: 7 }];
    const a = auroraOutlook(kp, hours, now);
    assert.equal(a.level, 'alert');
    assert.equal(a.window.from, now + 2 * HOUR);
    assert.equal(auroraOutlook(kp, hours.map((h) => ({ ...h, cloud: 95 })), now).level, 'cloudy');
    assert.equal(auroraOutlook([{ ts: now, kp: 5.3 }], hours, now).level, 'watch');
    assert.equal(auroraOutlook([{ ts: now, kp: 2 }], hours, now).level, 'calm');
});

test('pickHighlight : aurore > étoiles filantes proches > planète > pleine lune', () => {
    const now = 0;
    const moon = { nextFull: { name: 'Lune du castor', ts: 20 * 24 * HOUR } };
    const shower = { type: 'shower', ts: 5 * 24 * HOUR, title: 'Léonides', zhr: 15, night: 'nuit du 16 au 17 nov.', label: 'Excellent, sans lune' };
    const planets = [{ name: 'Jupiter', dir: 'au sud' }];
    assert.equal(pickHighlight({ aurora: { level: 'alert', label: 'x', maxTonight: 7 }, events: [shower], planets, moon }, now).kind, 'aurora');
    assert.equal(pickHighlight({ aurora: null, events: [shower], planets, moon }, now).title, 'Léonides dans 5 jours');
    assert.equal(pickHighlight({ aurora: null, events: [], planets, moon }, now).kind, 'planet');
    assert.equal(pickHighlight({ aurora: null, events: [], planets: [], moon }, now).title, 'Lune du castor');
});
