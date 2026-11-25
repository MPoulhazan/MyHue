import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArp, isPrivateMac, looksLikePhone, isPhone, phonesSayHome, RECENT_MS } from './wifiPresenceLogic.js';

test('parses complete ARP entries only', () => {
    const arp = `IP address       HW type     Flags       HW address            Mask     Device
192.168.0.12     0x1         0x2         66:b2:bf:91:cd:4d     *        wlan0
192.168.0.50     0x1         0x0         00:00:00:00:00:00     *        wlan0
192.168.0.14     0x1         0x2         72:6A:AB:60:37:E6     *        wlan0`;
    assert.deepEqual(parseArp(arp), [
        { ip: '192.168.0.12', mac: '66:b2:bf:91:cd:4d' },
        { ip: '192.168.0.14', mac: '72:6a:ab:60:37:e6' },
    ]);
});

test('private MACs and phone-like names', () => {
    assert.equal(isPrivateMac('66:b2:bf:91:cd:4d'), true);
    assert.equal(isPrivateMac('38:86:f7:08:58:a3'), false);
    assert.equal(looksLikePhone('Pixel-7.ht.home'), true);
    assert.equal(looksLikePhone('Pixel-9.ht.home'), true);
    assert.equal(looksLikePhone('iPhone-de-quelqu-un.ht.home'), true);
    assert.equal(looksLikePhone('Galaxy-Tab-A9-5G.ht.home'), false, 'the wall tablet is not a phone');
    assert.equal(looksLikePhone('LAPTOP-7624GK34.ht.home'), false);
    assert.equal(looksLikePhone(null), false);
});

test('explicit choice wins over the guess', () => {
    const d = { mac: 'aa', name: 'Pixel-7.ht.home' };
    assert.equal(isPhone(d, {}), true);
    assert.equal(isPhone(d, { aa: false }), false);
    assert.equal(isPhone({ mac: 'bb', name: 'unknown' }, { bb: true }), true);
});

test('at least one phone seen in the last 15 min means someone is home', () => {
    const now = 10 * RECENT_MS;
    const pixel7 = { mac: 'a', name: 'Pixel-7', lastSeen: now - 20 * 60_000 };
    const pixel9 = { mac: 'b', name: 'Pixel-9', lastSeen: now - 3 * 60_000 };
    assert.equal(phonesSayHome([pixel7, pixel9], {}, now), true, 'one phone still here');
    assert.equal(phonesSayHome([pixel7, { ...pixel9, lastSeen: now - 16 * 60_000 }], {}, now), false, 'both gone');
    assert.equal(phonesSayHome([{ mac: 'c', name: 'LAPTOP', lastSeen: now }], {}, now), null, 'no phone known');
});
