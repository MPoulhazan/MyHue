import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, allows, patch, view } from './builtinsLogic.js';

test('tout est actif par défaut, même un id inconnu', () => {
    assert.equal(allows({}, 'stove.boil', 'voice'), true);
    assert.equal(allows({}, 'nexiste.pas', 'voice'), true);
});

test('couper la voix de L’eau bout ne touche pas aux autres canaux', () => {
    const s = patch({}, 'cooper.late', { channel: 'voice', on: false });
    assert.deepEqual(s, { 'cooper.late': { off: ['voice'] } });
    assert.equal(allows(s, 'cooper.late', 'voice'), false);
    assert.equal(allows(s, 'cooper.late', 'lamp'), true);
});

test('rallumer le dernier canal coupé efface l’entrée', () => {
    const s = patch(patch({}, 'stove.boil', { channel: 'voice', on: false }), 'stove.boil', { channel: 'voice', on: true });
    assert.deepEqual(s, {});
});

test('tout couper puis supprimer puis restaurer', () => {
    let s = patch({}, 'cooper.late', { all: false });
    assert.deepEqual(s['cooper.late'].off, ['voice', 'lamp', 'telegram']);
    s = patch(s, 'cooper.late', { deleted: true });
    assert.equal(allows(s, 'cooper.late', 'telegram'), false);
    s = patch(s, 'cooper.late', { deleted: false });
    assert.deepEqual(s, {});
});

test('la sécurité ne se coupe pas', () => {
    assert.throws(() => patch({}, 'alarm', { all: false }), /sécurité/);
    assert.equal(allows({ alarm: { deleted: true } }, 'alarm', 'voice'), true);
});

test('canal absent de l’automatisme refusé', () => {
    assert.throws(() => patch({}, 'stove.boil', { channel: 'telegram', on: false }), /Canal/);
});

test('vue : passages comptés une fois par run sur 30 jours', () => {
    const now = Date.UTC(2026, 10, 24);
    const e = (ts, run, channel) => ({ ts, data: { builtin: 'cooper.late', run, channel } });
    const rows = view({}, [e(now - 1000, 'a', 'voice'), e(now - 2000, 'a', 'lamp'), e(now - 3600_000, 'b', 'voice'), e(now - 40 * 86400_000, 'c', 'voice')], now);
    const r = rows.find((x) => x.id === 'cooper.late');
    assert.equal(r.monthCount, 2);
    assert.equal(r.lastAt, now - 1000);
    assert.equal(rows.length, REGISTRY.length);
});

test('ids uniques et canaux connus', () => {
    assert.equal(new Set(REGISTRY.map((d) => d.id)).size, REGISTRY.length);
    for (const d of REGISTRY) for (const c of Object.keys(d.channels)) assert.ok(['voice', 'lamp', 'telegram'].includes(c), d.id);
});
