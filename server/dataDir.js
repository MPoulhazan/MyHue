/**
 * Dossier des données persistantes (règles, capteurs, état chauffage).
 * Par défaut server/data ; dans l'add-on Home Assistant : MYHUE_DATA_DIR=/data
 */
import 'dotenv/config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync } from 'fs';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

export const DATA_DIR = process.env.MYHUE_DATA_DIR || DEFAULT_DIR;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

/** Chemin d'un fichier de données ; copie la version du repo au premier lancement. */
export function dataFile(name) {
    const target = join(DATA_DIR, name);
    const seed = join(DEFAULT_DIR, name);
    if (DATA_DIR !== DEFAULT_DIR && !existsSync(target) && existsSync(seed)) {
        copyFileSync(seed, target);
    }
    return target;
}
