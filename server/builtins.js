/**
 * Automatismes intégrés : un seul point de passage pour parler, allumer une lampe ou
 * écrire sur Telegram de soi-même. Vérifie l'interrupteur du canal et l'inscrit au journal.
 * État dans data/builtins.json : { [id]: { off: ['voice'], deleted?: true } }.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import { REGISTRY, byId, allows as allowsIn, patch, view, RUN_GAP_MS } from './builtinsLogic.js';

export { REGISTRY };

const FILE = dataFile('builtins.json');
let state = {};
try {
    if (existsSync(FILE)) state = JSON.parse(readFileSync(FILE, 'utf8')) || {};
} catch (err) {
    console.error('❌ Automatismes intégrés illisibles, tout reste actif:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des automatismes intégrés impossible:', err.message);
    }
};

/** @param {string} id  @param {'voice'|'lamp'|'telegram'} channel */
export const allows = (id, channel) => allowsIn(state, id, channel);

const lastRun = new Map(); // id → { run, at }
const LABEL = { voice: 'voix', lamp: 'lampe', telegram: 'Telegram' };

/**
 * Note qu'un canal a tourné. Les canaux d'un même passage partagent un « run ».
 * @param {string} id @param {'voice'|'lamp'|'telegram'} channel @param {string} [detail]
 */
export const ran = (id, channel, detail = '') => {
    const def = byId.get(id);
    if (!def) return;
    const now = Date.now();
    const prev = lastRun.get(id);
    const run = prev && now - prev.at < RUN_GAP_MS ? prev.run : randomUUID();
    lastRun.set(id, { run, at: now });
    journal.log({
        kind: 'automation',
        title: `${def.name} (${LABEL[channel]})${detail ? ` : ${detail}` : ''}`,
        data: { builtin: id, channel, run, detail: detail || null },
    });
};

/**
 * Lance un canal s'il est permis, et l'inscrit au journal s'il a tourné.
 * fn peut renvoyer false pour dire « rien n'est parti » (pas de journal).
 */
export const run = async (id, channel, fn, detail = '') => {
    if (!allows(id, channel)) return false;
    const out = await fn();
    if (out !== false) ran(id, channel, detail);
    return out;
};

export const list = () => view(state, journal.list({ limit: 2000 }));

export const update = (id, change) => {
    state = patch(state, id, change);
    save();
    const def = byId.get(id);
    const what =
        typeof change.deleted === 'boolean'
            ? change.deleted ? 'supprimé' : 'restauré'
            : typeof change.all === 'boolean'
              ? change.all ? 'réactivé' : 'désactivé'
              : `${LABEL[change.channel]} ${change.on ? 'rallumée' : 'coupée'}`;
    journal.log({ kind: 'system', title: `« ${def.name} » ${what}`, data: { builtinChange: id, change } });
    return list().find((b) => b.id === id);
};

/** Ce qui a tourné récemment, un passage par ligne, le plus récent d'abord. */
export const recent = ({ days = 7, limit = 200 } = {}) => {
    const since = Date.now() - days * 24 * 3600_000;
    const rows = [];
    const byRun = new Map();
    for (const e of journal.list({ limit: 2000, kind: 'automation', since })) {
        const b = e.data?.builtin;
        const key = b ? `b:${e.data.run}` : e.data?.automationId ? `a:${e.id}` : null;
        if (!key) continue;
        let row = byRun.get(key);
        if (!row) {
            row = b
                ? { type: 'builtin', id: b, name: byId.get(b)?.name || b, at: e.ts, channels: [], detail: e.data.detail || null }
                : { type: 'mine', id: e.data.automationId, name: e.title, at: e.ts, channels: [], detail: null };
            byRun.set(key, row);
            rows.push(row);
        }
        if (b && !row.channels.includes(e.data.channel)) row.channels.push(e.data.channel);
        if (b && !row.detail && e.data.detail) row.detail = e.data.detail;
        if (rows.length >= limit) break;
    }
    return rows;
};
