/**
 * Registre manuel des capteurs Zigbee.
 * Chaque entrée lie une adresse IEEE à un nom et un type.
 * Le fichier `data/sensors.json` est la source de vérité.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, 'data', 'sensors.json');

export const ICON_MAP = {
    temperature_humidity: '🌡️',
    door: '🚪',
    motion: '👁️',
    smoke: '💨',
    water_leak: '💧',
    vibration: '📳',
    button: '🔘',
    other: '📡',
};

export const TYPE_LABELS = {
    temperature_humidity: 'Température / Humidité',
    door: 'Porte / Fenêtre',
    motion: 'Mouvement',
    smoke: 'Fumée',
    water_leak: 'Inondation',
    vibration: 'Vibration',
    button: 'Bouton',
    other: 'Autre',
};

const load = () => {
    if (!existsSync(REGISTRY_PATH)) return [];
    try {
        return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    } catch {
        return [];
    }
};

const save = (registry) => {
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
};

/** Retourne tous les capteurs enregistrés. */
export const getAll = () => load();

/** Ajoute ou met à jour un capteur dans le registre. */
export const upsert = ({ ieee, name, type }) => {
    const registry = load();
    const idx = registry.findIndex((e) => e.ieee === ieee);
    const entry = { ieee, name, type, icon: ICON_MAP[type] || '📡' };
    if (idx >= 0) {
        registry[idx] = entry;
    } else {
        registry.push(entry);
    }
    save(registry);
    return entry;
};

/** Supprime un capteur du registre. Retourne false si introuvable. */
export const remove = (ieee) => {
    const registry = load();
    const idx = registry.findIndex((e) => e.ieee === ieee);
    if (idx < 0) return false;
    registry.splice(idx, 1);
    save(registry);
    return true;
};

/** Cherche une entrée par IEEE. */
export const find = (ieee) => load().find((e) => e.ieee === ieee) || null;
