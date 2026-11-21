import { test } from 'node:test';
import assert from 'node:assert/strict';
import { christmasSeason } from './seasonLogic.js';
import { adventView, adventRelevance, adventBriefingLine, isAdventCommand } from './adventLogic.js';

// Midi à Montréal (UTC−5 en hiver)
const at = (m, d) => Date.UTC(2026, m - 1, d, 17, 0);

test('la saison va du 24 novembre au 31 décembre', () => {
    assert.equal(christmasSeason(at(11, 23)).on, false);
    assert.equal(christmasSeason(at(1, 2)).on, false);
    const nov = christmasSeason(at(11, 24));
    assert.equal(nov.phase, 'before');
    assert.equal(nov.daysToAdvent, 7);
    assert.equal(nov.daysToChristmas, 31);
    const d12 = christmasSeason(at(12, 12));
    assert.deepEqual([d12.phase, d12.adventDay, d12.daysToChristmas], ['advent', 12, 13]);
    assert.equal(christmasSeason(at(12, 25)).phase, 'christmas');
    assert.equal(christmasSeason(at(12, 31)).phase, 'after');
});

test('la date suit Montréal, pas UTC', () => {
    // 30 novembre 22 h à Montréal = 1er décembre 3 h UTC
    assert.equal(christmasSeason(Date.UTC(2026, 11, 1, 3, 0)).phase, 'before');
});

test('une case à venir ne dévoile rien', () => {
    const v = adventView({ 3: 1 }, christmasSeason(at(12, 12)));
    assert.equal(v.days[12].title, undefined);
    assert.equal(v.days[12].openable, false);
    assert.equal(v.days[11].today, true);
    assert.equal(v.days[2].openedAt, 1);
    assert.equal(v.days[0].openedAt, null);
    assert.equal(v.todayOpened, false);
});

test('la carte passe devant tant que la case du jour est fermée', () => {
    const s = christmasSeason(at(12, 12));
    assert.equal(adventRelevance(adventView({}, s)).relevance, 'now');
    assert.equal(adventRelevance(adventView({ 12: 1 }, s)).relevance, 'calm');
    assert.equal(adventRelevance(adventView({}, christmasSeason(at(11, 26)))).summary, 'ouvre dans 5 jours');
    assert.equal(adventRelevance(adventView({}, christmasSeason(at(2, 1)))).relevance, 'hidden');
    assert.equal(adventRelevance(null).relevance, 'hidden');
});

test('le briefing compte les dodos', () => {
    assert.equal(adventBriefingLine(adventView({}, christmasSeason(at(12, 12)))), 'Plus que 13 dodos avant Noël, et la case 12 du calendrier vous attend.');
    assert.equal(adventBriefingLine(adventView({ 24: 1 }, christmasSeason(at(12, 24)))), 'Plus qu’un dodo avant Noël.');
    assert.equal(adventBriefingLine(adventView({}, christmasSeason(at(3, 1)))), null);
});

test('la commande vocale', () => {
    assert.ok(isAdventCommand('Ouvre la case du jour'));
    assert.ok(isAdventCommand('ouvre le calendrier de l’Avent'));
    assert.ok(!isAdventCommand('ouvre la lumière du salon'));
    assert.ok(!isAdventCommand('ferme la porte'));
});
