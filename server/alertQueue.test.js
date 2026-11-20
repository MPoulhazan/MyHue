// Une seule couche d'alertes : priorité des pleins écrans et bannières (src/components/alerts/alertQueue.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, freshIntrusion, INTRUSION_MS } from '../src/components/alerts/alertQueue.ts';

const NOW = 1_800_000_000_000;
const base = { alarms: [], guard: null, guardSeenAt: 0, city: null, services: [], sensors: [], now: NOW };
const guardOn = { mode: 'alarm', events: [{ at: NOW - 60_000, sensor: 'Porte d’entrée', what: 'open' }] };
const cityDanger = { takeover: { id: 'ice' }, events: [{ id: 'ice', level: 'danger', title: 'Verglas', when: 'ce soir' }] };

test('rien à signaler : ni plein écran ni bannière', () => {
    assert.deepEqual(buildAlerts(base), { takeovers: [], banners: [] });
});

test('pleins écrans dans l’ordre : fumée, fuite, passage, ville', () => {
    const { takeovers } = buildAlerts({
        ...base,
        city: cityDanger,
        guard: guardOn,
        alarms: [{ did: 'l', type: 'water_leak', since: 1 }, { did: 's', type: 'smoke', since: 2 }],
    });
    assert.deepEqual(takeovers.map((t) => t.kind), ['smoke', 'leak', 'intrusion', 'city']);
});

test('deux détecteurs de fumée : un seul plein écran', () => {
    const { takeovers } = buildAlerts({ ...base, alarms: [{ did: 'a', type: 'smoke', since: 1 }, { did: 'b', type: 'smoke', since: 2 }] });
    assert.equal(takeovers.length, 1);
});

test('passage : seulement l’alarme active, moins d’une demi-heure, pas encore vu', () => {
    assert.ok(freshIntrusion(guardOn, 0, NOW));
    assert.equal(freshIntrusion({ ...guardOn, mode: null }, 0, NOW), null, 'alarme coupée');
    assert.equal(freshIntrusion(guardOn, NOW - 60_000, NOW), null, 'déjà vu');
    assert.equal(freshIntrusion(guardOn, 0, NOW + INTRUSION_MS), null, 'trop vieux');
    // Un nouveau passage après « J'ai vu » revient en plein écran
    const again = { ...guardOn, events: [...guardOn.events, { at: NOW - 10_000, sensor: 'Salon', what: 'motion' }] };
    assert.equal(freshIntrusion(again, NOW - 60_000, NOW).sensor, 'Salon');
});

test('bannières : service en panne, capteur en pause, danger en ville déjà vu', () => {
    const { takeovers, banners } = buildAlerts({
        ...base,
        services: [{ id: 'z2m', ok: false, label: 'Zigbee2MQTT' }, { id: 'hue', ok: true, label: 'Hue' }],
        sensors: [{ did: 's1', name: 'Escalier', pausedUntil: NOW + 1 }, { did: 's2', name: 'Salon', pausedUntil: null }],
        city: { takeover: null, events: [{ id: 'ice', level: 'danger', title: 'Verglas', when: 'ce soir' }, { id: 'bin', level: 'info', title: 'Collecte', when: 'demain' }] },
    });
    assert.equal(takeovers.length, 0);
    assert.deepEqual(banners.map((b) => b.id), ['service-z2m', 'paused-s1', 'city-ice']);
});

test('un danger en ville en plein écran n’est pas répété en bannière', () => {
    const { takeovers, banners } = buildAlerts({ ...base, city: cityDanger });
    assert.equal(takeovers[0].kind, 'city');
    assert.equal(banners.length, 0);
});
