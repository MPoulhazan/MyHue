// Pertinence et mise en page des widgets de l'accueil (server/homeFeedLogic.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    arrange, cityRelevance, cooperRelevance, houseRelevance,
    journalRelevance, mailRelevance, movesForm, movesRelevance, musicRelevance, skyRelevance,
    buildFeed, feedBriefingLine, guardRelevance, nextAt, entranceRelevance,
} from './homeFeedLogic.js';

const s = (id, relevance) => ({ id, relevance, summary: '' });
// Jeudi 5 novembre 2026 à différentes heures, heure de Montréal (UTC−5 en novembre)
const at = (h, day = 5, m = 15) => Date.UTC(2026, 10, day, h + 5, m);
// Compare seulement les champs attendus (les états portent aussi until et form)
const same = (actual, expected) => (Array.isArray(expected) || expected === null || typeof expected !== 'object'
    ? assert.deepEqual(actual, expected)
    : assert.deepEqual(Object.fromEntries(Object.keys(expected).map((k) => [k, actual?.[k]])), expected));
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
    same(r.cards, ['cooper']);
    same(r.chips, ['city', 'mail', 'journal']);
});

test('arrange : les alertes passent devant, puis l’ordre du registre', () => {
    const r = arrange([s('city', 'now'), s('cooper', 'alert'), s('mail', 'now'), s('sky', 'alert')]);
    same(r.cards, ['cooper', 'sky', 'city', 'mail']);
});

test('arrange : 5 cartes au plus, Cooper compris, les moins pressées retombent en pastilles', () => {
    const r = arrange([
        s('city', 'now'), s('cooper', 'calm'), s('mail', 'now'), s('house', 'now'),
        s('moves', 'now'), s('guard', 'now'), s('sky', 'alert'), s('journal', 'calm'),
    ]);
    assert.equal(r.cards.length, 5);
    assert.ok(r.cards.includes('cooper'));
    same(r.cards, ['sky', 'guard', 'city', 'mail', 'cooper']);
    same(r.chips, ['house', 'moves', 'journal']);
});

test('arrange : caché ou masqué n’apparaît nulle part, Toujours force la carte', () => {
    const r = arrange([s('city', 'hidden'), s('cooper', 'calm'), s('mail', 'alert'), s('sky', 'calm')],
        { mail: 'hidden', sky: 'always', cooper: 'auto' });
    same(r.cards, ['sky']);
    same(r.chips, ['cooper']);
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
    same(r.cards, ['cooper']);
});

test('musicRelevance : habitude du créneau ou matin en carte, rien pendant la lecture', () => {
    const habit = { suggestion: { habit: true, name: 'Zen' } };
    const plain = { suggestion: { habit: false, name: 'Dîner' } };
    assert.equal(musicRelevance(null, false, NOON).relevance, 'hidden');
    same(musicRelevance(habit, false, NOON), { id: 'music', relevance: 'now', summary: 'Zen' });
    assert.equal(musicRelevance(plain, false, NOON).relevance, 'calm');
    assert.equal(musicRelevance(plain, false, at(7)).relevance, 'now', 'le matin, on propose');
    same(musicRelevance(habit, true, at(7)), { id: 'music', relevance: 'calm', summary: 'en lecture' });
});

// Déplacements : une carte, quatre formes ; l'heure vient de l'horaire de la personne (phase du Pi)
const bixiOn = { enabled: true, configured: true, season: 'open', window: false, verdict: { text: '12 °C, parfait pour le vélo' } };
const bixiOff = { ...bixiOn, season: 'closed' };
const commute = (phase) => ({ enabled: true, configured: true, phase, best: { title: 'BIXI', minutes: 15 } });
const metroOk = { metro: { show: true, error: null, lines: [{ ok: true }] } };
const idle = { updatedAt: 1, radiusM: 500, nearby: [{ dist: 200 }], search: null };
const moves = (o, now) => movesRelevance({ commute: null, bixi: null, city: null, communauto: null, ...o }, now);

