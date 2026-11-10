// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSetpoint, pushSetpoint, setpointSteps, nightsBetween, buildChart } from './climateChart.js';

const H = 3600_000;

test('effectiveSetpoint: thermostat actif, sinon thermopompe en chauffage', () => {
    assert.equal(effectiveSetpoint({ enabled: true, target: 21 }, { power: true, mode: 'heat', temperature: 23 }), 21);
    assert.equal(effectiveSetpoint({ enabled: false }, { power: true, mode: 'heat', temperature: 23 }), 23);
    assert.equal(effectiveSetpoint({ enabled: false }, { power: false, mode: 'heat', temperature: 23 }), null);
    assert.equal(effectiveSetpoint({ enabled: false }, { power: true, mode: 'cool', temperature: 23 }), null);
});

test('pushSetpoint: seulement les changements, 48 h gardées plus le point d’avant', () => {
    let l = pushSetpoint([], 0, 21);
    l = pushSetpoint(l, H, 21);
    assert.equal(l.length, 1);
    l = pushSetpoint(l, 2 * H, 18);
    l = pushSetpoint(l, 3 * H, 19);
    l = pushSetpoint(l, 60 * H, 20);
    assert.deepEqual(l.map((p) => p.target), [19, 20]);
});

test('setpointSteps: marches bornées, trous quand éteinte, voisines fusionnées', () => {
    const list = [{ ts: 0, target: 21 }, { ts: 5 * H, target: null }, { ts: 6 * H, target: 21 }, { ts: 8 * H, target: 21 }, { ts: 9 * H, target: 18 }];
    assert.deepEqual(setpointSteps(list, 2 * H, 10 * H), [
        { from: 2 * H, to: 5 * H, target: 21 },
        { from: 6 * H, to: 9 * H, target: 21 },
        { from: 9 * H, to: 10 * H, target: 18 },
    ]);
    assert.deepEqual(setpointSteps([], 0, H), []);
    assert.deepEqual(setpointSteps([{ ts: 3 * H, target: 20 }], 0, 4 * H), [{ from: 3 * H, to: 4 * H, target: 20 }]);
});

test('nightsBetween: coucher → lever, bornés à la fenêtre', () => {
    const days = [
        { sunrise: 7 * H, sunset: 17 * H },
        { sunrise: 31 * H, sunset: 41 * H },
        { sunrise: 55 * H, sunset: 65 * H },
    ];
    assert.deepEqual(nightsBetween(days, 20 * H, 44 * H), [
        { from: 20 * H, to: 31 * H },
        { from: 41 * H, to: 44 * H },
    ]);
    // Fenêtre avant le premier lever connu : la nuit d'avant compte
    assert.deepEqual(nightsBetween(days, 2 * H, 10 * H), [{ from: 2 * H, to: 7 * H }]);
});

test('buildChart: fenêtre de 24 h, dehors, consigne seulement si demandé', () => {
    const now = 100 * H;
    const forecast = { hours: [{ ts: 70 * H, temp: -5 }, { ts: 90 * H, temp: -2 }, { ts: 110 * H, temp: 1 }], days: [] };
    const points = [{ ts: 70 * H, temperature: 20 }, { ts: 80 * H, temperature: 21, humidity: 40 }, { ts: 90 * H, temperature: null }];
    const c = buildChart({ points, forecast, withSetpoint: false, setpoints: [{ ts: 0, target: 21 }], now });
    assert.equal(c.from, 76 * H);
    assert.deepEqual(c.points, [{ ts: 80 * H, temperature: 21, humidity: 40 }]);
    assert.deepEqual(c.outdoor, [{ ts: 90 * H, temperature: -2 }]);
    assert.equal(c.setpoint, null);
    const d = buildChart({ points, forecast, withSetpoint: true, setpoints: [{ ts: 0, target: 21 }], now });
    assert.deepEqual(d.setpoint, [{ from: 76 * H, to: now, target: 21 }]);
});
