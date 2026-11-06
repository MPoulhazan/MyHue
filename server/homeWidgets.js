/**
 * Réglages des widgets de l'accueil : Auto / Toujours / Masqué par widget.
 * Gardés sur le serveur pour que la tablette et le téléphone partagent les mêmes choix.
 * La pertinence elle-même se calcule côté écran (src/components/home/widgets/relevance.ts).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';

const FILE = dataFile('home-widgets.json');

export const WIDGET_IDS = ['city', 'cooper', 'mail', 'house', 'bixi', 'metro', 'sky', 'journal'];
export const PINS = ['auto', 'always', 'hidden'];

// Cooper reste une carte par défaut : c'est le widget préféré de la maison
const DEFAULTS = Object.fromEntries(WIDGET_IDS.map((id) => [id, id === 'cooper' ? 'always' : 'auto']));

let pins = { ...DEFAULTS };
try {
    if (existsSync(FILE)) pins = { ...pins, ...clean(JSON.parse(readFileSync(FILE, 'utf8')).pins || {}) };
} catch (err) {
    console.error('❌ home-widgets.json illisible, réglages par défaut:', err.message);
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
    try {
        writeFileSync(FILE, JSON.stringify({ pins }, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des widgets de l’accueil impossible:', err.message);
    }
    return getPins();
}
