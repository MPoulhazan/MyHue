import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBin, nextBin, reminderText } from './collecteLogic.js';

const BINS = [
    { id: 'ordures', label: 'Poubelle', weekday: 1, from: '19:00', color: 'teal' },
    { id: 'compost', label: 'Compost', weekday: 4, from: '19:00', color: 'green' },
];

test('bac du soir : de son heure à l’heure d’arrêt, le bon jour', () => {
    assert.equal(activeBin(BINS, { weekday: 1, minutes: 18 * 60 + 59 }), null);
    assert.equal(activeBin(BINS, { weekday: 1, minutes: 19 * 60 })?.id, 'ordures');
    assert.equal(activeBin(BINS, { weekday: 4, minutes: 22 * 60 })?.id, 'compost');
    assert.equal(activeBin(BINS, { weekday: 4, minutes: 23 * 60 + 30 }), null);
    assert.equal(activeBin(BINS, { weekday: 2, minutes: 20 * 60 }), null);
});

test('prochain bac', () => {
    assert.deepEqual(((n) => [n.bin.id, n.label])(nextBin(BINS, { weekday: 1, minutes: 10 * 60 })), ['ordures', 'ce soir']);
    assert.deepEqual(((n) => [n.bin.id, n.label])(nextBin(BINS, { weekday: 3, minutes: 10 * 60 })), ['compost', 'demain soir']);
    assert.deepEqual(((n) => [n.bin.id, n.label])(nextBin(BINS, { weekday: 4, minutes: 23 * 60 + 45 })), ['ordures', 'lundi soir']);
    assert.equal(nextBin([], { weekday: 1, minutes: 0 }), null);
    assert.match(reminderText(BINS[0]), /^🗑️ Poubelle : sors le bac ce soir/);
});
