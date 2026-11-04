import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDownpourSoon } from './weather.js';

const NOW = Date.UTC(2026, 6, 15, 18, 0);
const Q = 15 * 60_000;
const H = 3600_000;
const quarter = (offsetMin, precip, code = 61) => ({ ts: NOW + offsetMin * 60_000, precip, prob: 80, code });
const hour = (offsetH, precip, code = 3) => ({ ts: NOW + offsetH * H, precip, code });

test('buildDownpourSoon : petite pluie ignorée', () => {
    const f = { quarters: [quarter(0, 0.3), quarter(15, 0.8), quarter(30, 0.5)], hours: [hour(0, 1.5), hour(1, 1)] };
    assert.equal(buildDownpourSoon(f, NOW), null);
});

test('buildDownpourSoon : grosse averse dans 30 min', () => {
    const f = { quarters: [quarter(0, 0), quarter(15, 0.2), quarter(30, 2.4)], hours: [hour(0, 2.6)] };
    const d = buildDownpourSoon(f, NOW);
    assert.equal(d.kind, 'downpour');
    assert.equal(d.at, NOW + 2 * Q);
});

test('buildDownpourSoon : orage repéré au quart d’heure, même avec peu de pluie', () => {
    const f = { quarters: [quarter(0, 0), quarter(15, 0.4, 95)], hours: [hour(0, 0.4)] };
    assert.equal(buildDownpourSoon(f, NOW).kind, 'storm');
});

test('buildDownpourSoon : orage prévu à l’heure quand les quarts d’heure ne le voient pas', () => {
    const f = { quarters: [quarter(0, 0), quarter(15, 0)], hours: [hour(0, 0), hour(0.5, 3, 96)] };
    assert.equal(buildDownpourSoon(f, NOW).kind, 'storm');
});

test('buildDownpourSoon : orage trop loin (dans 2 h) ignoré', () => {
    const f = { quarters: [quarter(0, 0)], hours: [hour(0, 0), hour(2, 8, 95)] };
    assert.equal(buildDownpourSoon(f, NOW), null);
});
