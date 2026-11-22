import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdea, youtubeId, tripTo, distLabel, weatherCheck, matchesFilter, validIdeas, freeLine } from './outingLogic.js';

const TZ = 'America/Toronto';
// Samedi 28 novembre 2026, 10 h à Montréal
const SAT = Date.parse('2026-11-28T15:00:00Z');
const home = { lat: 45.52, lon: -73.58 };

test('youtube : id nu, adresses longues et courtes, rien sinon', () => {
    assert.equal(youtubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
    assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeId('https://vimeo.com/123'), null);
    assert.equal(youtubeId(undefined), null);
});

test('idée nettoyée : champs nouveaux, coordonnées hors de l’île refusées, http refusé pour l’image', () => {
    const o = normalizeIdea({
        kind: 'cinema', title: ' Film ', price: 'Gratuit le mercredi', duration: '1 h 52', lat: 45.51, lon: -73.57,
        image: 'http://x.test/a.jpg', bookingUrl: 'https://billets.test/1', indoor: true, trailer: 'https://youtu.be/dQw4w9WgXcQ',
    }, 0, [], 1);
    assert.equal(o.title, 'Film');
    assert.equal(o.kind, 'cinema');
    assert.equal(o.free, true);
    assert.equal(o.image, null);
    assert.equal(o.bookingUrl, 'https://billets.test/1');
    assert.equal(o.trailer, 'dQw4w9WgXcQ');
    assert.deepEqual([o.lat, o.lon], [45.51, -73.57]);
    const laval = normalizeIdea({ title: 'Laval', lat: 45.6, lon: -73.75, kind: 'zoo' }, 1, []);
    assert.equal(laval.kind, 'activity');
    assert.equal(normalizeIdea({ title: 'Longueuil', lat: 45.53, lon: -73.45 }, 2, []).lat, null);
});

test('trajet : marche toujours, BIXI seulement avec vélo au départ et place à l’arrivée', () => {
    const place = { lat: 45.5, lon: -73.57 };
    const start = { lat: 45.5205, lon: -73.5805, dist: 60, bikes: 6, name: 'Coin' };
    const end = { lat: 45.5003, lon: -73.5703, docks: 4 };
    const t = tripTo(home, place, start, end);
    assert.ok(t.distM > 2000 && t.distM < 2600);
    assert.ok(t.walk > t.bike);
    assert.ok(t.transit && t.transit < t.walk);
    assert.equal(t.bikes, 6);
    assert.equal(tripTo(home, place, { ...start, bikes: 0 }, end).bike, null);
    assert.equal(tripTo(home, place, start, { ...end, docks: 0 }).bike, null);
    assert.equal(tripTo(home, { lat: null, lon: null }), null);
    // Tout près : ni bus ni métro
    assert.equal(tripTo(home, { lat: 45.523, lon: -73.58 }).transit, null);
});

test('distance lisible', () => {
    assert.equal(distLabel(830), '850 m');
    assert.equal(distLabel(2400), '2,4 km');
});

test('météo : seules les sorties en plein air se cachent, et seulement le soir prévu', () => {
    const at = (h, rainProb, feels = -2) => ({ ts: Date.parse(`2026-11-28T${String(h + 5).padStart(2, '0')}:00:00Z`), rainProb, feels });
    const wet = [at(18, 80), at(19, 70)];
    assert.equal(weatherCheck({ indoor: true }, wet, SAT, TZ), null);
    assert.deepEqual(weatherCheck({ indoor: false }, wet, SAT, TZ), { hide: true, reason: 'pluie probable (80 %)' });
    assert.equal(weatherCheck({ indoor: false }, [at(18, 10, -24)], SAT, TZ).hide, true);
    assert.equal(weatherCheck({ indoor: false }, [at(18, 10)], SAT, TZ).hide, false);
    // Pas de prévision pour ce jour-là
    assert.equal(weatherCheck({ indoor: false, date: '2026-12-06' }, wet, SAT, TZ), null);
});

test('filtres : ce soir, week-end, gratuit, resto, culture', () => {
    const film = { kind: 'cinema', date: '2026-11-28' };
    const resto = { kind: 'resto', date: null };
    const expo = { kind: 'museum', date: '2026-12-02', free: true };
    assert.equal(matchesFilter(film, 'tonight', SAT, TZ), true);
    assert.equal(matchesFilter(expo, 'tonight', SAT, TZ), false);
    assert.equal(matchesFilter(resto, 'tonight', SAT, TZ), true);
    assert.equal(matchesFilter(film, 'weekend', SAT, TZ), true);
    assert.equal(matchesFilter(expo, 'weekend', SAT, TZ), false);
    assert.equal(matchesFilter(expo, 'free', SAT, TZ), true);
    assert.equal(matchesFilter(film, 'free', SAT, TZ), false);
    assert.equal(matchesFilter(resto, 'resto', SAT, TZ), true);
    assert.equal(matchesFilter(resto, 'culture', SAT, TZ), false);
    assert.equal(matchesFilter(film, 'culture', SAT, TZ), true);
    // Un lundi, une idée sans date n'est pas « ce soir »
    assert.equal(matchesFilter(resto, 'tonight', Date.parse('2026-11-30T15:00:00Z'), TZ), false);
});

test('idées valables : sans les solos, les écartées, les faites, les passées', () => {
    const store = {
        outings: { ideas: [
            { id: 'a', title: 'A', date: '2026-11-27' },
            { id: 'b', title: 'B', date: null },
            { id: 'c', title: 'C', date: null },
            { id: 'd', title: 'D', date: null, person: 'p1' },
            { id: 'e', title: 'E', date: '2026-11-28' },
        ] },
        skipped: ['b'],
        done: ['C'],
    };
    assert.deepEqual(validIdeas(store, SAT, TZ).map((o) => o.id), ['e']);
});

test('agendas libres ou pris le soir de la sortie', () => {
    const evenings = [{ date: '2026-11-28', free: true, busy: [] }, { date: '2026-12-02', free: false, busy: ['A'] }];
    assert.equal(freeLine({ date: '2026-11-28' }, evenings, 2), 'Vous êtes libres tous les deux samedi soir.');
    assert.equal(freeLine({ date: '2026-11-28' }, evenings, 1), 'Rien à l’agenda samedi soir.');
    assert.equal(freeLine({ date: '2026-12-02' }, evenings, 2), 'A : déjà pris mercredi soir.');
    assert.equal(freeLine({ date: null }, evenings, 2), null);
    assert.equal(freeLine({ date: '2026-11-28' }, evenings, 0), null);
});
