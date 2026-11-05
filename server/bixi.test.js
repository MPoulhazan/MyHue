// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distM, classicBikes, freeDocks, trend, assignStarts, pickDest, bikeVerdict, bixiSpeech, isBixiQuestion, rideMinutes } from './bixiLogic.js';

const st = (bikes, ebikes = 0, docks = 10, extra = {}) => ({ num_bikes_available: bikes, num_ebikes_available: ebikes, num_docks_available: docks, is_installed: 1, is_renting: 1, is_returning: 1, ...extra });

test('classicBikes / freeDocks : les électriques ne comptent pas, station rangée = null', () => {
    assert.equal(classicBikes(st(8, 5)), 3);
    assert.equal(classicBikes(st(0, 0)), 0);
    assert.equal(classicBikes(st(4, 0, 10, { is_installed: 0 })), null);
    assert.equal(classicBikes(st(4, 0, 10, { is_renting: 0 })), null);
    assert.equal(freeDocks(st(1, 0, 14)), 14);
    assert.equal(freeDocks(st(1, 0, 14, { is_returning: 0 })), null);
});

test('distM et rideMinutes : ordre de grandeur montréalais', () => {
    const a = { lat: 45.52, lon: -73.57 };
    const b = { lat: 45.53, lon: -73.57 };
    assert.ok(Math.abs(distM(a, b) - 1112) < 5);
    assert.equal(rideMinutes(a, b), 6);
});

test('trend : variation sur 10 min, null sans recul', () => {
    const now = 1_000_000_000;
    const s = [{ at: now - 10 * 60_000, bikes: 5 }, { at: now - 5 * 60_000, bikes: 4 }, { at: now, bikes: 2 }];
    assert.equal(trend(s, now), -3);
    assert.equal(trend([{ at: now - 60_000, bikes: 5 }, { at: now, bikes: 2 }], now), null);
    assert.equal(trend([], now), null);
});

test('assignStarts : chacun son vélo, pas le même dernier', () => {
    const home = [
        { id: 'roy', name: 'Roy', dist: 180, bikes: 1 },
        { id: 'andre', name: 'André', dist: 225, bikes: 3 },
        { id: 'rachel', name: 'Rachel', dist: 325, bikes: 1 },
    ];
    const [a, b] = assignStarts(home, [], 2);
    assert.equal(a.id, 'andre', 'un dernier vélo à 180 m vaut moins que 3 vélos à 225 m');
    assert.equal(b.id, 'andre', 'il en reste 2 à André');
    const [c, d] = assignStarts([{ id: 'x', name: 'X', dist: 100, bikes: 1 }], [{ id: 'far', name: 'Far', dist: 430, bikes: 17 }], 2);
    assert.equal(c.id, 'x');
    assert.equal(c.scarce, true);
    assert.equal(d.id, 'far');
    assert.equal(d.fallback, true);
    assert.deepEqual(assignStarts([{ id: 'x', name: 'X', dist: 100, bikes: 0 }], [], 1), [null]);
});

test('pickDest : la préférée si assez de places, sinon la secours', () => {
    assert.equal(pickDest([{ id: 'a', docks: 14 }, { id: 'b', docks: 22 }]).id, 'a');
    const p = pickDest([{ id: 'a', docks: 1 }, { id: 'b', docks: 9 }]);
    assert.equal(p.id, 'b');
    assert.equal(p.alt, true);
    assert.equal(pickDest([{ id: 'a', docks: 1 }, { id: 'b', docks: 2 }]).low, true);
    assert.equal(pickDest([{ id: 'a', docks: null }]), null);
});

test('bikeVerdict : verglas, neige, pluie, froid, parfait', () => {
    const now = Date.parse('2026-11-05T13:00:00Z');
    const h = (o) => [{ ts: now - 10 * 60_000, temp: 4, feels: 1, precip: 0, rainProb: 0, snow: 0, code: 1, gust: 20, ...o }];
    assert.equal(bikeVerdict(h({}), now).text, '4 °C, sec · prends des gants');
    assert.equal(bikeVerdict(h({ temp: 18, feels: 18 }), now).text, '18 °C, parfait pour le vélo');
    assert.equal(bikeVerdict(h({ code: 66 }), now).level, 'no');
    assert.equal(bikeVerdict(h({ temp: 0, precip: 0.5, code: 61 }), now).level, 'no', 'pluie sur sol gelé');
    assert.equal(bikeVerdict(h({ temp: -3, code: 73, snow: 1 }), now).text, 'Neige, pas de vélo');
    assert.equal(bikeVerdict(h({ precip: 1, code: 61 }), now).level, 'low');
    assert.equal(bikeVerdict(h({ temp: -12, feels: -20 }), now).level, 'low');
});

test('bixiSpeech et isBixiQuestion', () => {
    const view = {
        configured: true, season: 'open', updatedAt: 1, verdict: { text: '4 °C, sec · prends des gants' }, home: [],
        trips: [
            { who: 'Toi', from: { name: 'Roy / St-André', bikes: 3 }, to: { name: 'Robert-Bourassa', docks: 14 } },
            { who: 'Lou', from: null, to: null },
        ],
    };
    assert.equal(bixiSpeech(view), 'Toi : 3 vélos à Roy / St-André, 14 places à Robert-Bourassa. Lou : plus aucun vélo classique autour. 4 °C, sec, prends des gants.');
    assert.match(bixiSpeech({ configured: true, season: 'closed' }), /hiver/);
    assert.equal(isBixiQuestion('Il y a des BIXI ?'), true);
    assert.equal(isBixiQuestion('reste-t-il des vélos'), true);
    assert.equal(isBixiQuestion('allume le salon'), false);
});
