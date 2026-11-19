import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlace, needsRoute, lineLabel, parseRoute } from './departureLogic.js';

test('lieux : une adresse oui, une visio non', () => {
    assert.ok(isPlace('Clinique dentaire, 4500 rue Saint-Denis, Montréal'));
    assert.ok(!isPlace('https://meet.google.com/abc-defg-hij'));
    assert.ok(!isPlace('Zoom'));
    assert.ok(!isPlace(''));
});

test('rendez-vous à calculer : à venir, avec un lieu, pas toute la journée', () => {
    const now = 1_000_000_000_000;
    assert.ok(needsRoute({ start: now + 3600_000, location: '123 rue X', allDay: false }, now));
    assert.ok(!needsRoute({ start: now - 60_000, location: '123 rue X', allDay: false }, now));
    assert.ok(!needsRoute({ start: now + 3600_000, location: '123 rue X', allDay: true }, now));
    assert.ok(!needsRoute({ start: now + 20 * 3600_000, location: '123 rue X', allDay: false }, now));
});

test('noms de lignes STM', () => {
    assert.equal(lineLabel({ nameShort: '24', name: 'Sherbrooke', vehicle: { type: 'BUS' } }), 'bus 24');
    assert.equal(lineLabel({ nameShort: '2', name: 'Ligne 2 - Orange', vehicle: { type: 'SUBWAY' } }), 'métro orange');
    assert.equal(lineLabel({ nameShort: 'A1', name: 'REM', vehicle: { type: 'LIGHT_RAIL' } }), 'REM');
});

test('itinéraire : marche jusqu’à l’arrêt, bus puis métro', () => {
    const data = {
        routes: [{
            duration: '1680s',
            legs: [{
                steps: [
                    { travelMode: 'WALK', staticDuration: '240s' },
                    { travelMode: 'TRANSIT', staticDuration: '600s', transitDetails: { stopDetails: { departureTime: '2026-11-18T18:36:00Z', arrivalTime: '2026-11-18T18:46:00Z' }, transitLine: { nameShort: '24', vehicle: { type: 'BUS' } } } },
                    { travelMode: 'TRANSIT', staticDuration: '480s', transitDetails: { stopDetails: { departureTime: '2026-11-18T18:48:00Z', arrivalTime: '2026-11-18T18:52:00Z' }, transitLine: { name: 'Ligne 2 - Orange', vehicle: { type: 'SUBWAY' } } } },
                    { travelMode: 'WALK', staticDuration: '180s' },
                ],
            }],
        }],
    };
    const r = parseRoute(data, Date.parse('2026-11-18T18:55:00Z'));
    assert.equal(new Date(r.at).toISOString(), '2026-11-18T18:32:00.000Z');
    assert.equal(r.via, 'bus 24 puis métro orange');
    assert.equal(r.minutes, 23);
    assert.equal(r.walk, false);
});

test('itinéraire à pied', () => {
    const r = parseRoute({ routes: [{ duration: '600s', legs: [{ steps: [{ travelMode: 'WALK', staticDuration: '600s' }] }] }] }, 2_000_000_000_000);
    assert.deepEqual(r, { at: 2_000_000_000_000 - 600_000, via: 'à pied', minutes: 10, walk: true });
    assert.equal(parseRoute({ routes: [] }, 0), null);
});
