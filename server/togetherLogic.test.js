import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTogether, splitItems, noteToAnnounce } from './togetherLogic.js';

const people = [{ id: 'mike', name: 'Mike' }, { id: 'camille', name: 'Camille' }];

test('ajouter à la liste, avec ou sans le mot d’activation', () => {
    assert.deepEqual(parseTogether('Jean-Claude, ajoute du lait et des œufs à la liste', people), { action: 'add', items: ['lait', 'œufs'] });
    assert.deepEqual(parseTogether('rajoute du café, des citrons et de la farine à l’épicerie', people), { action: 'add', items: ['café', 'citrons', 'farine'] });
    assert.deepEqual(parseTogether('mets des croquettes pour Cooper sur la liste de courses', people), { action: 'add', items: ['croquettes pour Cooper'] });
});

test('lire, retirer, vider la liste', () => {
    assert.deepEqual(parseTogether('qu’est-ce qu’il y a sur la liste ?', people), { action: 'list' });
    assert.deepEqual(parseTogether('enlève le lait de la liste', people), { action: 'remove', item: 'lait' });
    assert.deepEqual(parseTogether('vide la liste', people), { action: 'clear' });
});

test('petits mots', () => {
    assert.deepEqual(parseTogether('dis à Camille que je rentre tard ce soir', people), { action: 'note', to: 'camille', text: 'je rentre tard ce soir' });
    assert.deepEqual(parseTogether('laisse un mot à mike : pense au café.', people), { action: 'note', to: 'mike', text: 'pense au café' });
    assert.equal(parseTogether('dis à Paul que salut', people), null);
    assert.deepEqual(parseTogether('j’ai un mot ?', people), { action: 'read' });
});

test('le reste ne concerne pas « À deux »', () => {
    for (const q of ['allume le salon', 'ajoute une alarme à 7 h', 'c’est quoi ma journée']) assert.equal(parseTogether(q, people), null, q);
    assert.deepEqual(splitItems('du pain'), ['pain']);
});

test('mot à lire au retour : vieux d’au moins 10 min, de jour, une seule fois', () => {
    const now = 1_000_000_000;
    const notes = [
        { id: 'a', at: now - 5 * 60_000 },
        { id: 'b', at: now - 60 * 60_000, announcedAt: now - 1000 },
        { id: 'c', at: now - 30 * 60_000 },
    ];
    assert.equal(noteToAnnounce(notes, now, 18).id, 'c');
    assert.equal(noteToAnnounce(notes, now, 23), null);
});
