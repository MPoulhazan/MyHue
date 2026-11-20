// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodes, screenState, blockButton, tipOk, cancelButton, confirmCancelButton, isGreen, pixelAt, vehicleLink, weekCount } from './communautoAppLogic.js';

// Écrans relevés sur la tablette (Tab A9+, appli Communauto 2.12.1, 2026-11-20), réduits aux nœuds utiles
const node = (desc, bounds, text = '') => `<node index="0" text="${text}" resource-id="" class="android.view.View" package="com.communauto.reservauto" content-desc="${desc}" clickable="false" bounds="${bounds}" />`;
const xml = (...nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>`;
const SCREEN = { w: 1200, h: 1920 };

const GONE = xml(node('Google Map', '[0,0][1200,1848]'), node('FLEX&#10;Sorry, this vehicle is not available anymore.', '[0,1593][1200,1848]'));
const SHEET = xml(node('Map Marker', '[10,10][50,50]'), node('Vehicle location', '[24,1637][222,1671]'), node('Vehicle description', '[24,1734][1200,1769]'));
const BLOCKED = xml(
    node('Free Floating Pass&#10;Switch on to activate for your trip', '[0,0][1200,1920]'),
    node('The vehicle is waiting&#10;29:49&#10;Vehicle location&#10;FLEX Pass&#10;6/15', '[0,1293][1200,1637]'),
    node('OK', '[1080,1469][1164,1517]'),
);
const CONFIRM = xml(node('Dismiss', '[0,0][1200,1920]'), node('Cancel reservation&#10;Are you sure you want to cancel the block on this vehicle?', '[0,1526][1200,1848]'));
const MAP = xml(node('Google Map', '[0,0][1200,1848]'), node('Map Marker', '[10,10][50,50]'));

test('parseNodes : textes décodés, marqueurs de carte ignorés', () => {
    const nodes = parseNodes(BLOCKED);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].label.split('\n')[0], 'The vehicle is waiting');
    assert.deepEqual(parseNodes(SHEET).map((n) => n.label), ['Vehicle location', 'Vehicle description']);
});

test('screenState : les cinq écrans de l’appli', () => {
    assert.equal(screenState(parseNodes(GONE)), 'gone');
    assert.equal(screenState(parseNodes(SHEET)), 'sheet');
    assert.equal(screenState(parseNodes(BLOCKED)), 'blocked');
    assert.equal(screenState(parseNodes(CONFIRM)), 'confirm');
    assert.equal(screenState(parseNodes(MAP)), 'other');
    assert.equal(screenState([]), 'other');
});

test('positions : celles tapées à la main pendant le vrai test', () => {
    assert.deepEqual(blockButton(SCREEN), { x: 600, y: 1776 });
    assert.deepEqual(tipOk(parseNodes(BLOCKED)), { x: 1122, y: 1493 });
    assert.equal(tipOk(parseNodes(SHEET)), null);
    assert.deepEqual(cancelButton(parseNodes(BLOCKED), SCREEN), { x: 300, y: 1679 });
    assert.equal(cancelButton(parseNodes(SHEET), SCREEN), null);
    assert.deepEqual(confirmCancelButton(parseNodes(CONFIRM), SCREEN), { x: 600, y: 1715 });
});

test('isGreen / pixelAt : le vert du bouton, pas le vert lime de MyHue ni le gris', () => {
    assert.equal(isGreen({ r: 132, g: 189, b: 0 }), true);
    assert.equal(isGreen({ r: 200, g: 245, b: 96 }), false);
    assert.equal(isGreen({ r: 229, g: 230, b: 232 }), false);
    const raw = Buffer.alloc(16 + 4 * 3 * 2);
    raw.writeUInt32LE(3, 0); raw.writeUInt32LE(2, 4); raw.writeUInt32LE(1, 8);
    raw.set([132, 189, 0, 255], 16 + (1 * 3 + 2) * 4);
    assert.deepEqual(pixelAt(raw, 2, 1), { r: 132, g: 189, b: 0 });
});

test('vehicleLink et weekCount', () => {
    assert.equal(vehicleLink(14296), 'https://client.reservauto.net/quebec/dashboard/map/free-floating-info/14296');
    const now = Date.now();
    assert.equal(weekCount([now - 8 * 86400_000, now - 6 * 86400_000, now - 1000], now), 2);
    assert.equal(weekCount(undefined, now), 0);
});
