import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step, alertDue, alertText, smokeContext, DEFAULTS } from './stoveLogic.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-21T23:00:00Z');

test('rien ne chauffe : reste éteinte et apprend l’écart hotte − pièce', () => {
    let state = initialState();
    for (let i = 0; i < 50; i++) ({ state } = step(state, { stove: 22.4, indoor: 21.4, now: T0 + i * MIN }));
    assert.equal(state.on, false);
    assert.ok(Math.abs(state.offset - 1) < 0.05);
});

test('la hotte dépasse la pièce : allumée, puis éteinte quand elle refroidit', () => {
    let state = initialState();
    let r = step(state, { stove: 25.2, indoor: 21.5, now: T0 });
    assert.deepEqual(r.events, ['start']);
    state = r.state;
    // Trop tôt pour s'éteindre (anti-clignotement)
    r = step(state, { stove: 22.5, indoor: 21.5, now: T0 + 2 * MIN });
    assert.equal(r.state.on, true);
    r = step(state, { stove: 22.5, indoor: 21.5, now: T0 + 30 * MIN });
    assert.deepEqual(r.events, ['stop']);
    assert.equal(r.state.on, false);
});

test('montée rapide sans dépasser l’écart : allumée quand même', () => {
    const samples = [{ ts: T0 - 8 * MIN, t: 21.8, h: 45 }];
    const r = step(initialState(), { stove: 23.4, indoor: 21.5, samples, now: T0 });
    assert.deepEqual(r.events, ['start']);
});

test('sans sonde de pièce : la hotte se compare à elle-même', () => {
    const samples = [{ ts: T0 - 5 * MIN, t: 22, h: 45 }];
    const r = step(initialState(), { stove: 24.8, indoor: null, samples, now: T0 });
    assert.equal(r.state.on, true);
});

test('l’eau bout : bond d’humidité, une seule fois par 30 min', () => {
    const samples = [{ ts: T0 - 6 * MIN, t: 26, h: 48 }];
    let r = step(initialState(), { stove: 26, humidity: 60, indoor: 21.5, samples, now: T0 });
    assert.ok(r.events.includes('boil'));
    r = step(r.state, { stove: 26, humidity: 70, indoor: 21.5, samples: [...samples, { ts: T0, t: 26, h: 60 }], now: T0 + 5 * MIN });
    assert.ok(!r.events.includes('boil'));
});

test('cuisinière oubliée : alerte après 3 min d’absence, puis toutes les 20 min', () => {
    const base = { on: true, since: T0, away: true, awaySince: T0 + 10 * MIN };
    assert.equal(alertDue({ ...base, now: T0 + 12 * MIN }), null);
    assert.equal(alertDue({ ...base, now: T0 + 14 * MIN }), 'away');
    assert.equal(alertDue({ ...base, lastAwayAlertAt: T0 + 14 * MIN, now: T0 + 25 * MIN }), null);
    assert.equal(alertDue({ ...base, lastAwayAlertAt: T0 + 14 * MIN, now: T0 + 35 * MIN }), 'away');
    assert.equal(alertDue({ ...base, mutedUntil: T0 + 3 * 60 * MIN, now: T0 + 35 * MIN }), null);
});

test('longue cuisson à la maison : rappel après 1 h 30', () => {
    const base = { on: true, since: T0, away: false, awaySince: null };
    assert.equal(alertDue({ ...base, now: T0 + 80 * MIN }), null);
    assert.equal(alertDue({ ...base, now: T0 + DEFAULTS.longCookMin * MIN }), 'long');
    assert.equal(alertDue({ ...base, on: false, now: T0 + 200 * MIN }), null);
});

test('textes', () => {
    assert.match(alertText('away', { since: T0, stove: 31.26, now: T0 + 20 * MIN }), /31,3° sur la hotte, allumée depuis 18 h 00/);
    assert.match(alertText('long', { since: T0, stove: 30, now: T0 + 95 * MIN }), /depuis 1 h 35/);
    assert.match(smokeContext({ on: true, since: T0, stove: 35, now: T0 + 25 * MIN }), /chauffe depuis 25 min/);
    assert.match(smokeContext({ on: false }), /ne chauffe pas/);
});
