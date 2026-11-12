// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignOpening, mealStatus, cooperLine, cooperSpeech, isCooperQuestion, toMin, localParts, dayMoment } from './cooper.js';

const MEALS = [
    { id: 'midi', label: 'midi', time: '12:00', from: '10:30', to: '13:30' },
    { id: 'soir', label: 'soir', time: '18:00', from: '16:30', to: '19:30' },
];
const at = (hhmm) => toMin(hhmm);
const TZ = 'America/Toronto';
// 4 nov. 2026, heure de Montréal (UTC-5)
const ts = (hhmm) => Date.parse(`2026-11-04T${hhmm}:00-05:00`);

test('assignOpening : dans la plage, hors plage, rattrapage, double', () => {
    assert.deepEqual(assignOpening(at('12:04'), MEALS), { meal: 'midi', double: false });
    assert.deepEqual(assignOpening(at('10:30'), MEALS), { meal: 'midi', double: false });
    assert.equal(assignOpening(at('09:00'), MEALS), null, 'remplir la boîte le matin ne compte pas');
    assert.deepEqual(assignOpening(at('14:10'), MEALS), { meal: 'midi', late: true }, 'repas de midi oublié, donné en retard');
    assert.equal(assignOpening(at('14:10'), MEALS, { midi: { at: 1 } }), null, 'midi déjà donné : ouverture hors plage ignorée');
    assert.deepEqual(assignOpening(at('18:05'), MEALS, { soir: { at: 1 } }), { meal: 'soir', double: true });
    assert.deepEqual(assignOpening(at('20:30'), MEALS), { meal: 'soir', late: true });
    assert.equal(assignOpening(at('23:30'), MEALS), null);
});

test('mealStatus : à venir, bientôt, l’heure, oublié, raté, donné', () => {
    assert.equal(mealStatus(MEALS, 0, at('09:00')), 'upcoming');
    assert.equal(mealStatus(MEALS, 0, at('11:45')), 'soon');
    assert.equal(mealStatus(MEALS, 0, at('12:10')), 'due');
    assert.equal(mealStatus(MEALS, 0, at('12:30')), 'late');
    assert.equal(mealStatus(MEALS, 0, at('16:00')), 'late', 'rattrapable jusqu’à la plage du soir');
    assert.equal(mealStatus(MEALS, 0, at('16:30')), 'missed');
    assert.equal(mealStatus(MEALS, 0, at('12:30'), { midi: { at: 1 } }), 'done');
});

test('localParts suit le fuseau de Montréal', () => {
    assert.deepEqual(localParts(ts('12:04'), TZ), { date: '2026-11-04', minutes: at('12:04') });
});

const view = (now, fed = {}) => ({
    meals: MEALS.map((m, i) => ({ ...m, status: mealStatus(MEALS, i, localParts(now, TZ).minutes, fed), at: fed[m.id]?.at ?? null })),
    double: null,
});

test('cooperLine : ce que dit Cooper', () => {
    let now = ts('09:00');
    assert.match(cooperLine(view(now), now, TZ).line, /Prochain repas à 12 h/);
    now = ts('17:45');
    const fed = { midi: { at: ts('12:04') } };
    assert.equal(cooperLine(view(now, fed), now, TZ).line, 'Plus que 15 minutes… je surveille la boîte.');
    now = ts('12:34');
    const late = cooperLine(view(now), now, TZ);
    assert.equal(late.mood, 'late');
    assert.match(late.line, /il y a 34 min/);
    now = ts('13:00');
    assert.equal(cooperLine(view(now, fed), now, TZ).line, 'Miam, merci ! On se revoit à 18 h.');
    now = ts('21:00');
    assert.equal(cooperLine(view(now, { ...fed, soir: { at: ts('18:02') } }), now, TZ).mood, 'fed');
    const dbl = { ...view(ts('12:20'), fed), double: { at: ts('12:20'), meal: 'midi', fedAt: ts('12:04') } };
    assert.match(cooperLine(dbl, ts('12:20'), TZ).line, /Déjà mangé à 12 h 04/);
});

test('cooperSpeech et isCooperQuestion (Jarvis)', () => {
    const fed = { midi: { at: ts('12:04') } };
    assert.equal(cooperSpeech(view(ts('13:00'), fed), TZ), 'Oui, Cooper a mangé à 12 h 04. Prochain repas à 18 h.');
    assert.match(cooperSpeech(view(ts('12:40')), TZ), /^Non, Cooper n'a pas eu son repas de midi/);
    assert.ok(isCooperQuestion('Est-ce que Cooper a mangé ?'));
    assert.ok(isCooperQuestion('on a donné les croquettes ?'));
    assert.ok(!isCooperQuestion('allume le bar'));
});

test('dayMoment : dodo, réveil, promenade', () => {
    const M = 60_000;
    const now = 1_000_000_000_000;
    assert.equal(dayMoment({ minutes: 21 * 60 + 5, fedAll: true }, now).moment, 'dodo');
    assert.equal(dayMoment({ minutes: 3 * 60, fedAll: true }, now).moment, 'dodo');
    assert.equal(dayMoment({ minutes: 22 * 60, fedAll: false }, now), null);
    assert.equal(dayMoment({ minutes: 8 * 60 + 10, fedAll: true }, now).line, 'Ça pousse !');
    assert.equal(dayMoment({ minutes: 9 * 60 + 5, fedAll: true }, now).line, 'Ça pousse vraiment, là…');
    // Sortie à 8 h 20, vu à 8 h 30 : mission accomplie ; à 9 h 00 : on n'en parle plus
    assert.equal(dayMoment({ minutes: 8 * 60 + 30, fedAll: true, walkedAt: now - 10 * M }, now).moment, 'walked');
    assert.equal(dayMoment({ minutes: 9 * 60, fedAll: true, walkedAt: now - 40 * M }, now), null);
    // Une ouverture d'avant 8 h ne compte pas comme promenade
    assert.equal(dayMoment({ minutes: 8 * 60 + 5, fedAll: true, walkedAt: now - 20 * M }, now).moment, 'pousse');
    assert.equal(dayMoment({ minutes: 12 * 60, fedAll: true }, now), null);
});
