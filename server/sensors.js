/**
 * Vue unifiée des capteurs : registre manuel (sensors.json) + état Zigbee en direct.
 */
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';

export const getSensors = async () => {
    const devices = zigbeeService.getDevices();
    const registry = sensorRegistry.getAll();
    return registry.map((entry) => {
        const device = devices.find((d) => d.ieeeAddr === entry.ieee) || null;
        const state = device?.state || {};
        return {
            did: entry.ieee,
            name: entry.name,
            model: device?.model || 'Zigbee',
            type: entry.type,
            icon: entry.icon || '📡',
            isOnline: device ? device.available !== false : false,
            mac: entry.ieee,
            zigbeeName: device?.friendlyName || entry.ieee,
            props: {
                temperature: state.temperature ?? null,
                humidity: state.humidity ?? null,
                pressure: state.pressure ?? null,
                battery: state.battery ?? null,
                isOpen: 'contact' in state ? !state.contact : null,
                lastMotion: state.occupancy ? new Date().toISOString() : null,
                lastOpen: null,
            },
            lastUpdated: device?.lastSeen ? new Date(device.lastSeen).toISOString() : null,
            source: 'zigbee',
        };
    });
};
