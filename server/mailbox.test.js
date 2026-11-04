// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNight, openedByUs, usualTime, since, mailLine, mailSpeech, briefingLine, isMailQuestion } from './mailbox.js';
import { toMin } from './cooper.js';

const TZ = 'America/Toronto';
// Mercredi 4 nov. 2026, heure de Montréal (UTC-5)
const ts = (hhmm, day = '2026-11-04') => Date.parse(`${day}T${hhmm}:00-05:00`);
const W = 4 * 60_000;
const base = { waiting: null, today: { delivery: null, pickup: null }, pending: false, night: null, usual: null, online: true, frozen: false };

test('isNight : plage qui passe minuit', () => {
    assert.equal(isNight(toMin('23:10')), true);
    assert.equal(isNight(toMin('02:00')), true);
    assert.equal(isNight(toMin('06:00')), false);
    assert.equal(isNight(toMin('13:40')), false);
    assert.equal(isNight(toMin('21:59')), false);
});

test('openedByUs : la porte d’entrée juste avant la boîte', () => {
    assert.equal(openedByUs(ts('17:03'), ts('17:01'), W), true);
    assert.equal(openedByUs(ts('17:10'), ts('17:01'), W), false, 'trop longtemps après');
    assert.equal(openedByUs(ts('13:42'), 0, W), false, 'porte jamais ouverte');
    assert.equal(openedByUs(ts('13:42'), ts('13:43'), W), false, 'la porte après : décidé plus tard');
});

test('usualTime : médiane du premier passage de chaque jour, au quart d’heure', () => {
    const now = ts('09:00', '2026-11-10');
    const ev = [
        { kind: 'delivery', at: ts('13:20', '2026-11-02') },
        { kind: 'delivery', at: ts('15:00', '2026-11-02') }, // 2e passage du jour, ignoré
        { kind: 'delivery', at: ts('13:40', '2026-11-03') },
        { kind: 'pickup', at: ts('17:00', '2026-11-03') },
    ];
    assert.equal(usualTime(ev, now, TZ), null, 'moins de 3 jours');
    ev.push({ kind: 'delivery', at: ts('13:55', '2026-11-04') });
    assert.equal(usualTime(ev, now, TZ), toMin('13:45'));
});

test('since : aujourd’hui, hier, plus vieux', () => {
    const now = ts('18:00');
    assert.equal(since(ts('13:42'), now, TZ), '13 h 42');
    assert.equal(since(ts('13:42', '2026-11-03'), now, TZ), 'hier, 13 h 42');
    assert.equal(since(ts('13:42', '2026-11-02'), now, TZ), 'lundi');
});

test('mailLine : courrier, relevé, rien, fin de semaine, nuit, gel', () => {
    const now = ts('15:00');
    assert.equal(mailLine({ ...base, waiting: { since: ts('13:42'), count: 1 } }, now, TZ).line, 'Okayyy ! Une missive vous attend depuis 13 h 42.');
    assert.match(mailLine({ ...base, waiting: { since: ts('13:42'), count: 2 } }, now, TZ).line, /2 fois/);
    assert.deepEqual(mailLine({ ...base, today: { delivery: ts('13:42'), pickup: ts('14:30') } }, now, TZ),
        { mood: 'done', line: "C'est relevé, messire ! Le facteur était passé à 13 h 42." });
    assert.equal(mailLine({ ...base, usual: toMin('13:30') }, ts('10:00'), TZ).line, "Point de missive pour l'heure. Le facteur passe d'habitude vers 13 h 30.");
    assert.equal(mailLine(base, ts('17:30'), TZ).line, 'Point de missive ce jour. Le facteur n’est point passé.');
    assert.equal(mailLine(base, ts('11:00', '2026-11-08'), TZ).line, 'Point de facteur le dimanche, messire. Repos !');
    assert.equal(mailLine({ ...base, night: { at: ts('02:14') } }, now, TZ).mood, 'night');
    assert.equal(mailLine({ ...base, pending: true }, now, TZ).mood, 'pending');
    assert.match(mailLine({ ...base, online: false, frozen: true }, now, TZ).line, /geler/);
    // Le courrier qui attend passe avant le capteur muet
    assert.equal(mailLine({ ...base, online: false, waiting: { since: ts('13:42'), count: 1 } }, now, TZ).mood, 'mail');
});

test('mailSpeech et briefingLine', () => {
    const view = { ...base, sensor: { did: 'x' } };
    const now = ts('15:00');
    assert.equal(mailSpeech({ ...view, waiting: { since: ts('13:42'), count: 1 } }, now, TZ), "Oui, le facteur est passé à 13 h 42, et le courrier n'est pas encore relevé.");
    assert.equal(mailSpeech({ ...view, today: { delivery: ts('13:42'), pickup: ts('14:30') } }, now, TZ), 'Oui, le facteur est passé à 13 h 42 et le courrier a été relevé à 14 h 30.');
    assert.equal(mailSpeech({ ...view, usual: toMin('13:30') }, ts('10:00'), TZ), "Non, le facteur n'est pas encore passé aujourd'hui. Il passe d'habitude vers 13 h 30.");
    assert.equal(mailSpeech({ ...base, sensor: null }, now, TZ), "Je n'ai pas de capteur sur la boîte aux lettres.");
    assert.equal(briefingLine({ ...view, waiting: { since: ts('13:42'), count: 1 } }, now, TZ), null, 'du jour : pas au briefing');
    assert.equal(briefingLine({ ...view, waiting: { since: ts('13:42', '2026-11-03'), count: 1 } }, ts('08:30'), TZ),
        'Du courrier attend dans la boîte aux lettres depuis hier, 13 h 42.');
});

test('isMailQuestion', () => {
    assert.equal(isMailQuestion('Est-ce que le facteur est passé ?'), true);
    assert.equal(isMailQuestion('Y a du courrier ?'), true);
    assert.equal(isMailQuestion('allume le salon'), false);
});
