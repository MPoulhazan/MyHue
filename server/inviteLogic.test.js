import { test } from 'node:test';
import assert from 'node:assert/strict';
import ical from 'node-ical';
import { parseTimes, timeChoices, durationMin, dayChoices, startOf, emailFromIcal, gcalUrl, eventDetails, findPlanEvent, planStatus } from './inviteLogic.js';
import { calendarEvents } from './calendarLogic.js';

const TZ = 'America/Toronto';
// Dimanche 22 novembre 2026, midi
const SUN = Date.parse('2026-11-22T17:00:00Z');

test('heures des séances', () => {
    assert.deepEqual(parseTimes('19 h et 21 h 15'), ['19:00', '21:15']);
    assert.deepEqual(parseTimes('Séances 19h30, 20:00'), ['19:30', '20:00']);
    assert.deepEqual(parseTimes(''), []);
});

test('heures proposées : séances, puis l’heure d’un spectacle, sinon un choix de soirée', () => {
    assert.deepEqual(timeChoices({ kind: 'cinema', times: '19 h et 21 h 15' }), ['19:00', '21:15']);
    assert.deepEqual(timeChoices({ kind: 'concert', when: 'Samedi 20 h' }), ['20:00']);
    // Les heures d'ouverture d'un resto ne sont pas des séances
    assert.deepEqual(timeChoices({ kind: 'resto', when: 'Mar–sam 17 h à 22 h 30' }), ['18:30', '19:00', '19:30', '20:00']);
});

test('durée', () => {
    assert.equal(durationMin('1 h 52', 'cinema'), 112);
    assert.equal(durationMin('2 h', 'event'), 120);
    assert.equal(durationMin('90 min', 'event'), 90);
    assert.equal(durationMin(null, 'resto'), 120);
    assert.equal(durationMin(undefined, 'museum'), 150);
});

test('soirs proposés : la date de l’idée, sinon mercredi à samedi', () => {
    assert.deepEqual(dayChoices({ date: '2026-11-28' }, [{ date: '2026-11-28', free: true }], SUN, TZ), [{ date: '2026-11-28', free: true }]);
    const days = dayChoices({ date: null }, [{ date: '2026-11-25', free: false }], SUN, TZ);
    assert.deepEqual(days.map((d) => d.date), ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
    assert.equal(days[0].free, false);
    assert.equal(days[1].free, null);
});

test('début de la sortie à l’heure de Montréal', () => {
    assert.equal(new Date(startOf('2026-11-28', '19:00', TZ)).toISOString(), '2026-11-29T00:00:00.000Z');
    assert.equal(startOf('2026-11-28', '7pm', TZ), null);
});

test('courriel tiré de l’adresse iCal secrète Google', () => {
    assert.equal(emailFromIcal('https://calendar.google.com/calendar/ical/jo.doe%40gmail.com/private-abc/basic.ics'), 'jo.doe@gmail.com');
    assert.equal(emailFromIcal('https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-x/basic.ics'), null);
    assert.equal(emailFromIcal('https://example.com/cal.ics'), null);
});

test('lien Google Agenda prérempli avec l’invité', () => {
    const url = new URL(gcalUrl({ title: 'Film', start: Date.parse('2026-11-29T00:00:00Z'), end: Date.parse('2026-11-29T02:10:00Z'), location: 'Cinéma du Parc', details: 'x', guest: 'b@test.com' }, TZ));
    assert.equal(url.host, 'calendar.google.com');
    assert.equal(url.searchParams.get('action'), 'TEMPLATE');
    assert.equal(url.searchParams.get('dates'), '20261129T000000Z/20261129T021000Z');
    assert.equal(url.searchParams.get('add'), 'b@test.com');
    assert.equal(url.searchParams.get('location'), 'Cinéma du Parc');
    assert.equal(gcalUrl({ title: 'A', start: 0, end: 1 }).includes('add='), false);
});

test('texte de l’événement : billets d’abord, sinon la page source', () => {
    assert.match(eventDetails({ why: 'Pourquoi', price: '10 $', bookingUrl: 'https://b', url: 'https://u' }), /Pourquoi\nPrix : 10 \$\nBillets : https:\/\/b/);
    assert.match(eventDetails({ url: 'https://u' }), /Infos : https:\/\/u/);
});

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:x
DTSTART:20261129T000000Z
DTEND:20261129T021000Z
SUMMARY:Les Saisons (VOSTF)
ORGANIZER;CN=a@test.com:mailto:a@test.com
ATTENDEE;PARTSTAT=ACCEPTED;CN=a@test.com:mailto:a@test.com
ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=b@test.com:mailto:B@test.com
END:VEVENT
END:VCALENDAR`;

test('réponse de l’invité lue dans l’agenda branché', () => {
    const events = calendarEvents(ical.sync.parseICS(ICS), Date.parse('2026-11-28T00:00:00Z'), Date.parse('2026-11-30T00:00:00Z'), () => []);
    assert.deepEqual(events[0].attendees, [{ email: 'a@test.com', partstat: 'ACCEPTED' }, { email: 'b@test.com', partstat: 'NEEDS-ACTION' }]);
    const plan = { title: 'Les Saisons (VOSTF)', start: Date.parse('2026-11-29T00:05:00Z'), guestEmail: 'b@test.com', inviterEmail: 'a@test.com', manual: null };
    const found = findPlanEvent(plan, events);
    assert.ok(found);
    assert.equal(planStatus(plan, found, true), 'pending');
    assert.equal(planStatus(plan, { ...found, attendees: [{ email: 'b@test.com', partstat: 'ACCEPTED' }] }, true), 'confirmed');
    assert.equal(planStatus(plan, { ...found, attendees: [{ email: 'b@test.com', partstat: 'DECLINED' }] }, true), 'declined');
    // Sans le courriel de l'invité : le premier invité qui n'est pas l'organisateur
    assert.equal(planStatus({ ...plan, guestEmail: null }, { ...found, attendees: [{ email: 'a@test.com', partstat: 'ACCEPTED' }, { email: 'c@test.com', partstat: 'ACCEPTED' }] }, true), 'confirmed');
    // Pas encore dans l'agenda, ou aucun agenda : envoyée ; la confirmation à la main l'emporte
    assert.equal(planStatus(plan, null, true), 'sent');
    assert.equal(planStatus({ ...plan, manual: 'confirmed' }, null, false), 'confirmed');
    // Une autre heure : ce n'est pas l'événement
    assert.equal(findPlanEvent({ ...plan, start: plan.start + 3600_000 }, events), null);
});
