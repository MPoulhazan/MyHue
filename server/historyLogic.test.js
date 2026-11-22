import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spentOf, archiveEntry, pendingReview, monthSummary, ratingsForClaude, appendIdeas, parseIdeasJson } from './historyLogic.js';

const TZ = 'America/Toronto';
// Samedi 28 novembre 2026, 19 h à Montréal
const START = Date.parse('2026-11-29T00:00:00Z');
const END = START + 2 * 3600_000;
const at = (iso) => Date.parse(iso);

test('dépense à deux d’après le prix annoncé', () => {
    assert.equal(spentOf('13,50 $/pers.'), 27);
    assert.equal(spentOf('25 $ par personne'), 50);
    assert.equal(spentOf('40 $'), 40);
    assert.equal(spentOf('Gratuit le mercredi'), 0);
    assert.equal(spentOf('$$'), null);
    assert.equal(spentOf(null, true), 0);
    assert.equal(spentOf(null), null);
});

test('entrée d’historique', () => {
    const h = archiveEntry({ ideaId: 'o1', title: 'Film', kind: 'cinema', where: 'Parc', start: START, end: END }, { price: '13,50 $/pers.' });
    assert.equal(h.id, `h${START}`);
    assert.equal(h.spent, 27);
    assert.equal(h.rating, null);
});

test('« C’était bien ? » : le soir même après la fin, puis le lendemain jusqu’à midi', () => {
    const h = [{ id: 'a', title: 'Film', start: START, end: END, rating: null }];
    assert.equal(pendingReview(h, END - 60_000, TZ), null);
    assert.equal(pendingReview(h, END + 60_000, TZ)?.id, 'a');
    assert.equal(pendingReview(h, at('2026-11-29T14:00:00Z'), TZ)?.id, 'a'); // dimanche 9 h
    assert.equal(pendingReview(h, at('2026-11-29T18:00:00Z'), TZ), null); // dimanche 13 h
    assert.equal(pendingReview(h, at('2026-11-30T14:00:00Z'), TZ), null); // lundi
    assert.equal(pendingReview([{ ...h[0], rating: 'super' }], END + 60_000, TZ), null);
    assert.equal(pendingReview([], END, TZ), null);
});

test('le mois en cours : sorties, total, montants inconnus', () => {
    const h = [
        { start: START, spent: 27 },
        { start: at('2026-11-12T23:00:00Z'), spent: null },
        { start: at('2026-11-05T23:00:00Z'), spent: 40.5 },
        { start: at('2026-10-20T23:00:00Z'), spent: 100 },
    ];
    assert.deepEqual(monthSummary(h, at('2026-11-30T15:00:00Z'), TZ), { count: 3, total: 67.5, unknown: 1 });
});

test('les avis pour la tâche Claude : seulement les sorties notées, les plus récentes d’abord', () => {
    const r = ratingsForClaude([{ title: 'A', kind: 'resto', start: 1, rating: 'bof' }, { title: 'B', kind: 'cinema', start: 2, rating: null }, { title: 'C', kind: 'concert', start: 3, rating: 'super' }]);
    assert.deepEqual(r.map((x) => x.title), ['C', 'A']);
});

test('idées ajoutées sans doublon', () => {
    const out = appendIdeas([{ title: 'Ramen Plateau' }], [{ title: 'ramen plateau' }, { title: 'Expo photo' }, { title: '' }]);
    assert.deepEqual(out.map((o) => o.title), ['Ramen Plateau', 'Expo photo']);
});

test('tableau JSON lu dans la réponse du modèle de secours', () => {
    assert.deepEqual(parseIdeasJson('Voici :\n[{"title":"A","kind":"resto"},{"x":1}]\nBonne soirée').map((o) => o.title), ['A']);
    assert.deepEqual(parseIdeasJson('pas de json'), []);
    assert.deepEqual(parseIdeasJson('[oops'), []);
});
