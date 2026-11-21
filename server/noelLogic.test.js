import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChristmasMorning, shouldFire, sparkleStep, cooperLine, COOPER_LINES, isSantaQuestion } from './noelLogic.js';

const TZ = 'America/Toronto';
const t = (iso) => Date.parse(iso);

test('matin de Noël : le 25 de 5 h à midi, heure de Montréal', () => {
    assert.equal(isChristmasMorning(t('2026-12-25T04:59:00-05:00'), TZ), false);
    assert.equal(isChristmasMorning(t('2026-12-25T05:00:00-05:00'), TZ), true);
    assert.equal(isChristmasMorning(t('2026-12-25T11:59:00-05:00'), TZ), true);
    assert.equal(isChristmasMorning(t('2026-12-25T12:00:00-05:00'), TZ), false);
    assert.equal(isChristmasMorning(t('2026-12-24T08:00:00-05:00'), TZ), false);
    assert.equal(isChristmasMorning(t('2026-12-26T08:00:00-05:00'), TZ), false);
});

test('shouldFire : une fois par an, pas en mode alarme ou vacances', () => {
    const now = t('2026-12-25T07:30:00-05:00');
    assert.equal(shouldFire({ now, tz: TZ, firedYear: null, year: 2026, guardMode: null }), true);
    assert.equal(shouldFire({ now, tz: TZ, firedYear: 2025, year: 2026, guardMode: null }), true);
    assert.equal(shouldFire({ now, tz: TZ, firedYear: 2026, year: 2026, guardMode: null }), false);
    assert.equal(shouldFire({ now, tz: TZ, firedYear: null, year: 2026, guardMode: 'vacation' }), false);
    assert.equal(shouldFire({ now: t('2026-12-25T13:00:00-05:00'), tz: TZ, firedYear: null, year: 2026, guardMode: null }), false);
});

test('sparkleStep : de l’or, vif ou doux', () => {
    const bright = sparkleStep(() => 0.1);
    const soft = sparkleStep(() => 0.9);
    assert.equal(bright.bri, 254);
    assert.ok(soft.bri < 254);
    assert.ok(bright.xy[0] >= 0.45 && bright.xy[0] <= 0.55);
});

test('cooperLine : une phrase par année, toujours la même', () => {
    assert.equal(cooperLine(2026), cooperLine(2026));
    assert.ok(COOPER_LINES.includes(cooperLine(2027)));
});

test('isSantaQuestion : « il est passé ? » seulement le 25, jamais le facteur', () => {
    assert.equal(isSantaQuestion('Le père Noël est passé ?'), true);
    assert.equal(isSantaQuestion('Il est passé ?'), false);
    assert.equal(isSantaQuestion('Est-ce qu’il est passé ?', 'christmas'), true);
    assert.equal(isSantaQuestion('Il est passé ?', 'christmas'), true);
    assert.equal(isSantaQuestion('le facteur est-il passé ?', 'christmas'), false);
    assert.equal(isSantaQuestion('allume le salon', 'christmas'), false);
});
