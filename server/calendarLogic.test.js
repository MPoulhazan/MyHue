import { test } from 'node:test';
import assert from 'node:assert/strict';
import ical from 'node-ical';
import { calendarEvents, freeEvenings, localMidnight } from './calendarLogic.js';

const TZ = 'America/Toronto';
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
DTSTART;TZID=America/Toronto:20260901T140000
DTEND;TZID=America/Toronto:20260901T150000
RRULE:FREQ=WEEKLY;BYDAY=WE
SUMMARY:Cours hebdo
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART:20261118T150000Z
DTEND:20261118T160000Z
SUMMARY:Dentiste
LOCATION:Clinique du Plateau
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261118
DTEND;VALUE=DATE:20261119
SUMMARY:Anniversaire
END:VEVENT
BEGIN:VEVENT
UID:d
DTSTART:20261118T200000Z
DTEND:20261118T210000Z
STATUS:CANCELLED
SUMMARY:Annulé
END:VEVENT
END:VCALENDAR`;

const parsed = ical.sync.parseICS(ICS);
const expand = (ev, range) => ical.expandRecurringEvent(ev, range);

test('minuit local, heure d’hiver', () => {
    assert.equal(new Date(localMidnight(Date.parse('2026-11-18T15:00:00Z'), TZ)).toISOString(), '2026-11-18T05:00:00.000Z');
});

test('événements du jour : récurrent, ponctuel, toute la journée, sans les annulés', () => {
    const from = localMidnight(Date.parse('2026-11-18T15:00:00Z'), TZ);
    const ev = calendarEvents(parsed, from, from + 86_400_000, expand);
    assert.deepEqual(ev.map((e) => e.title), ['Anniversaire', 'Dentiste', 'Cours hebdo']);
    assert.equal(ev[0].allDay, true);
    assert.equal(ev[0].start, from);
    assert.equal(ev[1].location, 'Clinique du Plateau');
    assert.equal(new Date(ev[2].start).toISOString(), '2026-11-18T19:00:00.000Z');
});

test('soirées : mercredi au samedi, prise si un rendez-vous touche 17 h – 23 h', () => {
    const now = Date.parse('2026-11-18T14:00:00Z'); // mercredi 9 h
    const events = [{ start: Date.parse('2026-11-20T23:00:00Z'), end: Date.parse('2026-11-21T01:00:00Z'), allDay: false }]; // vendredi 18 h
    const r = freeEvenings([{ id: 'a', name: 'A', events }], now, TZ);
    assert.deepEqual(r.map((e) => e.date), ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    assert.deepEqual(r.find((e) => e.date === '2026-11-20'), { date: '2026-11-20', free: false, busy: ['A'] });
    assert.equal(r.find((e) => e.date === '2026-11-21').free, true);
});
