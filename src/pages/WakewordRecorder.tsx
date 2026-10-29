import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { openMic, recordClip, type Clip } from '../voice/recordClip';
import './Dashboard.css';
import './Settings.css';
import './Remote.css';

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
        <div className="home settings-page wakeword">
            <header className="home-top">
                <div className="home-hello"><h1>Mot d’activation</h1><span className="muted">« Jean-Claude »</span></div>
            </header>

            <section className="card" aria-label="Enregistrer des prises">
                <p className="remote-text">Chaque prise sert à entraîner le modèle. Vise {TARGET} prises par personne.</p>
                <label className="field">
                    <span>Qui parle ?</span>
                    <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} disabled={busy} maxLength={32} />
                </label>

                <div className="wakeword-count">
                    <strong className="mono">{mine}</strong><span className="muted">/ {TARGET} prises</span>
                </div>
                <div className="wakeword-bar"><i style={{ width: `${Math.min(100, (mine / TARGET) * 100)}%` }} /></div>

                <div className={`wakeword-status${phase === 'recording' ? ' live' : ''}`} role="status">
                    {message || 'Appuie sur un bouton pour commencer.'}
                    {burstLeft > 1 && <span className="muted">&nbsp;({burstLeft} restantes)</span>}
                </div>

                <div className="wakeword-actions">
                    {!busy ? (
                        <>
                            <button type="button" className="primary-btn" onClick={() => record(1)}>Une prise</button>
                            <button type="button" className="pill-btn" onClick={() => record(BURST)}>Rafale de {BURST}</button>
                        </>
                    ) : (
                        <button type="button" className="pill-btn" onClick={() => (stopRef.current = true)}>Arrêter après celle-ci</button>
                    )}
                    <button type="button" className="ghost-btn" onClick={play} disabled={!last || busy}>Réécouter</button>
                    <button type="button" className="ghost-btn" onClick={deleteLast} disabled={busy || !mine}>Supprimer la dernière</button>
                </div>
            </section>

            <section className="card" aria-label="Conseils">
                <h2 className="card-title">Pour un bon modèle</h2>
                <ul className="wakeword-tips">
                    {TIPS.map((t) => <li key={t}>{t}</li>)}
                </ul>
                {Object.keys(counts).length > 1 && (
                    <p className="settings-note muted">
                        Tout le monde : {Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ')}
                    </p>
                )}
            </section>
        </div>
    );
}
