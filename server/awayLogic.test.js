// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseOf, radioAt, radioHours, isDark, planSimDay, roomsOnAt, HOUR, CALM_RADIOS } from './awayLogic.js';

const now = Date.UTC(2026, 10, 24, 23, 0);

test('phaseOf : quelqu’un à la maison ou inconnu = home', () => {
    assert.equal(phaseOf({ anyoneHome: true, lastDoorAt: now - 30 * HOUR, now }), 'home');
    assert.equal(phaseOf({ anyoneHome: null, lastDoorAt: now - 30 * HOUR, now }), 'home');
});

test('phaseOf : sortie courte, week-end, 24 h', () => {
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now - 2 * HOUR, now }), 'out');
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now - 12 * HOUR, now }), 'long');
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now - 24 * HOUR, now }), 'guard');
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now - HOUR, guardMode: 'vacation', now }), 'long');
    // Mode alarme seul : Cooper peut être là, veilleuse et radio restent
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now - HOUR, guardMode: 'alarm', now }), 'out');
});

test('phaseOf : porte ouverte sans téléphone = là pendant 30 min', () => {
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now, returnedAt: now - 10 * 60_000, now }), 'home');
    assert.equal(phaseOf({ anyoneHome: false, lastDoorAt: now, returnedAt: now - 31 * 60_000, now }), 'out');
});

test('radioAt : change toutes les 90 min, départ décalé', () => {
    const left = now;
    assert.equal(radioAt(left, now, 0), CALM_RADIOS[0]);
    assert.equal(radioAt(left, now + 89 * 60_000, 0), CALM_RADIOS[0]);
    assert.equal(radioAt(left, now + 90 * 60_000, 0), CALM_RADIOS[1]);
    assert.equal(radioAt(left, now, 1), CALM_RADIOS[1]);
    assert.equal(radioAt(left, now + 6 * 90 * 60_000, 0), CALM_RADIOS[6 % CALM_RADIOS.length]);
});

test('radioHours et isDark', () => {
    assert.equal(radioHours(6 * 60 + 59), false);
    assert.equal(radioHours(12 * 60), true);
    assert.equal(radioHours(21 * 60), false);
    assert.equal(isDark(-10, 12 * 60), true);
    assert.equal(isDark(2, 12 * 60), true);
    assert.equal(isDark(15, 20 * 60), false);
    assert.equal(isDark(null, 19 * 60), true);
    assert.equal(isDark(null, 12 * 60), false);
});

const seq = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

test('planSimDay : hiver, salon à la tombée, souper, salle à manger', () => {
    const plan = planSimDay(16 * 60 + 15, () => 0);
    assert.equal(plan.onAt, 16 * 60 + 15);
    assert.equal(plan.offAt, 22 * 60 + 30);
    assert.deepEqual(plan.rooms.map((x) => x.room), ['salon', 'cuisine', 'salle']);
    const kitchen = plan.rooms.find((x) => x.room === 'cuisine');
    assert.equal(kitchen.on, 18 * 60);
    assert.equal(kitchen.off - kitchen.on, 30);
});

test('planSimDay : été, rien en plein jour', () => {
    const plan = planSimDay(20 * 60 + 40, seq([0.5]));
    for (const x of plan.rooms) {
        assert.ok(x.on >= 20 * 60 + 40, `${x.room} allumé avant la nuit`);
        assert.ok(x.off <= plan.offAt);
    }
});

test('planSimDay : tout s’éteint entre 22 h 30 et 23 h 30', () => {
    for (const v of [0, 0.3, 0.7, 0.999]) {
        const plan = planSimDay(17 * 60, () => v);
        assert.ok(plan.offAt >= 22 * 60 + 30 && plan.offAt < 23 * 60 + 30);
        assert.deepEqual(roomsOnAt(plan, plan.offAt), []);
    }
});

test('roomsOnAt', () => {
    const plan = { rooms: [{ room: 'salon', on: 100, off: 200 }, { room: 'cuisine', on: 150, off: 160 }] };
    assert.deepEqual(roomsOnAt(plan, 99), []);
    assert.deepEqual(roomsOnAt(plan, 155), ['salon', 'cuisine']);
    assert.deepEqual(roomsOnAt(plan, 200), []);
});
