import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayItems, headline, pickOuting } from './myDayLogic.js';

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
