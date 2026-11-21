/**
 * Réglages des widgets de l'accueil : Auto / Toujours / Masqué par widget.
 * Gardés sur le serveur pour que la tablette et le téléphone partagent les mêmes choix.
 * La pertinence elle-même se calcule côté écran (src/components/home/widgets/relevance.ts).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';

const FILE = dataFile('home-widgets.json');

export const WIDGET_IDS = ['guard', 'city', 'advent', 'veillee', 'cooper', 'mail', 'music', 'house', 'moves', 'sky', 'journal'];
/** Anciens widgets fondus dans « Déplacements » (novembre 2026) */
const MOVES_PARTS = ['bixi', 'metro', 'communauto'];
export const PINS = ['auto', 'always', 'hidden'];

// Cooper reste une carte par défaut : c'est le widget préféré de la maison
const DEFAULTS = Object.fromEntries(WIDGET_IDS.map((id) => [id, id === 'cooper' ? 'always' : 'auto']));

/**
 * Reprend les réglages d'avant la fusion : BIXI, Métro et Communauto deviennent Déplacements.
 * Toujours si l'un des trois l'était, Masqué seulement s'ils l'étaient tous, Auto sinon.
 */
export function migrate(raw = {}) {
    if (raw.moves) return raw;
    const old = MOVES_PARTS.map((id) => raw[id]).filter(Boolean);
    if (!old.length) return raw;
    const moves = old.includes('always') ? 'always' : old.length === MOVES_PARTS.length && old.every((p) => p === 'hidden') ? 'hidden' : 'auto';
    return { ...raw, moves };
}

let pins = { ...DEFAULTS };
try {
    if (existsSync(FILE)) {
        const raw = JSON.parse(readFileSync(FILE, 'utf8')).pins || {};
        pins = { ...pins, ...clean(migrate(raw)) };
        // Le fichier garde la nouvelle forme dès le premier démarrage
        if (MOVES_PARTS.some((id) => id in raw)) save();
    }
} catch (err) {
    console.error('❌ home-widgets.json illisible, réglages par défaut:', err.message);
}

function save() {
    try {
        writeFileSync(FILE, JSON.stringify({ pins }, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des widgets de l’accueil impossible:', err.message);
    }
}

/** Ne garde que les widgets connus et les valeurs permises. */
function clean(input) {
    const out = {};
    for (const [id, pin] of Object.entries(input || {})) {
        if (WIDGET_IDS.includes(id) && PINS.includes(pin)) out[id] = pin;
    }
    return out;
}

export const getPins = () => ({ pins: { ...pins } });

/** Change un ou plusieurs réglages ; refuse un widget ou une valeur inconnus. */
export function updatePins(input) {
    const given = input?.pins ?? input;
    if (!given || typeof given !== 'object') throw new Error('réglages attendus : { pins: { widget: auto|always|hidden } }');
    for (const [id, pin] of Object.entries(given)) {
        if (!WIDGET_IDS.includes(id)) throw new Error(`widget inconnu : ${id}`);
        if (!PINS.includes(pin)) throw new Error(`réglage inconnu pour ${id} : ${pin}`);
    }
    pins = { ...pins, ...clean(given) };
    save();
    return getPins();
}
