// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Données dans un dossier jetable, pas dans server/data
process.env.MYHUE_DATA_DIR = mkdtempSync(join(tmpdir(), 'myhue-learned-'));
const learned = await import('./learnedCommands.js');

const scene = [{ type: 'set_group_state', id: '1', state: { scene: 'abc' } }];

test('une phrase apprise se retrouve malgré politesses et accents', () => {
    assert.equal(learned.learn('Jarvis, mets l’ambiance soirée stp', scene, 'C’est fait : scène.'), true);
    assert.deepEqual(learned.lookup('mets l ambiance soiree'), { actions: scene, message: 'C’est fait : scène.' });
    assert.equal(learned.lookup('mets l ambiance cinema'), null);
});

test('rien d’appris pour le relatif, le différé ou la création de règle', () => {
    const vol = [{ type: 'cast_volume', deviceName: 'Salon', level: 0.6 }];
    assert.equal(learned.isLearnable('monte un peu le son', vol), false);
    assert.equal(learned.isLearnable('mets la scène soirée dans 10 minutes', scene), false);
    assert.equal(learned.isLearnable('préviens moi si la porte s’ouvre', [{ type: 'create_rule' }]), false);
    assert.equal(learned.isLearnable('j’ai éteint la clim', [{ type: 'set_heating', power: false, alreadyDone: true }]), false);
});

test('oublier une commande', () => {
    learned.learn('mode cinéma', scene, 'ok');
    assert.equal(learned.forget('Mode cinéma'), true);
    assert.equal(learned.lookup('mode cinema'), null);
});
