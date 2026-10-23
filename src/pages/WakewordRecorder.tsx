import { useEffect, useRef, useState, type CSSProperties } from 'react';
import axios from 'axios';
import { openMic, recordClip, type Clip } from '../voice/recordClip';

// Collecte d'enregistrements « Jean-Claude » pour entraîner le mot d'activation.
// Les WAV sont rangés côté serveur dans server/data/wakeword/<locuteur>/.

const SPEAKER_KEY = 'myhue.wakeword.speaker';
const TARGET = 50;
const BURST = 10;

type Phase = 'idle' | 'ready' | 'recording' | 'saving';

const TIPS = [
    'Varie la distance : collé à la tablette, à 2 m, depuis l’autre bout de la pièce.',
    'Varie le ton : normal, pressé, fatigué, en chuchotant un peu, plus fort.',
    'Varie le débit : « Jean-Claude », « Jeaan-Claude », « J’Claude ».',
    'Enregistre aussi avec la télé ou la musique en fond, comme en vrai.',
];

// Même nom de dossier que côté serveur (server/wakewordSamples.js)
const folderName = (value: string) =>
    value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'moi';

const readSpeaker = () => {
    try {
        return localStorage.getItem(SPEAKER_KEY) || 'moi';
    } catch {
        return 'moi';
    }
};

export function WakewordRecorder() {
    const [speaker, setSpeaker] = useState(readSpeaker);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [phase, setPhase] = useState<Phase>('idle');
    const [message, setMessage] = useState('');
    const [last, setLast] = useState<Clip | null>(null);
    const [burstLeft, setBurstLeft] = useState(0);
    const stopRef = useRef(false);

    useEffect(() => {
        axios.get('/api/wakeword/samples').then(({ data }) => setCounts(data.speakers)).catch(() => {});
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(SPEAKER_KEY, speaker);
        } catch {
            // nom non mémorisé
        }
    }, [speaker]);

    const takeOne = async (stream: MediaStream) => {
        setPhase('ready');
        setMessage('Prépare-toi…');
        await new Promise((res) => setTimeout(res, 700));
        setPhase('recording');
        setMessage('Dis « Jean-Claude »');
        const clip = await recordClip(stream);
        if (!clip) {
            setMessage('Rien entendu, recommence.');
            return false;
        }
        setPhase('saving');
        const { data } = await axios.post(`/api/wakeword/samples?speaker=${encodeURIComponent(speaker)}`, clip.wav, {
            headers: { 'Content-Type': 'audio/wav' },
        });
        setCounts(data.speakers);
        setLast(clip);
        setMessage(`Enregistré (${clip.seconds.toFixed(1)} s).`);
        return true;
    };

    const record = async (burst: number) => {
        stopRef.current = false;
        let stream: MediaStream | null = null;
        try {
            stream = await openMic();
            for (let left = burst; left > 0 && !stopRef.current; left--) {
                setBurstLeft(left);
                await takeOne(stream);
                if (left > 1) await new Promise((res) => setTimeout(res, 600));
            }
        } catch (error) {
            setMessage(`Erreur : ${(error as Error).message}`);
        } finally {
            stream?.getTracks().forEach((t) => t.stop());
            setBurstLeft(0);
            setPhase('idle');
        }
    };

    const deleteLast = async () => {
        const { data } = await axios.delete(`/api/wakeword/samples/last?speaker=${encodeURIComponent(speaker)}`);
        setCounts(data.speakers);
        setLast(null);
        setMessage(data.deleted ? 'Dernière prise supprimée.' : 'Rien à supprimer.');
    };

    const play = () => {
        if (!last) return;
        const url = URL.createObjectURL(last.wav);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(() => {});
    };

    const mine = counts[folderName(speaker)] ?? 0;
    const busy = phase !== 'idle';

    return (
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: 24, marginBottom: 4 }}>Mot d’activation : « Jean-Claude »</h1>
            <p style={{ opacity: 0.7, marginTop: 0 }}>
                Chaque prise sert à entraîner le modèle. Vise {TARGET} prises par personne.
            </p>

            <label style={{ display: 'block', margin: '20px 0' }}>
                Qui parle ?{' '}
                <input
                    value={speaker}
                    onChange={(e) => setSpeaker(e.target.value)}
                    disabled={busy}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit' }}
                />
            </label>

            <div style={{ fontSize: 40, fontWeight: 600 }}>
                {mine} <span style={{ fontSize: 18, opacity: 0.6 }}>/ {TARGET} prises</span>
            </div>
            <div style={{ height: 6, background: 'color-mix(in srgb, var(--text-primary) 15%, transparent)', borderRadius: 3, margin: '8px 0 24px' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (mine / TARGET) * 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
            </div>

            <div
                style={{
                    minHeight: 64,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: phase === 'recording' ? 26 : 18,
                    fontWeight: phase === 'recording' ? 700 : 400,
                    color: phase === 'recording' ? 'var(--accent)' : 'inherit',
                    border: '1px solid color-mix(in srgb, var(--text-primary) 20%, transparent)',
                    borderRadius: 12,
                    marginBottom: 16,
                }}
            >
                {message || 'Appuie sur un bouton pour commencer.'}
                {burstLeft > 1 && <span style={{ fontSize: 14, opacity: 0.6, marginLeft: 8 }}>({burstLeft} restantes)</span>}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {!busy ? (
                    <>
                        <button onClick={() => record(1)} style={btn(true)}>Une prise</button>
                        <button onClick={() => record(BURST)} style={btn(true)}>Rafale de {BURST}</button>
                    </>
                ) : (
                    <button onClick={() => (stopRef.current = true)} style={btn(false)}>Arrêter après celle-ci</button>
                )}
                <button onClick={play} disabled={!last || busy} style={btn(false)}>Réécouter</button>
                <button onClick={deleteLast} disabled={busy || !mine} style={btn(false)}>Supprimer la dernière</button>
            </div>

            <h2 style={{ fontSize: 16, marginTop: 32 }}>Pour un bon modèle</h2>
            <ul style={{ opacity: 0.8, lineHeight: 1.6, paddingLeft: 20 }}>
                {TIPS.map((t) => <li key={t}>{t}</li>)}
            </ul>

            {Object.keys(counts).length > 1 && (
                <p style={{ opacity: 0.6, fontSize: 14 }}>
                    Tout le monde : {Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ')}
                </p>
            )}
        </div>
    );
}

const btn = (primary: boolean): CSSProperties => ({
    padding: '12px 18px',
    borderRadius: 10,
    border: '1px solid var(--accent)',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? 'var(--bg-dark)' : 'var(--accent)',
    fontSize: 16,
    cursor: 'pointer',
});