test('movesForm : Communauto en cours d’abord, puis trajet en saison BIXI, métro hors saison, Communauto au repos', () => {
    const search = { active: true, radiusM: 300, found: [] };
    assert.equal(movesForm({ commute: null, bixi: bixiOn, city: metroOk, communauto: { ...idle, search } }), 'communauto');
    assert.equal(movesForm({ commute: null, bixi: bixiOn, city: metroOk, communauto: idle }), 'trip');
    // Métro en service normal : la Communauto passe devant ; perturbé, le métro
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: metroOk, communauto: idle }), 'communauto-idle');
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: metroOk, communauto: null }), 'metro');
    const metroBad = { metro: { show: true, error: null, lines: [{ ok: false }] } };
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: metroBad, communauto: idle }), 'metro');
    assert.equal(movesForm({ commute: null, bixi: bixiOff, city: null, communauto: idle }), 'communauto-idle');
    assert.equal(movesForm({ commute: null, bixi: null, city: null, communauto: null }), null);
});

test('movesForm : le trajet de Camille seulement autour de son départ, sinon la Communauto', () => {
    const camille = { ...bixiOn, trips: [{ who: 'Camille', handled: true }] };
    const f = (phase, bixi = camille) => movesForm({ commute: commute(phase), bixi, city: metroOk, communauto: idle });
    assert.equal(f(null), 'communauto-idle', 'pas de trajet aujourd’hui');
    assert.equal(f('before'), 'communauto-idle');
    assert.equal(f('soon'), 'trip');
    assert.equal(f('now'), 'trip');
    assert.equal(f('after'), 'communauto-idle');
    // En saison BIXI de la maison, les trajets sans conseil restent montrés
    assert.equal(f('after', { ...camille, trips: [...camille.trips, { who: 'Moi', handled: false }] }), 'trip');
});

test('movesRelevance : la Communauto au repos se relit au moment où le trajet revient', () => {
    const c = { ...commute('before'), plan: { kind: 'work', from: '08:00', to: '08:30' } };
    const r = moves({ bixi: { ...bixiOn, trips: [{ who: 'Camille', handled: true }] }, commute: c, communauto: idle }, at(6));
    same(r, { form: 'communauto-idle', relevance: 'calm', until: at(7, 5, 15) });
});

test('movesRelevance : carte à l’heure de départ de la personne, pastille après', () => {
    assert.equal(moves({ bixi: bixiOn, commute: commute('before') }).relevance, 'calm');
    same(moves({ bixi: bixiOn, commute: commute('soon') }), { id: 'moves', relevance: 'now', summary: 'BIXI, 15 min' });
    assert.equal(moves({ bixi: bixiOn, commute: commute('now') }).relevance, 'now');
    same(moves({ bixi: bixiOn, commute: commute('after') }), { id: 'moves', relevance: 'calm', summary: '12 °C, parfait pour le vélo' });
    // Sans horaire réglé, la fenêtre de départ des trajets BIXI du Pi
    assert.equal(moves({ bixi: { ...bixiOn, window: true } }).relevance, 'now');
    assert.equal(moves({ bixi: bixiOn }).relevance, 'calm');
});

test('movesRelevance : métro hors saison, perturbé ou à l’heure de partir', () => {
    assert.equal(moves({ bixi: bixiOff, city: metroOk }).relevance, 'calm');
    assert.equal(moves({ bixi: bixiOff, city: metroOk, commute: commute('now') }).relevance, 'now');
    same(moves({ bixi: bixiOff, city: { metro: { show: true, error: null, lines: [{ ok: false }] } } }), { id: 'moves', relevance: 'now', summary: 'métro perturbé' });
});

test('movesRelevance : Communauto au repos en pastille, en tête quand une auto est trouvée ou bloquée', () => {
    same(moves({ communauto: idle }), { id: 'moves', relevance: 'calm', summary: '1 Communauto à 500 m' });
    assert.equal(moves({ communauto: { ...idle, updatedAt: null } }).summary, 'Communauto ne répond pas');
    const search = { active: true, radiusM: 300, found: [] };
    assert.equal(moves({ bixi: bixiOn, communauto: { ...idle, search } }).relevance, 'now');
    const found = { ...search, found: [{ model: 'Kia Niro EV', dist: 240 }] };
    same(moves({ communauto: { ...idle, search: found } }), { id: 'moves', relevance: 'alert', summary: 'Kia Niro EV à 240 m' });
    assert.equal(moves({ communauto: { ...idle, search: { ...search, found: [{ model: 'X', dist: 1, gone: true }] } } }).relevance, 'now');
    assert.equal(moves({}).relevance, 'hidden');
    same(moves({ communauto: { ...idle, booked: { car: { model: 'Toyota Corolla L' } } } }), { id: 'moves', relevance: 'alert', summary: 'Toyota Corolla L bloquée' });
});

