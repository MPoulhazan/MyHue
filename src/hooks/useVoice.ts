import { useCallback, useEffect, useRef, useState } from 'react';
import type { WakeListener } from '../voice/wakeListener';

// Conversation vocale : (mot d'activation) → bip → reconnaissance (Web Speech)
// → agent → réponse lue à voix haute (speechSynthesis).

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type WakeStatus = 'off' | 'loading' | 'on' | 'needs-tap' | 'error';

const WAKE_KEY = 'myhue.wakeword';

// Web Speech API : pas encore dans les types DOM de TypeScript
interface Recognition {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onerror: (e: { error: string }) => void;
    onend: () => void;
    start: () => void;
}
type SpeechWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const SR = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;

const readWakePref = () => {
    try {
        return localStorage.getItem(WAKE_KEY) === '1';
    } catch {
        return false;
    }
};

const beep = () => {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
        osc.onended = () => ctx.close();
    } catch {
        // pas de son, tant pis
    }
};

const speak = (text: string) =>
    new Promise<void>((resolve) => {
        const synth = window.speechSynthesis;
        if (!synth || !text) return resolve();
        const utter = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, ''));
        utter.lang = 'fr-FR';
        const voice = synth.getVoices().find((v) => v.lang.startsWith('fr'));
        if (voice) utter.voice = voice;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        synth.cancel();
        synth.speak(utter);
    });

// Codes d'erreur Web Speech → message affiché dans la barre
const RECOGNITION_ERRORS: Record<string, string> = {
    'not-allowed': 'Micro refusé : autorise-le dans le navigateur',
    'service-not-allowed': 'Micro refusé : autorise-le dans le navigateur',
    'audio-capture': 'Aucun micro détecté',
    network: 'Service de reconnaissance injoignable (Chrome ou Edge requis)',
    'no-speech': 'Je n’ai rien entendu',
    'language-not-supported': 'Français non pris en charge par ce navigateur',
};

const recognize = () =>
    new Promise<{ text: string | null; error: string | null }>((resolve) => {
        if (!SR) return resolve({ text: null, error: null });
        const rec = new SR();
        rec.lang = 'fr-FR';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        let text: string | null = null;
        let error: string | null = null;
        rec.onresult = (e) => {
            text = e.results[0][0].transcript;
        };
        rec.onerror = (e) => {
            if (e.error !== 'aborted') error = RECOGNITION_ERRORS[e.error] || `Erreur micro : ${e.error}`;
        };
        rec.onend = () => resolve({ text, error });
        try {
            rec.start();
        } catch (e) {
            resolve({ text: null, error: `Erreur micro : ${(e as Error).message}` });
        }
    });

export function useVoice(onCommand: (text: string) => Promise<string | undefined>) {
    const [state, setState] = useState<VoiceState>('idle');
    const [wakeEnabled, setWakeEnabledState] = useState(readWakePref);
    const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off');
    const [wakeError, setWakeError] = useState<string | null>(null);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const listenerRef = useRef<WakeListener | null>(null);
    const busyRef = useRef(false);
    const onCommandRef = useRef(onCommand);
    onCommandRef.current = onCommand;

    const secure = window.isSecureContext;
    const supported = Boolean(SR) && secure;

    const converse = useCallback(async () => {
        if (!SR || busyRef.current) return;
        busyRef.current = true;
        // Libère le micro pour la reconnaissance vocale
        const listener = listenerRef.current;
        listener?.stop();
        try {
            setVoiceError(null);
            setState('listening');
            const { text, error } = await recognize();
            if (error) setVoiceError(error);
            if (text) {
                setState('thinking');
                const reply = await onCommandRef.current(text);
                if (reply) {
                    setState('speaking');
                    await speak(reply);
                }
            }
        } finally {
            setState('idle');
            busyRef.current = false;
            if (listener && listenerRef.current === listener) {
                listener.start().catch(() => setWakeStatus('error'));
            }
        }
    }, []);

    const setWakeEnabled = useCallback((on: boolean) => {
        try {
            localStorage.setItem(WAKE_KEY, on ? '1' : '0');
        } catch {
            // préférence non mémorisée
        }
        setWakeEnabledState(on);
    }, []);

    useEffect(() => {
        if (!wakeEnabled || !supported) {
            setWakeStatus('off');
            return;
        }
        let cancelled = false;
        let listener: WakeListener | null = null;
        const onTap = async () => {
            await listener?.resume();
            if (cancelled) return;
            if (listener?.running) setWakeStatus('on');
            else document.addEventListener('pointerdown', onTap, { once: true });
        };
        setWakeStatus('loading');
        setWakeError(null);
        // Chargé à la demande : onnxruntime + modèles ne pèsent que si activé
        import('../voice/wakeListener')
            .then(async ({ WakeListener }) => {
                if (cancelled) return;
                listener = new WakeListener(() => {
                    beep();
                    converse();
                });
                listenerRef.current = listener;
                const running = await listener.start();
                if (cancelled) return;
                if (running) {
                    setWakeStatus('on');
                } else {
                    setWakeStatus('needs-tap');
                    document.addEventListener('pointerdown', onTap, { once: true });
                }
            })
            .catch((error) => {
                if (cancelled) return;
                setWakeStatus('error');
                setWakeError(error?.message || String(error));
            });
        return () => {
            cancelled = true;
            document.removeEventListener('pointerdown', onTap);
            listener?.stop();
            listenerRef.current = null;
        };
    }, [wakeEnabled, supported, converse]);

    return {
        state,
        converse,
        supported,
        secure,
        wakeEnabled,
        setWakeEnabled,
        wakeStatus,
        wakeError,
        voiceError,
    };
}
