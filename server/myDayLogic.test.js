import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayItems, headline, pickOuting, personalSpeech, isDayQuestion } from './myDayLogic.js';

const TZ = 'America/Toronto';
const dayOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
const today = dayOf(Date.now());
const base = { today, dayOf, tz: TZ };

test('journée vide : aucune chose', () => {
    assert.deepEqual(dayItems(base), { items: [], rainAt: null });
});

test('au plus 3 choses, la tempête en premier', () => {
    const r = dayItems({
        ...base,
        weather: {
            storm: { level: 'likely', maxGust: 80, window: null },
            outfits: [{ day: 'today', moment: 'back', hour: 17, past: false, rainProb: 70 }],
        },
        collecte: { tonight: { label: 'Recyclage', done: false, stopped: false } },
        mailbox: { waiting: { count: 1 } },
        cityLine: 'Verglas demain',
    });
    assert.equal(r.items.length, 3);
    assert.deepEqual(r.items.map((i) => i.kind), ['storm', 'bin', 'rain']);
    assert.equal(r.rainAt, 17);
});

test('agenda : rendez-vous à venir, en cours, toute la journée ; les finis disparaissent', () => {
    const now = Date.parse('2026-11-18T17:00:00Z'); // 12 h à Montréal
    const r = dayItems({
        ...base,
        now,
        events: [
            { title: 'Fini', start: now - 7200_000, end: now - 3600_000, allDay: false },
            { title: 'Anniversaire', start: now - 12 * 3600_000, end: now + 12 * 3600_000, allDay: true, location: null },
            { title: 'Réunion', start: now - 600_000, end: now + 1800_000, allDay: false },
            { title: 'Dentiste', start: Date.parse('2026-11-18T19:00:00Z'), end: Date.parse('2026-11-18T20:00:00Z'), allDay: false, location: 'Clinique, 123 rue X' },
        ],
    });
    assert.deepEqual(r.items.map((i) => [i.title, i.detail]), [
        ['Anniversaire', 'Toute la journée'],
        ['Réunion', 'En cours, jusqu’à 12 h 30'],
        ['Dentiste à 14 h', 'Clinique'],
    ]);
});

test('bac déjà sorti et pluie passée : rien', () => {
    const r = dayItems({
        ...base,
        weather: { outfits: [{ day: 'today', hour: 8, past: true, rainProb: 90 }] },
        collecte: { tonight: { label: 'Ordures', done: true } },
    });
    assert.equal(r.items.length, 0);
});

test('accroche : nombre de choses et température négative', () => {
    const morning = new Date('2026-11-17T13:00:00Z').getTime(); // 8 h à Montréal
    const h = headline({ current: { temp: -2.4, feels: -7 } }, [{}, {}], morning, TZ);
    assert.equal(h.greeting, 'Bon matin');
    assert.equal(h.text, 'Deux choses à retenir aujourd’hui. −2° dehors, ressenti −7°.');
    assert.equal(headline(null, [], morning, TZ).text, 'Journée tranquille, rien à signaler.');
});

test('sortie : saute les idées écartées, faites ou passées', () => {
    const now = new Date('2026-11-17T15:00:00Z').getTime();
    const store = {
        outings: {
            ideas: [
                { id: 'a', title: 'Vieux concert', date: '2026-11-10' },
                { id: 'b', title: 'Musée', date: null },
                { id: 'c', title: 'Resto déjà fait' },
                { id: 'd', title: 'Spectacle', date: '2026-11-21' },
            ],
        },
        skipped: ['b'],
        done: ['Resto déjà fait'],
    };
    assert.deepEqual(pickOuting(store, now, TZ), { idea: store.outings.ideas[3], left: 0 });
    assert.equal(pickOuting({ outings: { ideas: [] } }, now, TZ), null);
});

test('briefing personnel : agenda, mails, sortie', () => {
    const now = Date.parse('2026-11-18T13:00:00Z'); // 8 h
    const text = personalSpeech({
        now,
        tz: TZ,
        events: [
            { title: 'Dentiste', start: Date.parse('2026-11-18T19:00:00Z'), end: Date.parse('2026-11-18T20:00:00Z'), allDay: false },
            { title: 'Yoga', start: Date.parse('2026-11-18T23:30:00Z'), end: Date.parse('2026-11-19T00:30:00Z'), allDay: false },
        ],
        mails: { at: now, items: [{ from: 'Propriétaire', draft: 'ok' }] },
        outing: { idea: { title: 'Werther', when: 'Samedi 19 h 30' } },
    });
    assert.equal(text, 'Tu as 2 rendez-vous : Dentiste à 14 heures et Yoga à 18 heures 30. Un mail important : de Propriétaire. Une réponse est prête dans tes brouillons. Une idée pour vous deux : Werther, samedi 19 heures 30.');
    const salon = personalSpeech({ now, tz: TZ, events: [], mails: { at: now, items: [{ from: 'X' }, { from: 'Y' }] }, details: false, outing: { idea: { title: 'Z' } } });
    assert.equal(salon, 'Rien à ton agenda aujourd’hui. Deux mails importants.');
});

test('heure de départ dans les choses et dans le briefing', () => {
    const now = Date.parse('2026-11-18T17:00:00Z'); // 12 h
    const e = { title: 'Dentiste', start: Date.parse('2026-11-18T19:00:00Z'), end: Date.parse('2026-11-18T20:00:00Z'), allDay: false, location: 'Clinique', departure: { at: Date.parse('2026-11-18T18:32:00Z'), via: 'bus 24', walk: false } };
    assert.deepEqual(dayItems({ ...base, now, events: [e] }).items[0], { kind: 'event', title: 'Dentiste à 14 h', detail: 'Pars à 13 h 32 · bus 24', leaveAt: e.departure.at });
    assert.equal(personalSpeech({ now, tz: TZ, events: [e], mails: null }), 'À ton agenda : Dentiste à 14 heures, pars à 13 heures 32 en bus 24.');
});

test('questions sur la journée', () => {
    for (const q of ['C’est quoi ma journée ?', 'Jean-Claude, mon briefing', 'qu’est-ce qu’on fait samedi', 'une idée de sortie']) assert.ok(isDayQuestion(q), q);
    for (const q of ['allume le salon', 'est-ce que Cooper a mangé']) assert.ok(!isDayQuestion(q), q);
});