test('nextAt : la prochaine bascule, aujourd’hui ou demain', () => {
    assert.equal(nextAt(at(8), [7 * 60, 9 * 60]), at(9, 5, 0));
    assert.equal(nextAt(at(10), [7 * 60, 9 * 60]), at(7, 6, 0));
});

test('échéances : la musique du matin, le ciel du soir, le trajet à la bascule de phase', () => {
    assert.equal(musicRelevance({ suggestion: { habit: false, name: 'Zen' } }, false, at(8)).until, at(9, 5, 0));
    assert.equal(skyRelevance({ aurora: null, highlight: { kind: 'planet' }, night: { quality: { level: 'good' } } }, at(14)).until, at(18, 5, 0));
    const c = { enabled: true, configured: true, phase: 'before', plan: { kind: 'work', from: '08:00', to: '08:30' }, best: null };
    // 6 h 15 : la carte viendra à 7 h 15, 45 min avant 8 h
    assert.equal(moves({ bixi: bixiOn, commute: c }, at(6)).until, at(7, 5, 15));
    assert.equal(guardRelevance({ mode: 'alarm', events: [{ at: at(8) }] }, at(8) + 60_000).until, at(8) + 30 * 60_000);
});

test('buildFeed : cartes, pastilles, ordre et prochaine bascule', () => {
    const feed = buildFeed({
        guard: { mode: null, events: [] }, city: null, cooper: { enabled: true, sensor: {}, mood: 'fed', meals: [] },
        mail: null, music: { suggestion: { habit: false, name: 'Zen' } }, playing: false, sensors: [],
        commute: null, bixi: bixiOn, communauto: idle, sky: null, journalCount: 3,
    }, {}, at(14));
    same(feed.cards, ['cooper']);
    same(feed.chips, ['guard', 'music', 'house', 'moves', 'journal']);
    same(feed.items.find((i) => i.id === 'moves'), { relevance: 'calm', form: 'trip', order: 4 });
    assert.equal(feed.items.find((i) => i.id === 'city').order, null);
    // Sans ciel lu, la prochaine bascule est la musique de demain matin
    assert.equal(feed.nextChange, at(7, 6, 0));
});

test('feedBriefingLine : l’urgent seulement, pas ce que le briefing dit déjà', () => {
    const items = [
        { id: 'moves', relevance: 'now', summary: 'BIXI, 15 min' },
        { id: 'house', relevance: 'calm', summary: 'tout est fermé' },
        { id: 'city', relevance: 'alert', summary: 'orage' },
        { id: 'cooper', relevance: 'now', summary: 'repas bientôt' },
    ];
    assert.equal(feedBriefingLine({ items }), 'À voir sur l’écran : Déplacements, BIXI, 15 min.');
    assert.equal(feedBriefingLine({ items: [] }), null);
});

test('entranceRelevance : en carte seulement allumée', () => {
    assert.equal(entranceRelevance(null).relevance, 'hidden');
    assert.equal(entranceRelevance({ enabled: true, lit: false, manual: false }).relevance, 'hidden');
    const lit = entranceRelevance({ enabled: true, lit: true, manual: false, long: false, offAt: 5000 });
    assert.equal(lit.relevance, 'now');
    assert.equal(lit.until, 5000, 'relue à l’extinction');
    assert.equal(entranceRelevance({ enabled: true, lit: true, long: true, longOffAfterSec: 300 }).summary, 'allumée, 5 min');
    assert.equal(entranceRelevance({ enabled: true, manual: true }).summary, 'allumée, sans minuterie');
});
