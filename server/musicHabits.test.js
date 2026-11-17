// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotOf, suggest, defaultMood } from './musicHabits.js';

const TZ = 'America/Toronto';
// Heure de Montréal en novembre (UTC-5)
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00-05:00`);
const zen = (t) => ({ t, kind: 'mood', id: 'zen', name: 'Zen' });
const jazz = (t) => ({ t, kind: 'playlist', id: 'PLjazz', name: 'Jazz du dimanche' });

test('slotOf : semaine / week-end et moment de la journée', () => {
    assert.deepEqual(
        { ...slotOf(at('2026-11-16', '07:30'), TZ), day: undefined },
        { weekend: false, band: 'matin', label: 'le matin', day: undefined },
    );
    assert.equal(slotOf(at('2026-11-15', '19:00'), TZ).weekend, true, 'dimanche');
    assert.equal(slotOf(at('2026-11-16', '23:30'), TZ).band, 'nuit');
    assert.equal(slotOf(at('2026-11-16', '02:00'), TZ).band, 'nuit');
});

test('suggest : 3 matins de semaine distincts font une habitude', () => {
    const now = at('2026-11-16', '07:40'); // lundi
    const log = [zen(at('2026-11-10', '07:10')), zen(at('2026-11-11', '08:20')), zen(at('2026-11-12', '06:50'))];
    const s = suggest(log, now, { tz: TZ });
    assert.equal(s.id, 'zen');
    assert.equal(s.days, 3);
    assert.match(s.reason, /3 fois en semaine, le matin/);
});

test('suggest : deux fois ne suffit pas, le même jour ne compte qu’une fois', () => {
    const now = at('2026-11-16', '07:40');
    const log = [zen(at('2026-11-10', '07:10')), zen(at('2026-11-10', '08:30')), zen(at('2026-11-11', '07:00'))];
    assert.equal(suggest(log, now, { tz: TZ }), null);
});

test('suggest : autre créneau ou week-end ignorés', () => {
    const now = at('2026-11-16', '07:40');
    const evenings = [jazz(at('2026-11-10', '19:00')), jazz(at('2026-11-11', '19:00')), jazz(at('2026-11-12', '19:00'))];
    assert.equal(suggest(evenings, now, { tz: TZ }), null);
    const weekend = [zen(at('2026-11-07', '07:00')), zen(at('2026-11-08', '07:00')), zen(at('2026-11-14', '07:00'))];
    assert.equal(suggest(weekend, now, { tz: TZ }), null);
    assert.equal(suggest(weekend, at('2026-11-15', '08:00'), { tz: TZ }).id, 'zen', 'mais compte le dimanche matin');
});

test('suggest : les jours récents pèsent plus, et on exclut ce qui joue', () => {
    const now = at('2026-11-16', '07:40');
    const old = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((d) => jazz(at(d, '07:00')));
    const fresh = ['2026-11-10', '2026-11-11', '2026-11-12'].map((d) => zen(at(d, '07:00')));
    assert.equal(suggest([...old, ...fresh], now, { tz: TZ }).id, 'zen');
    assert.equal(suggest([...old, ...fresh], now, { tz: TZ, exclude: 'mood:zen' }).id, 'PLjazz');
});

test('suggest : au-delà de 8 semaines, oublié', () => {
    const now = at('2026-11-16', '07:40');
    const ancient = ['2026-08-03', '2026-08-04', '2026-08-05'].map((d) => zen(at(d, '07:00')));
    assert.equal(suggest(ancient, now, { tz: TZ }), null);
});

test('defaultMood : une ambiance selon l’heure', () => {
    assert.equal(defaultMood(at('2026-11-16', '07:00'), TZ).id, 'zen');
    assert.equal(defaultMood(at('2026-11-16', '10:00'), TZ).id, 'focus');
    assert.equal(defaultMood(at('2026-11-16', '19:30'), TZ).id, 'diner');
    assert.equal(defaultMood(at('2026-11-16', '23:30'), TZ).id, 'dodo');
});
