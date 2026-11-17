// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRange, sceneFor, shouldSweep } from './entranceLight.js';
import { parseAdvert } from './yeelight.js';

const ts = (hhmm) => Date.parse(`2026-11-16T${hhmm}:00-05:00`);
const cfg = { nightFrom: '22:30', nightTo: '06:30', day: { ct: 4000, bright: 100 }, night: { ct: 2700, bright: 12 } };

test('inRange : plage qui passe minuit', () => {
    assert.equal(inRange(23 * 60, '22:30', '06:30'), true);
    assert.equal(inRange(3 * 60, '22:30', '06:30'), true);
    assert.equal(inRange(6 * 60 + 30, '22:30', '06:30'), false);
    assert.equal(inRange(12 * 60, '22:30', '06:30'), false);
    assert.equal(inRange(12 * 60, '08:00', '18:00'), true);
});

test('sceneFor : douce la nuit, franche le jour', () => {
    assert.equal(sceneFor(ts('23:15'), cfg).mode, 'night');
    assert.equal(sceneFor(ts('05:50'), cfg).bright, 12);
    assert.equal(sceneFor(ts('18:00'), cfg).mode, 'day');
    assert.equal(sceneFor(ts('07:00'), cfg).ct, 4000);
});

test('shouldSweep : on éteint une lampe allumée sans passage récent', () => {
    const now = 1_000_000;
    assert.equal(shouldSweep(now, null, 120, null), true, 'aucun passage depuis le démarrage');
    assert.equal(shouldSweep(now, now - 121_000, 120, null), true, 'dernier passage il y a plus de 2 min');
    assert.equal(shouldSweep(now, now - 30_000, 120, null), false, 'quelqu’un vient de passer');
    assert.equal(shouldSweep(now, now - 500_000, 120, { scene: {} }), false, 'extinction déjà programmée');
});

test('parseAdvert : réponse SSDP Yeelight', () => {
    const txt = 'HTTP/1.1 200 OK\r\nLocation: yeelight://192.168.0.42:55443\r\nid: 0x000000000015243f\r\nmodel: color\r\npower: off\r\nname: \r\n';
    assert.deepEqual(parseAdvert(txt), { id: '0x000000000015243f', ip: '192.168.0.42', port: 55443, model: 'color', name: null, power: 'off' });
    assert.equal(parseAdvert('HTTP/1.1 200 OK\r\n'), null);
});
