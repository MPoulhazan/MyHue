// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimContext, confirmationFor } from './groqAgent.js';

test('slimContext : groupes vides, scènes orphelines et champs nuls retirés', () => {
    const ctx = slimContext({
        hue: {
            lights: [{ id: '1', name: 'Bar', on: false, bri: 26, reachable: true }],
            groups: [
                { id: '82', name: 'Cuisine', type: 'Room', lights: ['15'], any_on: false },
                { id: '85', name: 'Kitchen', type: 'Zone', lights: [], any_on: false },
            ],
        },
        scenes: [
            { id: 'a', name: 'Relax', group: '82' },
            { id: 'b', name: 'Relax', group: '81' },
            { id: 'c', name: 'Bright', group: '0' },
        ],
        cast: [{ name: 'Salon', host: '192.168.0.117', port: 8009 }],
        sensors: [{ did: 'x', name: 'Porte', type: 'door', isOnline: false, mac: 'x', props: { isOpen: null, battery: 80 } }],
        heating: { power: false },
    });
    assert.deepEqual(ctx.lights, [{ id: '1', name: 'Bar', on: false }]);
    assert.deepEqual(ctx.groups.map((g) => g.id), ['82']);
    assert.deepEqual(ctx.scenes, [['a', 'Relax', '82'], ['c', 'Bright', '0']]);
    assert.deepEqual(ctx.cast, ['Salon']);
    assert.deepEqual(ctx.sensors, [{ did: 'x', name: 'Porte', type: 'door', offline: true, battery: 80 }]);
    assert.deepEqual(ctx.heating, { power: false });
});

test('confirmationFor : résumé ou premier échec', () => {
    assert.equal(confirmationFor(['control_lights', 'control_lights', 'activate_scene'], [{ status: 'ok' }]), 'C\'est fait : lumières, scène.');
    assert.equal(confirmationFor(['activate_scene'], [{ status: 'error', error: 'Scène non trouvée: x' }]), 'Échec : Scène non trouvée: x');
});
