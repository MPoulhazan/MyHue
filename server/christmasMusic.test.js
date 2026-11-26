import { test } from 'node:test';
import assert from 'node:assert/strict';
import { christmasMusicOn, christmasDefault, snowIntensity } from './christmasMusic.js';

const TZ = 'America/Toronto';

test('ambiance Noël : de la dernière semaine de novembre au 31 décembre', () => {
    assert.equal(christmasMusicOn(Date.parse('2026-11-23T12:00:00-05:00'), TZ), false);
    assert.equal(christmasMusicOn(Date.parse('2026-11-24T12:00:00-05:00'), TZ), true);
    assert.equal(christmasMusicOn(Date.parse('2026-12-31T22:00:00-05:00'), TZ), true);
    assert.equal(christmasMusicOn(Date.parse('2027-01-01T10:00:00-05:00'), TZ), false);
});

test('ambiance Noël suggérée le matin, au repas et le soir', () => {
    assert.equal(christmasDefault('matin'), true);
    assert.equal(christmasDefault('soir'), true);
    assert.equal(christmasDefault('aprem'), false);
    assert.equal(christmasDefault('nuit'), false);
});

test('snowIntensity : seulement quand il neige', () => {
    assert.equal(snowIntensity(0), 0);
    assert.equal(snowIntensity(61), 0, 'pluie');
    assert.equal(snowIntensity(71), 0.4);
    assert.equal(snowIntensity(73), 0.7);
    assert.equal(snowIntensity(86), 1);
    assert.equal(snowIntensity(null), 0);
});
