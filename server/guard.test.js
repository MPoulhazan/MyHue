// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGuardCommand, pickMinute, guardSpeech } from './guard.js';
import { flowFor } from './entranceLight.js';

test('parseGuardCommand : activer, couper, demander', () => {
    assert.deepEqual(parseGuardCommand('Active le mode vacances'), { action: 'on', mode: 'vacation' });
    assert.deepEqual(parseGuardCommand('mets l’alarme'), { action: 'on', mode: 'alarm' });
    assert.deepEqual(parseGuardCommand('mode alarme'), { action: 'on', mode: 'alarm' });
    assert.deepEqual(parseGuardCommand('on part en vacances'), { action: 'on', mode: 'vacation' });
    assert.deepEqual(parseGuardCommand('Désactive le mode alarme'), { action: 'off' });
    assert.deepEqual(parseGuardCommand('coupe le mode vacances'), { action: 'off' });
    assert.deepEqual(parseGuardCommand('On est rentrés'), { action: 'off' });
    assert.deepEqual(parseGuardCommand('Le mode alarme est activé ?'), { action: 'status' });
});

test('parseGuardCommand : ne vole pas les autres phrases', () => {
    assert.equal(parseGuardCommand('mets de la musique pour les vacances'), null);
    assert.equal(parseGuardCommand('allume le salon'), null);
    assert.equal(parseGuardCommand('coupe l’alarme fuite d’eau'), null);
});

test('pickMinute : reste dans la plage', () => {
    assert.equal(pickMinute('18:30', '19:30', 0), 18 * 60 + 30);
    assert.equal(pickMinute('18:30', '19:30', 0.999), 19 * 60 + 29);
});

test('guardSpeech', () => {
    assert.match(guardSpeech({ mode: null, events: [] }), /désactivés/);
    assert.equal(guardSpeech({ mode: 'vacation', events: [{}, {}] }), 'Mode vacances activé. 2 alertes depuis.');
});

test('flowFor : couleurs du matin et rouge de l’alarme', () => {
    const rain = flowFor(['rain']);
    assert.equal(rain.count, 2);
    assert.equal(rain.ms, 3000);
    assert.equal(rain.expr, `300,1,${0x1e5cff},100,2700,7,0,0`);
    assert.equal(flowFor(['rain', 'mail']).count, 4);
    assert.equal(flowFor(['inconnu']).count, 0);
    const alarm = flowFor(['alarm']);
    assert.equal(alarm.count, 16);
    assert.equal(alarm.ms, 4800);
});
