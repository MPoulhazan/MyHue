import { useCallback, useEffect, useRef, useState } from 'react';
import type { WakeListener, Sensitivity } from '../voice/wakeListener';

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
    onstart: () => void;
    onaudiostart: () => void;
    onspeechstart: () => void;
    start: () => void;
}
type SpeechWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const SR = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;

// Sensibilité par appareil : chaque micro capte différemment
const SENSITIVITY_KEY = 'myhue.wakeword.sensitivity';
const readSensitivity = (): Sensitivity => {
    try {
        const v = localStorage.getItem(SENSITIVITY_KEY);
        return v === 'low' || v === 'high' ? v : 'normal';
    } catch {
        return 'normal';
    }
};

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

// Chrome charge la liste des voix en différé : vide au premier appel
const loadVoices = () =>
    new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const synth = window.speechSynthesis;
        const now = synth.getVoices();
        if (now.length) return resolve(now);
        const done = () => resolve(synth.getVoices());
        synth.addEventListener('voiceschanged', done, { once: true });
        setTimeout(done, 1500);
    });

/** Meilleure voix française : neuronale ou en ligne d'abord, les voix système basiques en dernier. */
const pickVoice = (voices: SpeechSynthesisVoice[]) => {
    const score = (v: SpeechSynthesisVoice) =>
        (/natural|neural|online|premium|enhanced|wavenet/i.test(v.name) ? 4 : 0) +
        (/google/i.test(v.name) ? 2 : 0) +
        (!v.localService ? 1 : 0) +
        (v.lang === 'fr-CA' || v.lang === 'fr-FR' ? 1 : 0);
    return voices.filter((v) => v.lang.startsWith('fr')).sort((a, b) => score(b) - score(a))[0];
};

const speak = (text: string) =>
    new Promise<void>((resolve) => {
        const synth = window.speechSynthesis;
        if (!synth || !text) return resolve();
        resolve(loadVoices().then((voices) => say(synth, text, pickVoice(voices))));
    });

const say = (synth: SpeechSynthesis, text: string, voice?: SpeechSynthesisVoice) =>
    new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, ''));
        utter.lang = voice?.lang ?? 'fr-FR';
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

const recognize = (trace: (step: string) => void) =>
    new Promise<{ text: string | null; error: string | null }>((resolve) => {
        if (!SR) return resolve({ text: null, error: null });
        const rec = new SR();
        rec.lang = 'fr-FR';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        let text: string | null = null;
        let error: string | null = null;
        rec.onstart = () => trace('start');
        rec.onaudiostart = () => trace('micro');
        rec.onspeechstart = () => trace('parole');
        rec.onresult = (e) => {
            text = e.results[0][0].transcript;
            trace(`« ${text} »`);
        };
        rec.onerror = (e) => {
            trace(`erreur ${e.error}`);
            if (e.error !== 'aborted') error = RECOGNITION_ERRORS[e.error] || `Erreur micro : ${e.error}`;
        };
        rec.onend = () => {
            trace('fin');
            resolve({ text, error });
        };
        try {
            rec.start();
        } catch (e) {
            resolve({ text: null, error: `Erreur micro : ${(e as Error).message}` });
        }
    });

export function useVoice(onCommand: (text: string) => Promise<string | undefined>) {
    const [state, setState] = useState<VoiceState>('idle');
    const [wakeEnabled, setWakeEnabledState] = useState(readWakePref);
    const [sensitivity, setSensitivityState] = useState<Sensitivity>(readSensitivity);
    const sensitivityRef = useRef(sensitivity);
    const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off');
    const [wakeError, setWakeError] = useState<string | null>(null);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [trace, setTrace] = useState<string[]>([]);
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
            setTrace([]);
            const { text, error } = await recognize((step) => setTrace((t) => [...t, step]));
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

    // Appliquée tout de suite à l'écoute en cours, sans recharger le modèle
    const setSensitivity = useCallback((level: Sensitivity) => {
        try {
            localStorage.setItem(SENSITIVITY_KEY, level);
        } catch {
            // préférence non mémorisée
        }
        sensitivityRef.current = level;
        if (listenerRef.current) listenerRef.current.sensitivity = level;
        setSensitivityState(level);
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
                }, sensitivityRef.current);
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
        sensitivity,
        setSensitivity,
        wakeStatus,
        wakeError,
        voiceError,
        trace,
        listenerRef,
    };
}
