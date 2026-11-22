import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hueRows, planLabel, GOOGLE_ROUTINES } from './externalAutomationsLogic.js';

test('Hue behaviors become readable rows', () => {
    const scripts = [{ id: 's1', metadata: { name: 'Leaving home' } }, { id: 's2', metadata: { name: 'Hue Accessories' } }];
    const rows = hueRows(
        [
            { script_id: 's1', enabled: true, metadata: { name: 'Leaving home' } },
            { script_id: 's2', enabled: true, metadata: { name: 'Hue dimmer switch salon' } },
            { script_id: 'zz', enabled: false, metadata: {} },
        ],
        scripts,
    );
    assert.equal(rows[0].plan, 'replaced');
    assert.equal(rows[0].by, 'Je pars');
    assert.equal(rows[1].name, 'Hue dimmer switch salon');
    assert.equal(rows[1].plan, 'keep');
    assert.equal(rows[2].name, 'Routine');
    assert.equal(rows[2].on, false);
});

test('plan labels', () => {
    assert.equal(planLabel({ plan: 'remove' }), 'À retirer');
    assert.equal(planLabel({ plan: 'replaced', by: 'Je pars' }), 'Reprise par MyHue (Je pars)');
    assert.equal(planLabel({ plan: 'keep' }), 'Gardée');
});

test('Google snapshot covers the 25 routines seen on the tablet, and flags the 08:30 one', () => {
    assert.equal(GOOGLE_ROUTINES.length, 25);
    const chill = GOOGLE_ROUTINES.find((r) => r.name === 'Mode chill');
    assert.equal(chill.auto, true);
    assert.equal(chill.plan, 'remove');
});
