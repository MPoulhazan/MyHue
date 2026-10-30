/**
 * Bus d'événements maison : traduit les changements Zigbee bruts en événements
 * de capteurs nommés (registre), consommés par le journal, les automatismes et le compagnon.
 *
 * Événement 'sensor' : { sensor: { did, name, type }, prop, value, prev, ts }
 *   prop = 'isOpen' pour les portes (value true = ouverte), sinon la propriété z2m.
 */
import { EventEmitter } from 'events';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

zigbeeService.emitter.on('change', ({ ieee, key, value, prev }) => {
    const entry = ieee && sensorRegistry.find(ieee);
    if (!entry) return; // appareil pas encore nommé
    const sensor = { did: entry.ieee, name: entry.name, type: entry.type };
    const ts = Date.now();

    if (key === 'contact') {
        const isOpen = !value;
        bus.emit('sensor', { sensor, prop: 'isOpen', value: isOpen, prev: !prev, ts });
        journal.log({
            kind: 'door',
            title: `${entry.name} : ${isOpen ? 'ouverte' : 'fermée'}`,
            data: { did: entry.ieee, isOpen },
        });
        return;
    }
    // Fuite : réaction immédiate des automatismes, sans attendre le passage des 30 s
    if (key === 'water_leak') {
        bus.emit('sensor', { sensor, prop: 'leak', value: Boolean(value), prev: Boolean(prev), ts });
        return;
    }
    if (['temperature', 'humidity', 'pressure', 'battery', 'occupancy'].includes(key)) {
        bus.emit('sensor', { sensor, prop: key, value, prev, ts });
    }
});
