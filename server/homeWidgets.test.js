// Pertinence et mise en page des widgets de l'accueil (src/components/home/widgets/relevance.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    arrange, bixiRelevance, cityRelevance, cooperRelevance, houseRelevance,
    journalRelevance, mailRelevance, metroRelevance, skyRelevance,
} from '../src/components/home/widgets/relevance.ts';

const s = (id, relevance) => ({ id, relevance, reason: '' });

test('Cooper : oublié en alerte, repas bientôt maintenant, sinon calme', () => {
    const base = { enabled: true, sensor: {}, mood: 'waiting', meals: [{ status: 'done' }, { status: 'upcoming' }] };
    assert.equal(cooperRelevance(base).relevance, 'calm');
    assert.equal(cooperRelevance({ ...base, meals: [{ status: 'soon' }] }).relevance, 'now');
    assert.equal(cooperRelevance({ ...base, mood: 'late', meals: [{ status: 'late' }] }).relevance, 'alert');
    assert.equal(cooperRelevance({ ...base, sensor: null }).relevance, 'hidden');
    assert.equal(cooperRelevance(null).relevance, 'hidden');
});

test('En ville : danger en alerte, collecte maintenant, rien caché', () => {
    const ev = (o) => ({ level: 'info', bucket: 'later', ...o });
    assert.equal(cityRelevance({ enabled: true, events: [], takeover: null }).relevance, 'hidden');
    assert.equal(cityRelevance({ enabled: true, events: [ev({})], takeover: null }).relevance, 'calm');
    assert.equal(cityRelevance({ enabled: true, events: [ev({ action: 'collecte', bucket: 'today' })], takeover: null }).relevance, 'now');
    assert.equal(cityRelevance({ enabled: true, events: [ev({ level: 'danger' })], takeover: null }).relevance, 'alert');
});

test('Courrier, Maison, BIXI, Métro, Ciel, Journal', () => {
    const mail = { enabled: true, sensor: {}, waiting: null, pending: false, night: null };
    assert.equal(mailRelevance(mail).relevance, 'calm');
    assert.equal(mailRelevance({ ...mail, waiting: { since: 1, count: 1 } }).relevance, 'now');
    assert.equal(mailRelevance({ ...mail, night: { at: 1 } }).relevance, 'alert');

    const door = (isOpen) => ({ type: 'door', isOnline: true, props: { battery: 90, isOpen } });
    assert.equal(houseRelevance([door(false)]).relevance, 'calm');
    assert.equal(houseRelevance([door(true)]).relevance, 'now');
    assert.equal(houseRelevance([door(true), { type: 'water_leak', isOnline: true, props: { battery: 90, isOpen: null, leak: true } }]).relevance, 'alert');

    const bixi = { enabled: true, configured: true, season: 'open', window: false };
    assert.equal(bixiRelevance(bixi).relevance, 'calm');
    assert.equal(bixiRelevance({ ...bixi, window: true }).relevance, 'now');
    assert.equal(bixiRelevance({ ...bixi, season: 'closed' }).relevance, 'hidden');

    assert.equal(metroRelevance({ metro: { show: false, error: null, lines: [] } }).relevance, 'hidden');
    assert.equal(metroRelevance({ metro: { show: true, error: null, lines: [{ ok: false }] } }).relevance, 'now');

    assert.equal(skyRelevance({ aurora: { level: 'alert' }, highlight: { kind: 'aurora' } }).relevance, 'alert');
    assert.equal(skyRelevance({ aurora: null, highlight: { kind: 'moon' } }).relevance, 'calm');
    assert.equal(journalRelevance().relevance, 'calm');
});

test('arrange : Cooper reste une carte même calme, les autres calmes deviennent des pastilles', () => {
    const r = arrange([s('city', 'calm'), s('cooper', 'calm'), s('mail', 'calm'), s('journal', 'calm')]);
    assert.deepEqual(r.cards, ['cooper']);
    assert.deepEqual(r.chips, ['city', 'mail', 'journal']);
});

test('arrange : les alertes passent devant, puis l’ordre du registre', () => {
    const r = arrange([s('city', 'now'), s('cooper', 'alert'), s('mail', 'now'), s('sky', 'alert')]);
    assert.deepEqual(r.cards, ['cooper', 'sky', 'city', 'mail']);
});

test('arrange : 5 cartes au plus, Cooper compris, les moins pressées retombent en pastilles', () => {
    const r = arrange([
        s('city', 'now'), s('cooper', 'calm'), s('mail', 'now'), s('house', 'now'),
        s('bixi', 'now'), s('metro', 'now'), s('sky', 'alert'), s('journal', 'calm'),
    ]);
    assert.equal(r.cards.length, 5);
    assert.ok(r.cards.includes('cooper'));
    assert.deepEqual(r.cards, ['sky', 'city', 'mail', 'house', 'cooper']);
    assert.deepEqual(r.chips, ['bixi', 'metro', 'journal']);
});

test('arrange : caché ou masqué n’apparaît nulle part, Toujours force la carte', () => {
    const r = arrange([s('city', 'hidden'), s('cooper', 'calm'), s('mail', 'alert'), s('sky', 'calm')],
        { mail: 'hidden', sky: 'always', cooper: 'auto' });
    assert.deepEqual(r.cards, ['sky']);
    assert.deepEqual(r.chips, ['cooper']);
});
