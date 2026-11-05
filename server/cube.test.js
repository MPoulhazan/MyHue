// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGesture, briDelta, volumeDelta, pickScene, fold, fallLine } from './cubeGestures.js';

test('parseGesture : messages z2m du cube classique', () => {
    assert.deepEqual(parseGesture({ action: 'flip90', action_from_side: 0, action_to_side: 2, side: 2 }), { gesture: 'flip', face: 2 });
    assert.deepEqual(parseGesture({ action: 'flip180', action_to_side: 5 }), { gesture: 'flip', face: 5 });
    assert.deepEqual(parseGesture({ action: 'rotate_right', action_angle: 45.3 }), { gesture: 'rotate', angle: 45.3 });
    assert.deepEqual(parseGesture({ action: 'rotate_left', action_angle: -30 }), { gesture: 'rotate', angle: -30 });
    assert.deepEqual(parseGesture({ action: 'tap', action_side: 3, side: 3 }), { gesture: 'tap', face: 3 });
    assert.equal(parseGesture({ action: 'shake' }).gesture, 'shake');
    assert.equal(parseGesture({ action: '' }), null, 'action vide (z2m) ignorée');
    assert.equal(parseGesture({ battery: 90 }), null);
    assert.equal(parseGesture({ action: 'inconnue' }), null);
});

test('briDelta et volumeDelta : bornés, signés', () => {
    assert.equal(briDelta(90), 63);
    assert.equal(briDelta(-90), -63);
    assert.equal(briDelta(1000), 254);
    assert.equal(volumeDelta(90), 0.15);
    assert.equal(volumeDelta(-90), -0.15);
    assert.equal(volumeDelta(900), 0.5);
});

test('pickScene : sans accents, la pièce pilotée d’abord', () => {
    const scenes = [
        { id: 'a', name: 'Détente', group: '83', type: 'GroupScene' },
        { id: 'b', name: 'Détente', group: '1', type: 'GroupScene' },
        { id: 'c', name: 'Bougie 🕯️', group: '1', type: 'GroupScene' },
    ];
    assert.equal(pickScene(scenes, 'detente', '1').id, 'b');
    assert.equal(pickScene(scenes, 'Bougie', '1').id, 'c', 'nom avec émoji');
    assert.equal(pickScene(scenes, 'Détente', '82').id, 'a', 'autre pièce : première trouvée');
    assert.equal(pickScene(scenes, 'Nope', '1'), null);
    assert.equal(fold('  Cinéma '), 'cinema');
});

test('fallLine : toujours une phrase', () => {
    assert.ok(fallLine(0));
    assert.ok(fallLine(0.999));
});
