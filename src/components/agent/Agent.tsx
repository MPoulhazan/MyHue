import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { AgentTurn } from '../../hooks/useHome';
import { useVoice } from '../../hooks/useVoice';
import type { Sensitivity } from '../../voice/wakeListener';
import { Icon } from '../Icon';
import './Agent.css';

// ── Agent : une barre (texte + voix) et le fil de la conversation ────────────

type Voice = ReturnType<typeof useVoice>;

// Libellés seulement : wakeListener charge onnxruntime, on ne l'importe pas ici
const SENSITIVITY_CHOICES: { id: Sensitivity; label: string }[] = [
    { id: 'low', label: 'Faible' },
    { id: 'normal', label: 'Normale' },
    { id: 'high', label: 'Forte' },
];

const VOICE_PLACEHOLDER = {
    listening: 'J’écoute…',
    thinking: 'Je réfléchis…',
    speaking: 'Je réponds…',
} as const;

const WAKE_STATUS = {
    off: 'Désactivé sur cet appareil',
    loading: 'Chargement…',
    on: 'J’écoute en permanence sur cet appareil',
    'needs-tap': 'Touche l’écran pour réveiller le micro',
    error: 'Indisponible',
} as const;

/** Demandes d'exemple : un peu de chaque pièce de la maison. */
const EXAMPLES = [
    'Éteins toutes les lumières',
    'Ambiance chaude dans le salon',
    'Mets le chauffage à 21°',
    'Quelle température fait-il ?',
    'Mets une radio dans la cuisine',
    'Préviens-moi si une porte s’ouvre',
];

// ?voicedebug dans l'URL : état du micro, du mot d'activation et de la reconnaissance
const VOICE_DEBUG = new URLSearchParams(window.location.search).has('voicedebug');

function VoiceDebug({ voice }: { voice: Voice }) {
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

const noMicReason = (voice: Voice) => !voice.secure
    ? 'Micro bloqué : la page doit être en HTTPS'
    : 'Reconnaissance vocale non disponible dans ce navigateur';

/** Champ de saisie + micro ; `onOpen` ajoute le bouton qui ouvre la conversation. */
export function AgentBar({ voice, onAsk, onOpen, autoFocus }: {
    voice: Voice;
    onAsk: (m: string) => void;
    onOpen?: () => void;
    autoFocus?: boolean;
}) {
    const [text, setText] = useState('');
    const listening = voice.state === 'listening';
    const placeholder =
        voice.state === 'idle'
            ? voice.voiceError || (voice.wakeStatus === 'on' ? 'Dis « Hey Jarvis » ou écris ici' : 'Demande-moi quelque chose')
            : VOICE_PLACEHOLDER[voice.state];

    return (
        <div className="agentbar">
            <form className={`agent-input ${listening ? 'listening' : ''}`} onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onAsk(text.trim());
                setText('');
            }}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
                    aria-label="Demande à l'assistant" autoFocus={autoFocus} enterKeyHint="send" />
                {listening && <span className="wave" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}</span>}
                <button type="button" className="mic" aria-label="Parler à l'assistant" onClick={voice.converse}
                    disabled={!voice.supported || voice.state !== 'idle'} title={voice.supported ? undefined : noMicReason(voice)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
            </form>
            {onOpen && (
                <button type="button" className="agent-open" onClick={onOpen} aria-label="Voir la conversation">
                    <Icon name="chat" size={24} strokeWidth={2} />
                </button>
            )}
            {VOICE_DEBUG && <VoiceDebug voice={voice} />}
        </div>
    );
}

/** Conversation complète, exemples et réglage du mot d'activation. */
export function AgentSheet({ voice, conversation, thinking, onAsk, onClear, onClose }: {
    voice: Voice;
    conversation: AgentTurn[];
    thinking: boolean;
    onAsk: (m: string) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [conversation, thinking]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const wakeHint = !voice.supported
        ? noMicReason(voice)
        : voice.wakeError ? `${WAKE_STATUS.error} : ${voice.wakeError}` : WAKE_STATUS[voice.wakeStatus];

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet agent-sheet" role="dialog" aria-modal="true" aria-label="Assistant"
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>Assistant</h2>
                    <div className="sheet-actions">
                        {conversation.length > 0 && <button type="button" className="ghost-btn" onClick={onClear}>Nouvelle conversation</button>}
                        <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                    </div>
                </div>

                <div className="agent-thread" aria-live="polite">
                    {!conversation.length && !thinking && (
                        <div className="agent-empty">
                            <p className="muted">Lumières, chauffage, musique, capteurs : demande en français, comme à quelqu’un de la maison.</p>
                            <div className="chips">
                                {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => onAsk(ex)}>{ex}</button>)}
                            </div>
                        </div>
                    )}
                    {conversation.map((turn) => (
                        <div key={turn.id} className={`agent-msg ${turn.role}`}>
                            {turn.content}
                            {turn.escalation && (
                                <a className="agent-escalate" href={turn.escalation} target="_blank" rel="noreferrer">Demander à Claude ↗</a>
                            )}
                        </div>
                    ))}
                    {thinking && <div className="agent-msg assistant typing" aria-label="L'assistant réfléchit"><i /><i /><i /></div>}
                    <div ref={endRef} />
                </div>

                <AgentBar voice={voice} onAsk={onAsk} autoFocus={!conversation.length && !window.matchMedia('(pointer: coarse)').matches} />

                <div className="toggle-row">
                    <div>
                        <div className="toggle-title">Mot d’activation « Hey Jarvis »</div>
                        <div className="muted">{wakeHint}</div>
                    </div>
                    <button type="button" className={`switch ${voice.wakeEnabled ? 'on' : ''}`} aria-pressed={voice.wakeEnabled}
                        aria-label="Mot d’activation" disabled={!voice.supported} onClick={() => voice.setWakeEnabled(!voice.wakeEnabled)}>
                        <span />
                    </button>
                </div>
                {voice.wakeEnabled && voice.supported && (
                    <fieldset className="field wake-sensitivity">
                        <legend>Sensibilité</legend>
                        <div className="chips">
                            {SENSITIVITY_CHOICES.map((c) => (
                                <button key={c.id} type="button" className={voice.sensitivity === c.id ? 'active' : ''}
                                    aria-pressed={voice.sensitivity === c.id} onClick={() => voice.setSensitivity(c.id)}>{c.label}</button>
                            ))}
                        </div>
                        <span className="muted">Se déclenche pour un rien : baisse. Ne t’entend pas de loin : monte.</span>
                    </fieldset>
                )}
            </motion.div>
        </div>
    );
}

/** Téléphone : bouton flottant qui ouvre la conversation. */
export function AgentFab({ voice, onOpen }: { voice: Voice; onOpen: () => void }) {
    const busy = voice.state !== 'idle';
    return (
        <button type="button" className={`agent-fab ${busy ? 'busy' : ''}`} onClick={onOpen} aria-label="Assistant">
            {busy
                ? <span className="wave" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}</span>
                : <Icon name="chat" size={26} strokeWidth={2} />}
        </button>
    );
}
