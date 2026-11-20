// Pertinence et mise en page des widgets de l'accueil (src/components/home/widgets/relevance.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    arrange, cityRelevance, cooperRelevance, houseRelevance,
    journalRelevance, mailRelevance, movesForm, movesRelevance, musicRelevance, skyRelevance,
} from '../src/components/home/widgets/relevance.ts';

const s = (id, relevance) => ({ id, relevance, summary: '' });
// Jeudi 5 novembre 2026 à différentes heures (heure locale)
const at = (h, day = 5) => new Date(2026, 10, day, h, 15);
const NOON = at(12);

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
    assert.equal(houseRelevance([{ type: 'water_leak', isOnline: true, props: { battery: 90, isOpen: null, leak: true } }, { type: 'smoke', isOnline: true, props: { battery: 90, isOpen: null, smoke: true } }]).summary, 'fumée');

    assert.equal(skyRelevance({ aurora: { level: 'alert' }, highlight: { kind: 'aurora' } }).relevance, 'alert');
    assert.equal(skyRelevance({ aurora: null, highlight: { kind: 'moon' } }, NOON).relevance, 'calm');
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
        s('moves', 'now'), s('guard', 'now'), s('sky', 'alert'), s('journal', 'calm'),
    ]);
    assert.equal(r.cards.length, 5);
    assert.ok(r.cards.includes('cooper'));
    assert.deepEqual(r.cards, ['sky', 'guard', 'city', 'mail', 'cooper']);
    assert.deepEqual(r.chips, ['house', 'moves', 'journal']);
});

test('arrange : caché ou masqué n’apparaît nulle part, Toujours force la carte', () => {
    const r = arrange([s('city', 'hidden'), s('cooper', 'calm'), s('mail', 'alert'), s('sky', 'calm')],
        { mail: 'hidden', sky: 'always', cooper: 'auto' });
    assert.deepEqual(r.cards, ['sky']);
    assert.deepEqual(r.chips, ['cooper']);
});

test('pastilles : un texte court pour chaque widget calme', () => {
    assert.equal(mailRelevance({ enabled: true, sensor: {}, waiting: null, pending: false, night: null, today: { delivery: null } }).summary, 'pas encore passé');
    assert.equal(skyRelevance({ aurora: null, highlight: { kind: 'moon' }, moon: { fraction: 0.62 } }).summary, 'lune 62 %');
    assert.equal(journalRelevance(12).summary, '12 évènements');
    assert.equal(journalRelevance(0).summary, 'rien pour l’instant');
    assert.equal(houseRelevance([]).summary, 'tout est fermé');
});

test('heures : Ciel le soir, musique le matin', () => {
    const sky = { aurora: null, highlight: { kind: 'planet' }, night: { quality: { level: 'good' } } };
    assert.equal(skyRelevance(sky, at(19)).relevance, 'now');
    assert.equal(skyRelevance(sky, at(0)).relevance, 'now');
    assert.equal(skyRelevance(sky, at(14)).relevance, 'calm');
    // Ciel bouché et rien que la lune : il reste en pastille même le soir
    assert.equal(skyRelevance({ ...sky, highlight: { kind: 'moon' }, night: { quality: { level: 'bad' } } }, at(20)).relevance, 'calm');
});

test('Cooper reste une carte à toute heure, même quand tout est calme', () => {
    const calm = { enabled: true, sensor: {}, mood: 'fed', meals: [{ status: 'done' }, { status: 'done' }] };
    const r = arrange([
        cityRelevance({ enabled: true, events: [{ level: 'info', bucket: 'later', title: 'x' }], takeover: null }),
        cooperRelevance(calm),
        skyRelevance({ aurora: null, highlight: { kind: 'planet' }, night: { quality: { level: 'good' } } }, at(14)),
    ]);
    assert.deepEqual(r.cards, ['cooper']);
});

test('musicRelevance : habitude du créneau ou matin en carte, rien pendant la lecture', () => {
    const habit = { suggestion: { habit: true, name: 'Zen' } };
    const plain = { suggestion: { habit: false, name: 'Dîner' } };
    assert.equal(musicRelevance(null, false, NOON).relevance, 'hidden');
    assert.deepEqual(musicRelevance(habit, false, NOON), { id: 'music', relevance: 'now', summary: 'Zen' });
    assert.equal(musicRelevance(plain, false, NOON).relevance, 'calm');
    assert.equal(musicRelevance(plain, false, at(7)).relevance, 'now', 'le matin, on propose');
    assert.deepEqual(musicRelevance(habit, true, at(7)), { id: 'music', relevance: 'calm', summary: 'en lecture' });
});

