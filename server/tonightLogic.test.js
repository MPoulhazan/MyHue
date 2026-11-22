import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTonight, hourAt, pickMode, weatherLine, tonightPlan, shouldRemind, cooperLine, briefingLine, reminderText, speech, tonightRelevance, hm } from './tonightLogic.js';

const TZ = 'America/Toronto';
// Samedi 28 novembre 2026 : 10 h, et la séance à 19 h (00:00 UTC le 29)
const MORNING = Date.parse('2026-11-28T15:00:00Z');
const START = Date.parse('2026-11-29T00:00:00Z');
const plan = { ideaId: 'o1', title: 'Les Saisons', where: 'Cinéma du Parc', start: START, end: START + 112 * 60_000, status: 'confirmed', to: { name: 'Camille' } };
const trip = { walk: 25, bike: 9, transit: 16, bikes: 6, startName: 'Roy / St-André' };
const h = (ts, extra = {}) => ({ ts, temp: -4, feels: -8, rainProb: 10, snow: 0, ...extra });
const hours = [h(START - 3600_000), h(START - 1800_000), h(START), h(START + 3600_000), h(START + 2 * 3600_000, { snow: 0.6, temp: -2 })];

test('ce soir : le jour même, pas refusée, pas finie', () => {
    assert.equal(isTonight(plan, MORNING, TZ), true);
    assert.equal(isTonight({ ...plan, status: 'declined' }, MORNING, TZ), false);
    assert.equal(isTonight(plan, MORNING - 86_400_000, TZ), false);
    assert.equal(isTonight(plan, plan.end + 1, TZ), false);
    assert.equal(isTonight(null), false);
});

test('heure de prévision la plus proche, pas trop loin', () => {
    assert.equal(hourAt(hours, START + 10 * 60_000).ts, START);
    assert.equal(hourAt(hours, START + 10 * 3600_000), null);
});

test('moyen : le plus rapide, sans BIXI par mauvais temps, la marche si rien d’autre', () => {
    assert.deepEqual(pickMode(trip, h(0)), { mode: 'bike', minutes: 9 });
    assert.deepEqual(pickMode(trip, h(0, { rainProb: 80 })), { mode: 'transit', minutes: 16 });
    assert.deepEqual(pickMode({ walk: 50, bike: null, transit: null }), { mode: 'walk', minutes: 50 });
    assert.equal(pickMode(null), null);
});

test('météo en quelques mots', () => {
    assert.equal(weatherLine(h(0)), '−4°, sec');
    assert.equal(weatherLine(h(0, { snow: 0.5, temp: -1 })), '−1°, neige probable');
    assert.equal(weatherLine(h(0, { rainProb: 70, temp: 3 })), '3°, pluie probable (70 %)');
    assert.equal(weatherLine(null), null);
});

test('programme du soir : départ, retour, Cooper, météo aller et retour', () => {
    const t = tonightPlan({ plan, trip, hours, now: MORNING, tz: TZ });
    assert.equal(t.mode, 'bike');
    assert.equal(hm(t.leaveAt, TZ), '18 h 40');
    assert.equal(t.homeAt, plan.end + 9 * 60_000);
    assert.equal(t.weather.go, '−4°, sec');
    assert.equal(t.weather.back, '−2°, neige probable');
    assert.ok(t.cooper && t.cooper.awayMin > 120);
    assert.equal(cooperLine(t, TZ), 'Cooper sera seul environ 2 h 15 : promenade et repas avant 18 h 25.');
    // Sortie courte : pas de rappel pour Cooper
    assert.equal(tonightPlan({ plan: { ...plan, end: START + 60 * 60_000 }, trip, hours, now: MORNING, tz: TZ }).cooper, null);
    // Sans trajet connu : pas d'heure de départ
    assert.equal(tonightPlan({ plan, trip: null, hours, now: MORNING, tz: TZ }).leaveAt, null);
    assert.equal(tonightPlan({ plan, trip, hours, now: MORNING - 86_400_000, tz: TZ }), null);
});

test('rappel une seule fois, 20 min avant le départ', () => {
    const t = tonightPlan({ plan, trip, hours, now: MORNING, tz: TZ });
    assert.equal(shouldRemind(t, false, t.leaveAt - 30 * 60_000), false);
    assert.equal(shouldRemind(t, false, t.leaveAt - 19 * 60_000), true);
    assert.equal(shouldRemind(t, true, t.leaveAt - 19 * 60_000), false);
    assert.equal(shouldRemind(t, false, t.leaveAt + 10 * 60_000), false);
    assert.equal(shouldRemind({ ...t, leaveAt: null }, false, t.start), false);
});

test('ce que disent le briefing, Telegram, la voix et la carte', () => {
    const t = tonightPlan({ plan, trip, hours, now: MORNING, tz: TZ });
    assert.match(briefingLine(t, TZ), /^Ce soir à deux : Les Saisons à 19 h, départ 18 h 40 en BIXI\. Cooper sera seul/);
    assert.match(briefingLine({ ...t, status: 'pending' }, TZ), /en attente de la réponse de Camille/);
    const msg = reminderText(t, TZ);
    assert.match(msg, /Départ à 18 h 40 en BIXI \(9 min\), 6 vélos à Roy \/ St-André\./);
    assert.match(msg, /Météo : aller −4°, sec, retour −2°, neige probable\./);
    assert.match(speech(t, TZ), /^Ce soir, Les Saisons à 19 heures, Cinéma du Parc\. Il faut partir à 18 heures 40, en BIXI\./);
    assert.equal(tonightRelevance(t).relevance, 'now');
    assert.equal(tonightRelevance(t).until, t.homeAt);
    assert.equal(tonightRelevance(null).relevance, 'hidden');
});
