// Génère des « Jean-Claude » de synthèse avec les voix françaises de Piper,
// pour compléter les enregistrements faits sur /wakeword avant l'entraînement
// openWakeWord. Produit aussi des mots proches (négatifs) que le modèle doit
// apprendre à ignorer.
//
// Usage : node scripts/generate-wakeword-tts.js <dossier piper> <dossier voix> [sortie]
//   <dossier piper> : contient piper.exe (release Windows de rhasspy/piper)
//   <dossier voix>  : fichiers fr_FR-*.onnx + .onnx.json (rhasspy/piper-voices)
//   [sortie]        : défaut server/data/wakeword/piper
//
// Sortie : positive/*.wav et negative/*.wav, en 16 kHz mono 16 bits.

import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const [piperDir, voicesDir, outArg] = process.argv.slice(2);
if (!piperDir || !voicesDir) {
    console.log('Usage : node scripts/generate-wakeword-tts.js <dossier piper> <dossier voix> [sortie]');
    process.exit(1);
}
const OUT = outArg || join(dirname(fileURLToPath(import.meta.url)), '../server/data/wakeword/piper');
const PIPER = join(piperDir, process.platform === 'win32' ? 'piper.exe' : 'piper');
const RATE = 16000;

// La ponctuation change l'intonation de Piper : autant de variantes gratuites
const POSITIVE = ['Jean-Claude', 'Jean-Claude !', 'Jean-Claude ?', 'Jean-Claude…', 'Jean-Claude, '];
const NEGATIVE = [
    'Jean', 'Claude', 'Jean-Pierre', 'Jean-Luc', 'Jean-Marc', 'Jean-Paul', 'Jean-Louis',
    'Jean-Michel', 'Jean-Charles', 'Claudine', 'Claudia', 'Clotilde', 'j’en code',
    'gens qui codent', 'je clôture', 'en clôture', 'chlore', 'le clone', 'chaud',
    'ça claque', 'Jean-Baptiste', 'Jacques', 'Gérard', 'quand Claude', 'Jeanne',
];
// Débit (length_scale) et variabilité de la voix (noise_scale, noise_w)
const STYLES = [
    { length: 0.8, noise: 0.5, w: 0.6 },
    { length: 1.0, noise: 0.667, w: 0.8 },
    { length: 1.2, noise: 0.8, w: 0.9 },
    { length: 1.4, noise: 0.6, w: 1.0 },
];
// Voix multi-locuteurs (mls : 125 voix) : on en prend un sur MLS_STEP pour les négatifs
const MLS_STEP = 3;

const voices = fs
    .readdirSync(voicesDir)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => {
        const config = JSON.parse(fs.readFileSync(join(voicesDir, `${f}.json`), 'utf8'));
        return { model: join(voicesDir, f), name: basename(f, '.onnx'), speakers: config.num_speakers || 1 };
    });
if (!voices.length) {
    console.log(`Aucune voix .onnx dans ${voicesDir}`);
    process.exit(1);
}