// Déplacements : une carte, quatre formes ; l'heure vient de l'horaire de la personne (phase du Pi)
const bixiOn = { enabled: true, configured: true, season: 'open', window: false, verdict: { text: '12 °C, parfait pour le vélo' } };
const bixiOff = { ...bixiOn, season: 'closed' };
const commute = (phase) => ({ enabled: true, configured: true, phase, best: { title: 'BIXI', minutes: 15 } });
const metroOk = { metro: { show: true, error: null, lines: [{ ok: true }] } };
const idle = { updatedAt: 1, radiusM: 500, nearby: [{ dist: 200 }], search: null };
const moves = (o) => movesRelevance({ commute: null, bixi: null, city: null, communauto: null, ...o });

test('movesForm : Communauto en cours d’abord, puis trajet en saison BIXI, métro hors saison, Communauto au repos', () => {
    const search = { active: true, radiusM: 300, found: [] };
    assert.equal(movesForm({ commute: null, bixi: bixiOn, city: metroOk, communauto: { ...idle, search } }), 'communauto');
    assert.equal(movesForm({ commute: null, bixi: bixiOn, city: metroOk, communauto: idle }), 'trip');
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: metroOk, communauto: idle }), 'metro');
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: null, communauto: idle }), 'communauto-idle');
    assert.equal(movesForm({ commute: null, bixi: null, city: null, communauto: null }), null);
});

test('movesRelevance : carte à l’heure de départ de la personne, pastille après', () => {
    assert.equal(moves({ bixi: bixiOn, commute: commute('before') }).relevance, 'calm');
    assert.deepEqual(moves({ bixi: bixiOn, commute: commute('soon') }), { id: 'moves', relevance: 'now', summary: 'BIXI, 15 min' });
    assert.equal(moves({ bixi: bixiOn, commute: commute('now') }).relevance, 'now');
    assert.deepEqual(moves({ bixi: bixiOn, commute: commute('after') }), { id: 'moves', relevance: 'calm', summary: '12 °C, parfait pour le vélo' });
    // Sans horaire réglé, la fenêtre de départ des trajets BIXI du Pi
    assert.equal(moves({ bixi: { ...bixiOn, window: true } }).relevance, 'now');
    assert.equal(moves({ bixi: bixiOn }).relevance, 'calm');
});

test('movesRelevance : métro hors saison, perturbé ou à l’heure de partir', () => {
    assert.equal(moves({ bixi: bixiOff, city: metroOk }).relevance, 'calm');
    assert.equal(moves({ bixi: bixiOff, city: metroOk, commute: commute('now') }).relevance, 'now');
    assert.deepEqual(moves({ bixi: bixiOff, city: { metro: { show: true, error: null, lines: [{ ok: false }] } } }), { id: 'moves', relevance: 'now', summary: 'métro perturbé' });
});

test('movesRelevance : Communauto au repos en pastille, en tête quand une auto est trouvée ou bloquée', () => {
    assert.deepEqual(moves({ communauto: idle }), { id: 'moves', relevance: 'calm', summary: '1 Communauto à 500 m' });
    assert.equal(moves({ communauto: { ...idle, updatedAt: null } }).summary, 'Communauto ne répond pas');
    const search = { active: true, radiusM: 300, found: [] };
    assert.equal(moves({ bixi: bixiOn, communauto: { ...idle, search } }).relevance, 'now');
    const found = { ...search, found: [{ model: 'Kia Niro EV', dist: 240 }] };
    assert.deepEqual(moves({ communauto: { ...idle, search: found } }), { id: 'moves', relevance: 'alert', summary: 'Kia Niro EV à 240 m' });
    assert.equal(moves({ communauto: { ...idle, search: { ...search, found: [{ model: 'X', dist: 1, gone: true }] } } }).relevance, 'now');
    assert.equal(moves({}).relevance, 'hidden');
    assert.deepEqual(moves({ communauto: { ...idle, booked: { car: { model: 'Toyota Corolla L' } } } }), { id: 'moves', relevance: 'alert', summary: 'Toyota Corolla L bloquée' });
});
