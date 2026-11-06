// Réglages Auto / Toujours / Masqué des widgets de l'accueil (server/homeWidgets.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Données dans un dossier jetable, pas dans server/data
const dir = mkdtempSync(join(tmpdir(), 'myhue-widgets-'));
process.env.MYHUE_DATA_DIR = dir;
const widgets = await import('./homeWidgets.js');

test('par défaut : Cooper sur Toujours, les autres sur Auto', () => {
    const { pins } = widgets.getPins();
    assert.equal(pins.cooper, 'always');
    assert.equal(pins.city, 'auto');
    assert.equal(Object.keys(pins).length, widgets.WIDGET_IDS.length);
});

test('un réglage changé est gardé sur disque', () => {
    const { pins } = widgets.updatePins({ pins: { sky: 'hidden', journal: 'always' } });
    assert.equal(pins.sky, 'hidden');
    assert.equal(pins.journal, 'always');
    assert.equal(pins.cooper, 'always');
    const saved = JSON.parse(readFileSync(join(dir, 'home-widgets.json'), 'utf8'));
    assert.equal(saved.pins.sky, 'hidden');
});

test('widget ou valeur inconnus refusés, rien ne change', () => {
    assert.throws(() => widgets.updatePins({ pins: { tv: 'auto' } }), /widget inconnu/);
    assert.throws(() => widgets.updatePins({ pins: { sky: 'parfois' } }), /réglage inconnu/);
    assert.throws(() => widgets.updatePins(null), /réglages attendus/);
    assert.equal(widgets.getPins().pins.sky, 'hidden');
});
