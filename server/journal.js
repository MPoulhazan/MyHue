/**
 * Journal de la maison : une seule timeline pour les portes, la clim,
 * les automatismes, le compagnon et l'agent. Persisté dans data/journal.json.
 */
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { dataFile } from './dataDir.js';

const FILE = dataFile('journal.json');
const MAX_ENTRIES = 2000;

export const emitter = new EventEmitter();

let entries = [];
try {
    if (existsSync(FILE)) entries = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (err) {
    console.error('❌ Journal illisible, on repart de zéro:', err.message);
}

// Écriture groupée : plusieurs événements rapprochés = un seul accès disque
let saveTimer = null;
const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            writeFileSync(FILE, JSON.stringify(entries), 'utf8');
        } catch (err) {
            console.error('❌ Sauvegarde du journal impossible:', err.message);
        }
    }, 2000);
};

/**
 * Ajoute une entrée.
 * @param {object} e
 * @param {'door'|'heating'|'automation'|'companion'|'agent'|'sensor'|'system'} e.kind
 * @param {string} e.title  phrase courte affichée telle quelle
 * @param {object} [e.data] détails structurés (capteur, valeurs...)
 */
export const log = ({ kind, title, data = {} }) => {
    const entry = { id: randomUUID(), ts: Date.now(), kind, title, data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    scheduleSave();
    emitter.emit('entry', entry);
    return entry;
};

/** Entrées les plus récentes d'abord, filtrables par type et par date. */
export const list = ({ limit = 50, kind, since } = {}) => {
    const out = [];
    for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
        const e = entries[i];
        if (kind && e.kind !== kind) continue;
        if (since && e.ts < since) break;
        out.push(e);
    }
    return out;
};
