// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    encodeState,
    decodeState,
    buildPacket,
    broadlinkToPulses,
    pulsesToFrames,
    toHex,
    BROADLINK_TICK_US,
} from './mitsubishiIr.js';

// État de référence d'IRremoteESP8266 (stateReset) : marche, chauffage, 22°, ventilation silencieuse, 17 h 10
const REFERENCE = '23 cb 26 01 00 20 08 06 30 45 67 00 00 00 00 00 00 1f';

test('encode la trame de référence IRremoteESP8266', () => {
    const bytes = encodeState(
        { power: true, mode: 'heat', temperature: 22, fanSpeed: 'quiet', vaneVertical: 'auto' },
        17 * 60 + 10,
    );
    assert.equal(toHex(bytes), REFERENCE);
});

test('arrêt, clim et ventilation auto', () => {
    const off = encodeState({ power: false, mode: 'heat', temperature: 21 });
    assert.equal(off[5], 0x00);
    const cool = encodeState({ power: true, mode: 'cool', temperature: 24, fanSpeed: 'auto' });
    assert.equal(cool[6], 0x18);
    assert.equal(cool[8], 0x36);
    assert.equal(cool[7], 8);
    assert.equal(cool[9], 0xc0); // ventilation auto + bit volet
});

test('décode ce qui a été encodé', () => {
    const state = { power: true, mode: 'cool', temperature: 25, fanSpeed: 'low', vaneVertical: 'swing' };
    const decoded = decodeState(encodeState(state, 600));
    assert.deepEqual(
        { ...decoded, clockMinutes: undefined },
        { ...state, clockMinutes: undefined, checksumOk: true },
    );
});

test('paquet Broadlink : unité de 32,84 µs et aller-retour sans perte', () => {
    assert.ok(Math.abs(BROADLINK_TICK_US - 32.84) < 0.01);
    const bytes = encodeState({ power: true, mode: 'heat', temperature: 21 }, 0);
    const packet = buildPacket({ power: true, mode: 'heat', temperature: 21 }, 0);
    assert.equal(packet[0], 0x26);
    assert.equal(packet.length - 4, packet[2] | (packet[3] << 8));
    // L'en-tête de 3400 µs doit faire ~104 unités, et non 13 comme avec l'ancien code
    assert.equal(packet[4], Math.round(3400 / BROADLINK_TICK_US));
    const frames = pulsesToFrames(broadlinkToPulses(packet));
    assert.equal(frames.length, 2);
    assert.equal(toHex(frames[0]), toHex(bytes));
    assert.equal(toHex(frames[1]), toHex(bytes));
});
