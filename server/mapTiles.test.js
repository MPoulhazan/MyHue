// Tuiles du plan : seules les coordonnées de la grille passent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validTile } from './mapTiles.js';

test('validTile accepte une tuile du quartier', () => {
    assert.equal(validTile(16, 19374, 23439), true);
});

test('validTile refuse ce qui sort de la grille ou n’est pas un entier', () => {
    assert.equal(validTile(20, 0, 0), false);
    assert.equal(validTile(2, 4, 0), false);
    assert.equal(validTile(2, -1, 0), false);
    assert.equal(validTile(2, 1.5, 0), false);
    assert.equal(validTile(NaN, 0, 0), false);
});
