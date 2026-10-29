// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseAt, deltaFor, parseRecords, decide } from './flexd.js';

const H = 3600_000;
const ev = { id: 'TPC-DPC:a', start: 10 * H, end: 14 * H };

test('phaseAt: préchauffage, pointe, puis rien', () => {
    assert.equal(phaseAt([ev], 8.9 * H, 60), null);
    assert.equal(phaseAt([ev], 9 * H, 60).phase, 'preheat');
    assert.equal(phaseAt([ev], 10 * H, 60).phase, 'peak');
    assert.equal(phaseAt([ev], 13.99 * H, 60).phase, 'peak');
    assert.equal(phaseAt([ev], 14 * H, 60), null);
});

test('phaseAt: une pointe ignorée ne compte pas', () => {
    assert.equal(phaseAt([ev], 11 * H, 60, ['TPC-DPC:a']), null);
});

test('phaseAt: matin et soir le même jour', () => {
    const pm = { id: 'TPC-DPC:b', start: 20 * H, end: 24 * H };
    assert.equal(phaseAt([pm, ev], 11 * H, 60).event.id, 'TPC-DPC:a');
    assert.equal(phaseAt([pm, ev], 16 * H, 60), null);
    assert.equal(phaseAt([pm, ev], 19.5 * H, 60).event.id, 'TPC-DPC:b');
});

test('deltaFor: +boost avant, −réduction pendant', () => {
    const cfg = { boost: 1, reduction: 2 };
    assert.equal(deltaFor('preheat', cfg), 1);
    assert.equal(deltaFor('peak', cfg), -2);
    assert.equal(deltaFor(null, cfg), 0);
});

test('parseRecords: garde Flex D (TPC-DPC) en heure UTC', () => {
    const out = parseRecords([
        { offre: 'TPC-DPC', datedebut: '2026-02-10T11:00:00+00:00', datefin: '2026-02-10T15:00:00+00:00' },
        { offre: 'CPC-D', datedebut: '2026-02-10T11:00:00+00:00', datefin: '2026-02-10T15:00:00+00:00' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].start, Date.parse('2026-02-10T11:00:00Z'));
    assert.equal(out[0].end - out[0].start, 4 * H);
});

// Déroule une pointe minute par minute comme le fait tick(), sans appareil
const cfg = { boost: 1, reduction: 2, preheatMinutes: 60 };
const run = (steps) => {
    let applied = null;
    let heat = { power: true, mode: 'heat', temperature: 21 };
    const sent = [];
    for (const { at, user } of steps) {
        if (user) heat = { ...heat, ...user };
        const d = decide(applied, phaseAt([ev], at, cfg.preheatMinutes), heat, cfg);
        if (!d) continue;
        if (d.patch) {
            assert.deepEqual(Object.keys(d.patch), ['temperature'], 'seule la consigne change');
            heat = { ...heat, ...d.patch };
            sent.push(d.patch.temperature);
        }
        applied = d.applied;
    }
    return { sent, heat };
};

test('decide: +1 avant, −2 pendant, retour après', () => {
    const { sent, heat } = run([{ at: 9.5 * H }, { at: 9.6 * H }, { at: 10 * H }, { at: 12 * H }, { at: 14 * H }]);
    assert.deepEqual(sent, [22, 19, 21]);
    assert.equal(heat.temperature, 21);
    assert.equal(heat.power, true);
});

test('decide: thermopompe éteinte, jamais relancée ni touchée', () => {
    const { sent, heat } = run([{ at: 9.5 * H, user: { power: false } }, { at: 10 * H }, { at: 14 * H }]);
    assert.deepEqual(sent, []);
    assert.equal(heat.power, false);
});

test('decide: la personne change la consigne pendant la pointe, on la laisse', () => {
    const { sent, heat } = run([{ at: 9.5 * H }, { at: 10 * H }, { at: 11 * H, user: { temperature: 23 } }, { at: 14 * H }]);
    assert.deepEqual(sent, [22, 19]);
    assert.equal(heat.temperature, 23);
});

test('decide: thermostat intelligent actif, aucun envoi direct', () => {
    const d = decide(null, phaseAt([ev], 10 * H, 60), { power: true, mode: 'heat', temperature: 21 }, cfg, true);
    assert.equal(d.patch, undefined);
    assert.equal(d.applied.phase, 'peak');
});
