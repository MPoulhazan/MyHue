// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRange, sceneFor, untouched } from './entranceLight.js';
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

test('untouched : on n’éteint pas une lampe réglée à la main', () => {
    const scene = { ct: 2700, bright: 12 };
    assert.equal(untouched({ power: 'on', bright: '12', ct: '2700', color_mode: '2' }, scene), true);
    assert.equal(untouched({ power: 'on', bright: '60', ct: '2700', color_mode: '2' }, scene), false, 'luminosité changée');
    assert.equal(untouched({ power: 'on', bright: '12', ct: '2700', color_mode: '1' }, scene), false, 'passée en couleur');
    assert.equal(untouched({ power: 'on', bright: '12', ct: '5000', color_mode: '2' }, scene), false, 'teinte changée');
    assert.equal(untouched({ power: 'off', bright: '12', ct: '2700', color_mode: '2' }, scene), false, 'déjà éteinte');
});

test('parseAdvert : réponse SSDP Yeelight', () => {
    const txt = 'HTTP/1.1 200 OK\r\nLocation: yeelight://192.168.0.42:55443\r\nid: 0x000000000015243f\r\nmodel: color\r\npower: off\r\nname: \r\n';
    assert.deepEqual(parseAdvert(txt), { id: '0x000000000015243f', ip: '192.168.0.42', port: 55443, model: 'color', name: null, power: 'off' });
    assert.equal(parseAdvert('HTTP/1.1 200 OK\r\n'), null);
});
