// Au démarrage, un home-widgets.json d'avant la fusion « Déplacements » est repris et réécrit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'myhue-widgets-old-'));
writeFileSync(join(dir, 'home-widgets.json'), JSON.stringify({ pins: { bixi: 'always', metro: 'auto', communauto: 'hidden', sky: 'hidden' } }));
process.env.MYHUE_DATA_DIR = dir;
const widgets = await import('./homeWidgets.js');

test('les anciens réglages passent sur Déplacements, le fichier est réécrit', () => {
    const { pins } = widgets.getPins();
    assert.equal(pins.moves, 'always');
    assert.equal(pins.sky, 'hidden');
    assert.equal('bixi' in pins, false);
    const saved = JSON.parse(readFileSync(join(dir, 'home-widgets.json'), 'utf8')).pins;
    assert.equal(saved.moves, 'always');
    assert.equal('communauto' in saved, false);
});
