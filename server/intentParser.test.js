// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from './intentParser.js';

const lights = [
    { id: '1', name: 'Bibliothèque' },
    { id: '15', name: 'Cuisine' },
];
const groups = [
    { id: '1', name: 'Salon', type: 'Room', lights: ['1'] },
    { id: '82', name: 'Cuisine', type: 'Room', lights: ['15'] },
];
const devices = [
    { id: '192.168.0.117', name: 'Salon' },
    { id: '192.168.0.97', name: 'Cuisine' },
];
const ctx = { lights, groups, cast: { devices, nowPlaying: { deviceId: '192.168.0.117', volume: 40 } } };

test('Québec : ouvre / ferme la lumière', () => {
    const on = parseIntent('Ouvre la lumière du salon', ctx);
    assert.deepEqual(on.actions, [{ type: 'set_group_state', id: '1', state: { on: true } }]);
    const off = parseIntent('ferme les lumières', ctx);
    assert.deepEqual(off.actions, [{ type: 'toggle_all', on: false }]);
    // Sans pièce ni pluriel : on ne devine pas
    assert.equal(parseIntent('ouvre la lumière', ctx), null);
    // « ferme » sans le mot lumière ne touche pas aux lampes
    assert.equal(parseIntent('ferme le salon', ctx), null);
});

test('baisser / monter la lumière : pas relatif Hue', () => {
    const down = parseIntent('baisse la lumière de la cuisine', ctx);
    assert.deepEqual(down.actions, [{ type: 'set_group_state', id: '82', state: { bri_inc: -64 } }]);
    const up = parseIntent('monte les lumières', ctx);
    assert.deepEqual(up.actions, [{ type: 'set_group_state', id: '0', state: { bri_inc: 64 } }]);
});

test('musique : pause, reprise, volume sur l’enceinte qui joue', () => {
    assert.deepEqual(parseIntent('mets en pause', ctx).actions, [
        { type: 'cast_control', deviceName: 'Salon', command: 'pause' },
    ]);
    assert.deepEqual(parseIntent('reprends la musique', ctx).actions, [
        { type: 'cast_control', deviceName: 'Salon', command: 'play' },
    ]);
    assert.equal(parseIntent('monte le son', ctx).actions[0].level, 0.5);
    assert.equal(parseIntent('baisse le volume', ctx).actions[0].level, 0.3);
    assert.deepEqual(parseIntent('volume de la cuisine à 25 %', ctx).actions, [
        { type: 'cast_volume', deviceName: 'Cuisine', level: 0.25 },
    ]);
    assert.equal(parseIntent('coupe la musique', ctx).actions[0].command, 'stop');
});

test('musique sans enceinte connue ni lecture en cours : Groq décide', () => {
    const idle = { ...ctx, cast: { devices, nowPlaying: null } };
    assert.equal(parseIntent('mets en pause', idle), null);
    // Volume relatif d'une enceinte qui ne joue pas : volume actuel inconnu
    assert.equal(parseIntent('monte le son de la cuisine', ctx), null);
});

test('les commandes existantes ne changent pas', () => {
    assert.deepEqual(parseIntent('allume le salon', ctx).actions, [
        { type: 'set_group_state', id: '1', state: { on: true } },
    ]);
    assert.deepEqual(parseIntent('éteins tout', ctx).actions, [{ type: 'toggle_all', on: false }]);
    assert.equal(parseIntent('allume le salon dans 10 minutes', ctx), null);
});

test('musique : lancer la suggestion, une ambiance ou une radio', () => {
    const play = (t) => parseIntent(t, ctx)?.actions;
    assert.deepEqual(play('Jean-Claude mets de la musique'), [{ type: 'music_play', what: 'suggestion' }]);
    assert.deepEqual(play('mets de la musique zen dans la cuisine'), [{ type: 'music_play', what: 'mood', id: 'zen', deviceName: 'Cuisine' }]);
    assert.deepEqual(play('lance de la musique pour dormir'), [{ type: 'music_play', what: 'mood', id: 'dodo' }]);
    assert.deepEqual(play('mets de la musique de Noël'), [{ type: 'music_play', what: 'mood', id: 'noel' }]);
    assert.deepEqual(play('mets la radio jazz'), [{ type: 'music_play', what: 'radio', id: 'jazz' }]);
    assert.deepEqual(play('musique pour travailler'), [{ type: 'music_play', what: 'mood', id: 'focus' }]);
});

test('musique : suivant / précédent, et les commandes ne relancent pas', () => {
    assert.deepEqual(parseIntent('chanson suivante', ctx).actions, [{ type: 'music_skip', delta: 1 }]);
    assert.deepEqual(parseIntent('remets le morceau précédent', ctx).actions, [{ type: 'music_skip', delta: -1 }]);
    assert.deepEqual(parseIntent('mets la musique en pause', ctx).actions, [{ type: 'cast_control', deviceName: 'Salon', command: 'pause' }]);
    assert.equal(parseIntent('mets le son à 30', ctx).actions[0].type, 'cast_volume');
});