// Piper en mode JSON : une ligne par phrase à synthétiser, un seul chargement du modèle
const runPiper = (voice, style, lines, tmpDir) =>
    new Promise((resolve, reject) => {
        const proc = spawn(PIPER, [
            '-m', voice.model,
            '--json-input',
            '--length_scale', String(style.length),
            '--noise_scale', String(style.noise),
            '--noise_w', String(style.w),
            '--sentence_silence', '0',
        ], { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => (stderr += d));
        proc.on('error', reject);
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper ${code} : ${stderr.slice(-300)}`))));
        for (const line of lines) {
            const entry = { text: line.text, output_file: join(tmpDir, line.file) };
            if (voice.speakers > 1) entry.speaker_id = line.speaker;
            proc.stdin.write(`${JSON.stringify(entry)}\n`);
        }
        proc.stdin.end();
    });

const readWav = (file) => {
    const buf = fs.readFileSync(file);
    let offset = 12;
    let rate = 0;
    let channels = 1;
    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        if (id === 'fmt ') {
            channels = buf.readUInt16LE(offset + 10);
            rate = buf.readUInt32LE(offset + 12);
        } else if (id === 'data') {
            const count = Math.floor(size / 2 / channels);
            const pcm = new Float32Array(count);
            for (let i = 0; i < count; i++) pcm[i] = buf.readInt16LE(offset + 8 + i * 2 * channels) / 32768;
            return { pcm, rate };
        }
        offset += 8 + size;
    }
    throw new Error(`WAV illisible : ${file}`);
};

// Sinc fenêtré (Hann) avec coupure à la nouvelle fréquence de Nyquist
const resample = (pcm, from) => {
    if (from === RATE) return pcm;
    const ratio = from / RATE;
    const cutoff = Math.min(1, RATE / from) * 0.95;
    const half = 16 * Math.ceil(ratio);
    const out = new Float32Array(Math.floor(pcm.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const center = i * ratio;
        const start = Math.max(0, Math.ceil(center - half));
        const end = Math.min(pcm.length - 1, Math.floor(center + half));
        let sum = 0;
        let norm = 0;
        for (let j = start; j <= end; j++) {
            const x = j - center;
            const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
            const win = 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
            const k = cutoff * sinc * win;
            sum += pcm[j] * k;
            norm += k;
        }
        out[i] = norm ? sum / norm : 0;
    }
    return out;
};

// La voix mls babille parfois plusieurs secondes après le mot : on ne garde
// que les prises faites d'un seul bloc de parole, de durée plausible, rognées
// à 100 ms autour de la voix. null = prise rejetée.
const FRAME = RATE / 50; // 20 ms
const MAX_GAP = 13; // trames : un « Jean-Claude » n'a pas de pause de plus de 260 ms
const extractUtterance = (pcm, minSeconds, maxSeconds) => {
    const rms = [];
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
        let sum = 0;
        for (let j = i; j < i + FRAME; j++) sum += pcm[j] * pcm[j];
        rms.push(Math.sqrt(sum / FRAME));
    }
    const floor = Math.max(...rms) * 0.1;
    const segments = [];
    rms.forEach((v, i) => {
        if (v < floor) return;
        const prev = segments.at(-1);
        if (prev && i - prev.end <= MAX_GAP) prev.end = i;
        else segments.push({ start: i, end: i });
    });
    if (segments.length !== 1) return null;
    const { start, end } = segments[0];
    const seconds = ((end - start + 1) * FRAME) / RATE;
    if (seconds < minSeconds || seconds > maxSeconds) return null;
    return pcm.slice(Math.max(0, start - 5) * FRAME, Math.min(rms.length, end + 6) * FRAME);
};
const LIMITS = { positive: [0.4, 1.6], negative: [0.15, 1.6] };

const writeWav = (file, pcm) => {
    const buf = Buffer.alloc(44 + pcm.length * 2);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + pcm.length * 2, 4);
    buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(RATE, 24);
    buf.writeUInt32LE(RATE * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(pcm.length * 2, 40);
    pcm.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
    fs.writeFileSync(file, buf);
};

const tmpRoot = join(OUT, '.tmp');
for (const kind of ['positive', 'negative']) fs.mkdirSync(join(OUT, kind), { recursive: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const totals = { positive: 0, negative: 0, rejected: 0 };
for (const voice of voices) {
    for (const [s, style] of STYLES.entries()) {
        const lines = [];
        for (let speaker = 0; speaker < voice.speakers; speaker++) {
            // Deux phrases positives par locuteur et par style (une partie sera rejetée)
            for (let k = 0; k < 2; k++) {
                const text = POSITIVE[(speaker + s + k * 2) % POSITIVE.length];
                lines.push({ kind: 'positive', text, speaker, file: `p-${speaker}-${k}.wav` });
            }
            if (speaker % MLS_STEP === 0) {
                // Quelques négatifs par locuteur, différents à chaque style
                for (let k = 0; k < 3; k++) {
                    const neg = NEGATIVE[(speaker + s * 3 + k) % NEGATIVE.length];
                    lines.push({ kind: 'negative', text: neg, speaker, file: `n-${speaker}-${k}.wav` });
                }
            }
        }
        // Voix à un seul locuteur : toutes les variantes, pour compenser
        if (voice.speakers === 1) {
            POSITIVE.forEach((text, k) => lines.push({ kind: 'positive', text, speaker: 0, file: `p-0-x${k}.wav` }));
            NEGATIVE.forEach((text, k) => lines.push({ kind: 'negative', text, speaker: 0, file: `n-0-x${k}.wav` }));
        }

        const tmpDir = join(tmpRoot, `${voice.name}-${s}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        process.stdout.write(`${voice.name} style ${s + 1}/${STYLES.length} : ${lines.length} phrases… `);
        await runPiper(voice, style, lines, tmpDir);
        for (const line of lines) {
            const src = join(tmpDir, line.file);
            if (!fs.existsSync(src)) continue;
            const { pcm, rate } = readWav(src);
            const clip = extractUtterance(resample(pcm, rate), ...LIMITS[line.kind]);
            if (!clip) {
                totals.rejected++;
                continue;
            }
            const name = `${voice.name}-s${s}-${basename(line.file, '.wav')}.wav`;
            writeWav(join(OUT, line.kind, name), clip);
            totals[line.kind]++;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log('ok');
    }
}
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n✅ ${totals.positive} positifs et ${totals.negative} négatifs dans ${OUT} (${totals.rejected} prises ratées écartées)`);
