import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeTriggerDue, startVolume, describeTimeTrigger, cleanTimeTrigger, targetMinutes } from './scheduleLogic.js';

const now = (weekday, hhmm, day = '2026-11-23') => {
    const [h, m] = hhmm.split(':').map(Number);
    return { day, weekday, minutes: h * 60 + m };
};
const classique = { type: 'time', at: '10:00', days: [1, 2, 4] };

test('fires on the right day at the right time, once', () => {
    assert.equal(timeTriggerDue(classique, now(1, '10:00'), null, null), true);
    assert.equal(timeTriggerDue(classique, now(1, '10:04'), null, null), true, 'catch-up window');
    assert.equal(timeTriggerDue(classique, now(1, '10:00'), null, '2026-11-23'), false, 'already fired today');
    assert.equal(timeTriggerDue(classique, now(1, '09:59'), null, null), false);
    assert.equal(timeTriggerDue(classique, now(1, '10:10'), null, null), false, 'too late, no surprise at 15:00');
    assert.equal(timeTriggerDue(classique, now(3, '10:00'), null, null), false, 'Wednesday is not in the list');
});

test('empty days means every day', () => {
    assert.equal(timeTriggerDue({ at: '17:00', days: [] }, now(0, '17:01'), null, null), true);
});

test('sunset with offset, unknown sun never fires', () => {
    const t = { at: 'sunset', offsetMinutes: -15, days: [] };
    assert.equal(targetMinutes(t, { sunset: 16 * 60 + 18 }), 16 * 60 + 3);
    assert.equal(timeTriggerDue(t, now(0, '16:03'), { sunset: 16 * 60 + 18 }, null), true);
    assert.equal(timeTriggerDue(t, now(0, '16:03'), null, null), false);
});

test('start volume is capped in quiet hours, free otherwise', () => {
    assert.equal(startVolume(null, 8 * 60 + 30), 20, 'morning without volume: soft default');
    assert.equal(startVolume(80, 8 * 60 + 30), 30, 'morning: capped');
    assert.equal(startVolume(15, 10 * 60), 15);
    assert.equal(startVolume(80, 17 * 60), 80, 'afternoon: as asked');
    assert.equal(startVolume(null, 17 * 60), null, 'afternoon without volume: untouched');
    assert.equal(startVolume(60, 22 * 60 + 30), 30, 'late evening: capped');
});

test('readable summaries', () => {
    assert.equal(describeTimeTrigger(classique), 'à 10:00 lun, mar, jeu');
    assert.equal(describeTimeTrigger({ at: '17:00', days: [3, 4, 5, 6] }), 'à 17:00 mer, jeu, ven, sam');
    assert.equal(describeTimeTrigger({ at: '07:00', days: [1, 2, 3, 4, 5] }), 'à 07:00 en semaine');
    assert.equal(describeTimeTrigger({ at: 'sunset', offsetMinutes: -15 }), '15 min avant le coucher du soleil tous les jours');
    assert.equal(describeTimeTrigger({ at: 'sunrise', days: [0, 6] }), 'au lever du soleil la fin de semaine');
});

test('trigger validation', () => {
    assert.deepEqual(cleanTimeTrigger({ at: '7:05', days: [4, 1, 1] }), { type: 'time', at: '07:05', offsetMinutes: 0, days: [1, 4] });
    assert.throws(() => cleanTimeTrigger({ at: '25:00' }), /Heure invalide/);
    assert.throws(() => cleanTimeTrigger({ at: '10:00', days: [7] }), /Jours invalides/);
});
