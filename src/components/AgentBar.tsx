import { useEffect, useState } from 'react';
import { useVoice } from '../hooks/useVoice';
import './AgentBar.css';

// ── Barre agent (texte + voix) ───────────────────────────────────────────────

const VOICE_PLACEHOLDER = {
    listening: 'J’écoute…',
    thinking: 'Je réfléchis…',
    speaking: 'Je réponds…',
} as const;

const WAKE_TITLE = {
    off: 'Activer « Hey Jarvis » sur cet appareil',
    loading: 'Chargement du modèle…',
    on: '« Hey Jarvis » actif — toucher pour couper',
    'needs-tap': 'Touche l’écran pour réveiller le micro',
    error: 'Mot d’activation indisponible',
} as const;

// ?voicedebug dans l'URL : état du micro, du mot d'activation et de la reconnaissance
const VOICE_DEBUG = new URLSearchParams(window.location.search).has('voicedebug');

function VoiceDebug({ voice }: { voice: ReturnType<typeof useVoice> }) {
    const [, tick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 250);
        return () => clearInterval(t);
    }, []);
    const s = voice.listenerRef.current?.stats;
    return (
        <pre style={{ width: '100%', margin: 0, fontSize: 12, opacity: 0.8 }}>
            {`jarvis=${voice.wakeStatus}${voice.wakeError ? ` (${voice.wakeError})` : ''} blocs=${s?.chunks ?? '-'} niveau=${s ? s.level.toFixed(3) : '-'} score=${s ? s.score.toFixed(2) : '-'} perdus=${s?.dropped ?? '-'} micro=${s?.mic || '-'}
`}
            {`reco=${voice.supported ? 'ok' : 'indispo'} état=${voice.state} étapes: ${voice.trace.join(' → ') || '-'}`}
        </pre>
    );
}

export function AgentBar({ onAsk, chips }: { onAsk: (m: string) => Promise<string | undefined>; chips: string[] }) {
    const [text, setText] = useState('');
    const voice = useVoice(onAsk);
    const listening = voice.state === 'listening';
    const noMic = !voice.secure
        ? 'Micro bloqué : la page doit être en HTTPS (ou origine autorisée dans Chrome)'
        : 'Reconnaissance vocale non disponible dans ce navigateur';
    const wakeFailed = voice.wakeStatus === 'error' ? `Jarvis indisponible : ${voice.wakeError}` : null;
    const placeholder =
        voice.state === 'idle'
            ? voice.voiceError || wakeFailed
                || (voice.wakeStatus === 'on' ? 'Dis « Hey Jarvis » ou écris ici' : 'Dis-moi ce que tu veux')
            : VOICE_PLACEHOLDER[voice.state];

    return (
        <div className="agentbar">
            <form className={`agent-input ${listening ? 'listening' : ''}`} onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onAsk(text.trim());
                setText('');
            }}>
                <span className="accent">&gt;</span>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Commande pour l'agent" />
                {listening && <span className="wave" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}</span>}
                <button type="button" className="mic" aria-label="Parler à l'agent" onClick={voice.converse}
                    disabled={!voice.supported || voice.state !== 'idle'} title={voice.supported ? undefined : noMic}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
            </form>
            <button type="button" className={`chip wake ${voice.wakeEnabled ? 'on' : ''} ${voice.wakeStatus}`}
                onClick={() => voice.setWakeEnabled(!voice.wakeEnabled)} disabled={!voice.supported} aria-pressed={voice.wakeEnabled}
                title={voice.supported ? (voice.wakeError ? `${WAKE_TITLE.error} : ${voice.wakeError}` : WAKE_TITLE[voice.wakeStatus]) : noMic}>
                Jarvis
            </button>
            {chips.map((c) => <button key={c} className="chip" onClick={() => onAsk(c)}>{c}</button>)}
            {VOICE_DEBUG && <VoiceDebug voice={voice} />}
        </div>
    );
}

