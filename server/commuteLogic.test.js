import test from 'node:test';
import assert from 'node:assert/strict';
import { todayPlan, phase, busDepartures, commuteOptions, adviceText, isCommuteQuestion, walkMinutes } from './commuteLogic.js';

const TZ = 'America/Toronto';
// Mardi 24 novembre 2026, heure de Montréal (UTC−5)
const at = (hhmm, day = 24) => Date.parse(`2026-11-${day}T${hhmm}:00-05:00`);
const person = { days: { 1: '11:45-12:15', 2: '08:00-08:30', 4: '08:00-08:30', 5: '08:00-08:30' }, rest: ['3'] };

test('todayPlan : travail, repos le mercredi, rien le week-end', () => {
    assert.equal(todayPlan(person, at('07:00'), TZ).kind, 'work');
    assert.equal(todayPlan(person, at('07:00'), TZ).from, '08:00');
    assert.equal(todayPlan(person, at('07:00', 23), TZ).from, '11:45'); // lundi
    assert.equal(todayPlan(person, at('07:00', 25), TZ).kind, 'rest'); // mercredi
    assert.equal(todayPlan(person, at('07:00', 28), TZ).kind, 'off'); // samedi
});

test('phase : avant, bientôt, maintenant, après', () => {
    const plan = todayPlan(person, at('07:00'), TZ);
    assert.equal(phase(plan, at('07:00'), TZ), 'before');
    assert.equal(phase(plan, at('07:40'), TZ), 'soon');
    assert.equal(phase(plan, at('08:10'), TZ), 'now');
    assert.equal(phase(plan, at('09:00'), TZ), 'after');
});

test('busDepartures : temps réel d’abord, sinon horaire prévu du jour', () => {
    const sched = ['07:45', '08:11', '08:36'];
    const planned = busDepartures({ realtime: null, schedule: sched, from: at('08:00'), tz: TZ });
    assert.deepEqual(planned.map((d) => d.at), [at('08:11'), at('08:36')]);
    assert.equal(planned[0].realtime, false);
    const live = busDepartures({ realtime: [{ at: at('08:14') }, { at: at('07:50') }], schedule: sched, from: at('08:00'), tz: TZ });
    assert.deepEqual(live.map((d) => d.at), [at('08:14')]);
    assert.equal(live[0].realtime, true);
});

const trip = (bikes, ebikes = 0) => ({
    who: 'C',
    from: bikes ? { id: '1', name: 'du Parc / Roy', dist: 180, bikes, ebikes, scarce: bikes === 1 } : null,
    to: { id: '2', name: 'Gilford / Papineau', docks: 8, low: false },
    ebike: ebikes ? { id: '3', name: 'Delta / Epsilon', dist: 400, ebikes } : null,
    rideMin: 8,
});
const bus = { label: 'Bus 99', stopName: 'devant la maison', walkToStopMin: 1, rideMin: 6, walkFromStopMin: 6, departures: [{ at: at('08:11'), realtime: true }] };
const ok = { level: 'ok', text: '2 °C, sec · prends des gants' };

test('commuteOptions : BIXI quand il y a des vélos et qu’il fait sec', () => {
    const r = commuteOptions({ trip: trip(3), verdict: ok, destWalkMin: 3, bus, walkMin: 26, start: at('08:00'), tz: TZ });
    assert.equal(r.best.mode, 'bike');
    assert.match(adviceText('C', r.best, ok, TZ), /^C : BIXI, 3 vélos à Parc \/ Roy/);
});

test('commuteOptions : électrique avec casque quand il n’y a plus de classique', () => {
    const r = commuteOptions({ trip: trip(0, 2), verdict: ok, destWalkMin: 3, bus, walkMin: 26, start: at('08:00'), tz: TZ });
    assert.equal(r.best.mode, 'ebike');
    assert.match(r.best.detail, /casque/);
});

test('commuteOptions : ni vélo ni électrique → bus, avec l’heure de départ', () => {
    const r = commuteOptions({ trip: trip(0), verdict: ok, destWalkMin: 3, bus, walkMin: 26, start: at('08:00'), tz: TZ });
    assert.equal(r.best.mode, 'bus');
    assert.equal(r.best.leaveAt, at('08:10'));
    assert.match(adviceText('C', r.best, ok, TZ), /Pas de BIXI\. Bus 99 à 8 h 11, pars à 8 h 10\. Arrivée vers 8 h 23/);
});

test('commuteOptions : neige → BIXI proposé mais déconseillé, bus d’abord', () => {
    const snow = { level: 'no', text: 'Neige, pas de vélo' };
    const r = commuteOptions({ trip: trip(4), verdict: snow, destWalkMin: 3, bus, walkMin: 26, start: at('08:00'), tz: TZ });
    assert.equal(r.best.mode, 'bus');
    const bike = r.options.find((o) => o.mode === 'bike');
    assert.equal(bike.ok, true);
    assert.match(bike.warn, /déconseillé/);
    assert.match(adviceText('C', r.best, snow, TZ, r.options), /Plein de neige/);
    const far = commuteOptions({ trip: { ...trip(2), from: { ...trip(2).from, dist: 500 } }, verdict: ok, destWalkMin: 3, bus, walkMin: 26, start: at('08:00'), tz: TZ });
    if (far.best.mode === 'bus') assert.match(adviceText('C', far.best, ok, TZ, far.options), /Le bus est plus rapide/);
});

test('commuteOptions : verglas → jamais le vélo ; bus raté → à pied', () => {
    const ice = { level: 'no', text: 'Verglas possible, pas de vélo' };
    const r = commuteOptions({ trip: trip(4), verdict: ice, destWalkMin: 3, bus, walkMin: 26, start: at('08:20'), tz: TZ });
    assert.equal(r.best.mode, 'walk');
    assert.equal(r.options.find((o) => o.mode === 'bike').ok, false);
    assert.match(r.best.warn, /glissants/);
});

test('isCommuteQuestion et walkMinutes', () => {
    assert.ok(isCommuteQuestion('Comment j’y vais ce matin ?'));
    assert.ok(isCommuteQuestion('je prends le bus ?'));
    assert.ok(isCommuteQuestion('Comment j y vais ce matin ?'));
    assert.ok(!isCommuteQuestion('allume le salon'));
    assert.equal(walkMinutes(1500), 26);
});
