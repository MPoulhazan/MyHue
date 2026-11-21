import { test } from 'node:test';
import assert from 'node:assert/strict';
import { veilleeAvailable, fireLightPlan, flameStep, emberState, cozyTarget, veilleeRelevance, veilleeCommand } from './veilleeLogic.js';
import { christmasSeason } from './seasonLogic.js';

const TZ = 'America/Toronto';
const at = (d) => christmasSeason(Date.parse(`${d}T20:00:00-05:00`), TZ);

test('veillée : décembre seulement, pas la dernière semaine de novembre', () => {
    assert.equal(veilleeAvailable(at('2026-11-21')), false);
    assert.equal(veilleeAvailable(at('2026-11-27')), false);
    assert.equal(veilleeAvailable(at('2026-12-01')), true);
    assert.equal(veilleeAvailable(at('2026-12-25')), true);
    assert.equal(veilleeAvailable(at('2026-12-31')), true);
    assert.equal(veilleeAvailable(at('2027-01-02')), false);
});

test('fireLightPlan : plafonnier éteint, Play et ruban en flammes, le reste en braises, la prise ne bouge pas', () => {
    const plan = fireLightPlan([
        { id: '1', name: 'Bibliothèque', color: true },
        { id: '5', name: 'Plante', color: true },
        { id: '8', name: 'Hue play 1', color: true },
        { id: '12', name: 'Plafond', color: true },
        { id: '13', name: 'Hue lightstrip Canapé', color: true },
        { id: '14', name: 'Étagère', color: false },
    ]);
    assert.deepEqual(plan.off, ['12']);
    assert.deepEqual(plan.flame, ['8', '13']);
    assert.deepEqual(plan.ember, ['1', '5']);
});

test('fireLightPlan : sans ruban ni Play, une lampe sur deux fait les flammes', () => {
    const plan = fireLightPlan([{ id: 'a', name: 'A', color: true }, { id: 'b', name: 'B', color: true }, { id: 'c', name: 'C', color: true }]);
    assert.deepEqual(plan.flame, ['a', 'c']);
    assert.deepEqual(plan.ember, ['b']);
});

test('flammes et braises : couleurs chaudes, lumière basse', () => {
    for (const r of [0, 0.5, 0.999]) {
        const s = flameStep(() => r);
        assert.ok(s.xy[0] >= 0.55, 'orange ou rouge');
        assert.ok(s.bri >= 70 && s.bri <= 160);
    }
    assert.ok(emberState().bri < 100);
});

test('cozyTarget : un degré de plus, 25 au plus', () => {
    assert.equal(cozyTarget(21), 22);
    assert.equal(cozyTarget(24.5), 25);
    assert.equal(cozyTarget(null), null);
});

test('veilleeRelevance : en cours = maintenant, en décembre = calme, sinon cachée', () => {
    assert.equal(veilleeRelevance({ active: true, endsAt: 5 }, at('2026-12-12')).relevance, 'now');
    assert.equal(veilleeRelevance({ active: true, endsAt: 5 }, at('2026-12-12')).until, 5);
    assert.equal(veilleeRelevance({ active: false }, at('2026-12-12')).relevance, 'calm');
    assert.equal(veilleeRelevance({ active: false }, at('2026-11-27')).relevance, 'hidden');
    assert.equal(veilleeRelevance(null, null).relevance, 'hidden');
});

test('veilleeCommand : lancer ou arrêter, rien sans le mot veillée', () => {
    assert.equal(veilleeCommand('Lance la veillée'), 'start');
    assert.equal(veilleeCommand('mode veillée'), 'start');
    assert.equal(veilleeCommand('Fin de la veillée'), 'stop');
    assert.equal(veilleeCommand('arrête la veillée'), 'stop');
    assert.equal(veilleeCommand('éteins la veillée'), 'stop');
    assert.equal(veilleeCommand('lance la musique'), null);
});
