// ── Tuiles de plan servies par le Pi ─────────────────────────────────────────
//
// Les serveurs d'OpenStreetMap bloquent les tuiles demandées directement par la
// tablette (« Access blocked » à la place du plan), et CARTO exige désormais une clé.
// Le Pi les demande donc lui-même, avec un User-Agent qui le nomme comme l'exige la
// politique d'OSM, et les garde 30 jours sur disque : le plan ne couvre qu'un quartier,
// quelques dizaines de tuiles en tout.

import axios from 'axios';
import { join } from 'path';
import { existsSync, mkdirSync, statSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { DATA_DIR } from './dataDir.js';

const DIR = join(DATA_DIR, 'tiles');
const MAX_AGE_MS = 30 * 24 * 3600_000;
const UA = 'MyHue-home/1.0 (tableau de bord domestique, tuiles mises en cache)';

/** Une tuile valide : zoom 0 à 19, x et y dans la grille de ce zoom. */
export function validTile(z, x, y) {
    if (![z, x, y].every(Number.isInteger)) return false;
    if (z < 0 || z > 19) return false;
    const n = 2 ** z;
    return x >= 0 && x < n && y >= 0 && y < n;
}

const pending = new Map();

/** Le PNG de la tuile, depuis le cache ou OSM. */
export async function getTile(z, x, y) {
    const file = join(DIR, `${z}-${x}-${y}.png`);
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) return readFile(file);
    const key = `${z}/${x}/${y}`;
    // Deux cartes ouvertes en même temps : une seule demande à OSM
    if (!pending.has(key)) {
        pending.set(key, (async () => {
            try {
                const { data } = await axios.get(`https://tile.openstreetmap.org/${key}.png`, {
                    responseType: 'arraybuffer', timeout: 10_000, headers: { 'User-Agent': UA },
                });
                const buf = Buffer.from(data);
                if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
                await writeFile(file, buf);
                return buf;
            } catch (err) {
                // OSM injoignable : une vieille tuile vaut mieux qu'un trou
                if (existsSync(file)) return readFile(file);
                throw err;
            } finally {
                pending.delete(key);
            }
        })());
    }
    return pending.get(key);
}
