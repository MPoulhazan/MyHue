/**
 * Enregistrements du mot d'activation (« Jean-Claude ») pour entraîner un
 * modèle openWakeWord : un WAV 16 kHz mono par prise, rangé par locuteur
 * dans <data>/wakeword/<locuteur>/.
 */
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { DATA_DIR } from './dataDir.js';

const ROOT = join(DATA_DIR, 'wakeword');
const MAX_BYTES = 2 * 1024 * 1024;

// Nom de dossier sûr : lettres, chiffres, tirets
const safeName = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'moi';

const wavFiles = (dir) =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.wav')).sort() : [];

const counts = () => {
    if (!existsSync(ROOT)) return {};
    const result = {};
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        // Les dossiers de synthèse (piper/positive…) n'ont pas de WAV à la racine
        const n = wavFiles(join(ROOT, entry.name)).length;
        if (n) result[entry.name] = n;
    }
    return result;
};

const isWav = (buf) =>
    buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';

export function installWakewordRoutes(app, express) {
    app.get('/api/wakeword/samples', (_req, res) => {
        res.json({ dir: ROOT, speakers: counts() });
    });

    app.post(
        '/api/wakeword/samples',
        express.raw({ type: 'audio/wav', limit: MAX_BYTES }),
        (req, res) => {
            if (!Buffer.isBuffer(req.body) || !isWav(req.body)) {
                return res.status(400).json({ error: 'WAV attendu' });
            }
            const speaker = safeName(req.query.speaker);
            const dir = join(ROOT, speaker);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${Date.now()}.wav`), req.body);
            res.json({ speaker, speakers: counts() });
        },
    );

    // Supprime la dernière prise (ratée, bruit, fou rire…)
    app.delete('/api/wakeword/samples/last', (req, res) => {
        const speaker = safeName(req.query.speaker);
        const dir = join(ROOT, speaker);
        const last = wavFiles(dir).pop();
        if (last) unlinkSync(join(dir, last));
        res.json({ speaker, deleted: last || null, speakers: counts() });
    });
}
