// Cooper appelle en visio : quand ça sonne, quand il rappelle, ce qu'il dit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRing, walkDue, retryDelay, endLine, pickLine, dayBefore, inCallHours, LINES } from './cooperCallLogic.js';

const m = (hhmm) => {
    const [h, mm] = hhmm.split(':').map(Number);
    return h * 60 + mm;
};
const base = { mode: 'sometimes', date: '2026-11-27', minutes: m('18:30'), lastCall: null, roll: 0.1 };

test('dayBefore passe les mois et les années', () => {
    assert.equal(dayBefore('2026-12-01'), '2026-11-30');
    assert.equal(dayBefore('2027-01-01'), '2026-12-31');
});

test('heures d’appel : 8 h à 21 h 30', () => {
    assert.equal(inCallHours(m('07:59')), false);
    assert.equal(inCallHours(m('08:00')), true);
    assert.equal(inCallHours(m('21:29')), true);
    assert.equal(inCallHours(m('21:30')), false);
});

test('parfois : une chance sur trois, jamais deux jours de suite', () => {
    assert.equal(shouldRing(base), true);
    assert.equal(shouldRing({ ...base, roll: 0.5 }), false, 'le tirage perd');
    assert.equal(shouldRing({ ...base, lastCall: '2026-11-27' }), false, 'déjà appelé aujourd’hui');
    assert.equal(shouldRing({ ...base, lastCall: '2026-11-26' }), false, 'appelé hier');
    assert.equal(shouldRing({ ...base, lastCall: '2026-11-25' }), true, 'avant-hier, c’est permis');
});

test('toujours et jamais ; jamais hors des heures', () => {
    assert.equal(shouldRing({ ...base, mode: 'always', roll: 0.99, lastCall: '2026-11-27' }), true);
    assert.equal(shouldRing({ ...base, mode: 'never' }), false);
    assert.equal(shouldRing({ ...base, mode: 'always', minutes: m('22:00') }), false);
});

test('promenade : de 9 h 30 à 11 h, si la porte n’a pas bougé depuis 8 h', () => {
    const now = Date.parse('2026-11-27T09:40:00-05:00');
    const minutes = m('09:40');
    assert.equal(walkDue({ minutes, walkedAt: null, now }), true);
    assert.equal(walkDue({ minutes, walkedAt: now - 30 * 60_000, now }), false, 'sorti à 9 h 10');
    assert.equal(walkDue({ minutes, walkedAt: now - 3 * 3600_000, now }), true, 'la porte à 6 h 40 ne compte pas');
    assert.equal(walkDue({ minutes: m('09:20'), walkedAt: null, now }), false);
    assert.equal(walkDue({ minutes: m('11:00'), walkedAt: null, now }), false);
});

test('rappel : une seule fois, plus tôt après « Dans 10 min »', () => {
    assert.equal(retryDelay({ outcome: 'later', wasRetry: false, kind: 'meal' }), 10 * 60_000);
    assert.equal(retryDelay({ outcome: 'hung', wasRetry: false, kind: 'meal' }), 20 * 60_000);
    assert.equal(retryDelay({ outcome: 'timeout', wasRetry: false, kind: 'walk' }), 20 * 60_000);
    assert.equal(retryDelay({ outcome: 'hung', wasRetry: true, kind: 'meal' }), null);
    assert.equal(retryDelay({ outcome: 'fed', wasRetry: false, kind: 'meal' }), null);
    assert.equal(retryDelay({ outcome: 'hung', wasRetry: false, kind: 'test' }), null);
});

test('phrase de fin', () => {
    assert.equal(endLine({ outcome: 'fed', kind: 'meal' }), LINES.fed);
    assert.equal(endLine({ outcome: 'walked', kind: 'walk' }), LINES.walked);
    assert.equal(endLine({ outcome: 'hung', kind: 'meal', willRetry: true }), LINES.hung);
    assert.equal(endLine({ outcome: 'hung', kind: 'meal', willRetry: false }), LINES.hungLast);
    assert.equal(endLine({ outcome: 'timeout', kind: 'meal', willRetry: true }), LINES.noAnswer, 'raccroché tout seul : personne');
    assert.equal(endLine({ outcome: 'timeout', kind: 'meal', willRetry: false }), LINES.hungLast);
    assert.equal(endLine({ outcome: 'fed', kind: 'test' }), LINES.testEnd);
});

test('répliques : tirage borné, repas nommé', () => {
    assert.equal(pickLine({ kind: 'meal' }, 0), LINES.meal[0]);
    assert.equal(pickLine({ kind: 'meal' }, 0.9999), LINES.meal.at(-1).replace('{meal}', ''));
    assert.match(pickLine({ kind: 'meal', meal: 'soir' }, 0.99), /repas de soir/);
    assert.equal(pickLine({ kind: 'meal', retry: true }, 0), LINES.mealRetry[0]);
    assert.equal(pickLine({ kind: 'walk' }, 0), LINES.walk[0]);
    assert.equal(pickLine({ kind: 'test' }, 0.5), LINES.test[0]);
});
