import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, alertText } from './skyAlerts.js';
import { isSkyQuestion, skySpeech, skyBriefingLine } from './astro.js';

const HOUR = 3600_000;
const now = Date.UTC(2026, 10, 3, 3); // 22 h à Montréal
const alert = { level: 'alert', label: 'x', maxTonight: 7, window: { from: now - HOUR, to: now + 3 * HOUR } };
const base = { night: 1, notifiedNight: null, pulsedNight: null, auroraAlerts: true, auroraLamp: true, lampEnabled: true, anyoneHome: true, localHour: 22 };

test('decide : message une fois par nuit, lampe pendant la fenêtre en soirée', () => {
    assert.deepEqual(decide(alert, base, now), { notify: true, pulse: true });
    assert.deepEqual(decide(alert, { ...base, notifiedNight: 1, pulsedNight: 1 }, now), { notify: false, pulse: false });
    assert.equal(decide(alert, { ...base, localHour: 2 }, now).pulse, false);
    assert.equal(decide(alert, { ...base, anyoneHome: false }, now).pulse, false);
    assert.equal(decide(alert, { ...base, lampEnabled: false }, now).pulse, false);
    assert.equal(decide(alert, { ...base, auroraAlerts: false }, now).notify, false);
    assert.equal(decide({ ...alert, window: { from: now + HOUR, to: now + 2 * HOUR } }, base, now).pulse, false);
    assert.deepEqual(decide({ level: 'cloudy' }, base, now), { notify: false, pulse: false });
    assert.deepEqual(decide(null, base, now), { notify: false, pulse: false });
});

test('alertText donne la fenêtre en heure locale', () => {
    const t = alertText({ maxTonight: 6.7, window: { from: Date.UTC(2026, 10, 3, 3), to: Date.UTC(2026, 10, 3, 7) } }, -5 * 3600);
    assert.match(t, /entre 22 h et 2 h/);
    assert.match(t, /Kp 6,7/);
});

test('isSkyQuestion : questions oui, commandes et faux amis non', () => {
    assert.equal(isSkyQuestion('Qu’est-ce qu’il y a dans le ciel ce soir ?'), true);
    assert.equal(isSkyQuestion('est-ce qu’on voit des aurores'), true);
    assert.equal(isSkyQuestion('quand sont les prochaines étoiles filantes'), true);
    assert.equal(isSkyQuestion('allume la lampe lune'), false);
    assert.equal(isSkyQuestion('mets mes lunettes'), false);
    assert.equal(isSkyQuestion('éteins le salon'), false);
});

const sky = (over = {}) => ({
    offsetSec: -5 * 3600,
    moon: { name: 'Dernier croissant', fraction: 0.36, up: false, rise: Date.UTC(2026, 10, 3, 5), set: Date.UTC(2026, 10, 3, 19), nextFull: { name: 'Lune du castor', ts: now + 20 * 24 * HOUR } },
    night: { window: { from: Date.UTC(2026, 10, 3, 2), to: Date.UTC(2026, 10, 3, 5) } },
    planets: [{ name: 'Jupiter', dir: 'au sud' }],
    aurora: { level: 'calm', maxTonight: 2 },
    events: [{ type: 'shower', title: 'Léonides', ts: now + 14 * 24 * HOUR, label: 'Excellent, sans lune', level: 'excellent' }],
    ...over,
});

test('skySpeech dit la lune, la fenêtre, les planètes et le prochain rendez-vous', () => {
    const t = skySpeech(sky(), now);
    assert.match(t, /La lune est en dernier croissant, éclairée à 36 pour cent, elle se lève vers minuit/);
    assert.match(t, /de 21 heures à minuit/);
    assert.match(t, /Jupiter au sud/);
    assert.match(t, /Léonides dans 14 jours/);
    assert.match(skySpeech(sky({ night: { window: null } }), now), /trop couvert/);
});

test('skyBriefingLine seulement les jours notables', () => {
    assert.equal(skyBriefingLine(sky(), now), null);
    assert.match(skyBriefingLine(sky({ aurora: { level: 'alert', maxTonight: 7, window: alert.window } }), now), /aurores boréales possibles/);
    assert.match(skyBriefingLine(sky({ events: [{ type: 'shower', title: 'Géminides', ts: now + 2 * HOUR, level: 'excellent' }] }), now), /pic des Géminides/);
    assert.match(skyBriefingLine(sky({ events: [{ type: 'fullmoon', title: 'Lune du castor', ts: now + 5 * HOUR }] }), now), /Pleine lune ce soir, la lune du castor/);
});
