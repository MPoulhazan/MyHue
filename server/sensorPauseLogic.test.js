import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSensorPauseCommand, parseDuration, findTarget } from './sensorPauseLogic.js';

const SENSORS = [
    { ieee: 'a', name: 'Porte d’entrée', type: 'door', room: 'Entrée' },
    { ieee: 'b', name: 'Mouvement entrée', type: 'motion', room: 'Entrée' },
    { ieee: 'c', name: 'Salon', type: 'temperature_humidity', room: 'Salon' },
];

test('met l’escalier en pause pour la soirée', () => {
    assert.deepEqual(parseSensorPauseCommand('Mets l’escalier en pause pour la soirée', SENSORS), { action: 'pause', sensor: SENSORS[1], duration: 'morning' });
});

test('coupe le capteur de mouvement 1 h', () => {
    const r = parseSensorPauseCommand('coupe le capteur de mouvement pendant une heure', SENSORS);
    assert.equal(r.action, 'pause');
    assert.equal(r.sensor.ieee, 'b');
    assert.equal(r.duration, '1h');
});

test('réactive l’escalier', () => {
    assert.deepEqual(parseSensorPauseCommand('Réactive l’escalier', SENSORS), { action: 'resume', sensor: SENSORS[1] });
});

test('la musique et les lumières ne sont pas pour nous', () => {
    assert.equal(parseSensorPauseCommand('mets la musique en pause', SENSORS), null);
    assert.equal(parseSensorPauseCommand('coupe la lumière de l’entrée', SENSORS), null);
    assert.equal(parseSensorPauseCommand('réactive le mode alarme', SENSORS), null);
});

test('capteur introuvable', () => {
    assert.deepEqual(parseSensorPauseCommand('mets le capteur du garage en pause', [SENSORS[2]]), { action: 'unknown' });
});

test('durées', () => {
    assert.equal(parseDuration('pour 30 minutes'), 30);
    assert.equal(parseDuration('pendant 2 heures'), 120);
    assert.equal(parseDuration('jusqu’à nouvel ordre'), 'forever');
    assert.equal(parseDuration('pour la nuit'), 'morning');
});

test('le nom dit l’emporte, mouvement préféré à la porte', () => {
    assert.equal(findTarget('pause l’entrée', SENSORS).ieee, 'b');
});
