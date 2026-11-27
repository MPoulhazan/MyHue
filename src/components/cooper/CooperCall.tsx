import { useEffect, useRef, useState } from 'react';
import { endCall } from './callStore';
import type { ActiveCall, CallOutcome, EndedCall } from './callStore';
import './CooperCall.css';

// ── Cooper appelle en visio (tablette murale seulement) ──────────────────────
//
// Sonne 3 fois (sonnerie maison, rien de copié), décroche tout seul ou au toucher, puis la vidéo
// de Cooper tourne en boucle pendant qu'il parle avec la voix de Piper (ralentie : « l'ado blasé »)
// et ses sous-titres. Fin : boîte ouverte (le serveur le voit), « Je le nourris », « Dans 10 min »
// ou « Raccrocher ». Montré par AlertHost, sous les vraies alertes.

const RINGS = 3;
const RING_EVERY_MS = 2_200;
const NUDGE_AT_MS = 20_000; // personne ne réagit : « Ooooh, tu m'entends ? »
const LIVE_MAX_MS = 30_000; // puis il raccroche tout seul (appel manqué, un rappel)
const NUDGE = "Ooooh ! Tu m'entends ? Allô ? Y'a quelqu'un ?";
const END_SHOWN_MS = 7_000;
const VOICE_RATE = 0.92; // plus lent et un peu plus grave : blasé

type Phase = 'ring' | 'live' | 'end';

let audioCtx: AudioContext | null = null;
/** Deux notes douces, deux fois : une sonnerie d'appel bien à nous. */
function ringTone() {
    try {
        audioCtx ??= new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const t = audioCtx.currentTime;
        [[659.25, 0], [880, 0.2], [659.25, 0.55], [880, 0.75]].forEach(([f, d]) => {
            const o = audioCtx!.createOscillator();
            const g = audioCtx!.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + d);
            g.gain.linearRampToValueAtTime(0.35, t + d + 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.4);
            o.connect(g).connect(audioCtx!.destination);
            o.start(t + d);
            o.stop(t + d + 0.45);
        });
    } catch {
        // Pas d'audio : l'écran sonne quand même
    }
}

const voice = (url: string) => {
    const a = new Audio(url);
    a.preload = 'auto';
    a.playbackRate = VOICE_RATE;
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    return a;
};

const mmss = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const TAG: Record<CallOutcome, { text: string; tone: 'ok' | 'bad' }> = {
    fed: { text: 'Repas servi', tone: 'ok' },
    walked: { text: 'Promenade !', tone: 'ok' },
    later: { text: 'Il rappelle dans 10 min', tone: 'bad' },
    hung: { text: 'Appel manqué', tone: 'bad' },
    timeout: { text: 'Appel manqué', tone: 'bad' },
};

const DEMO_END: Record<CallOutcome, string> = {
    fed: 'Ah ben voilà ! Merci, bisous. Je raccroche, je mange.',
    walked: "Ah, enfin. Je prends la laisse, j'arrive.",
    later: "D'accord. Dix minutes. Je compte.",
    hung: 'Tu raccroches ?! Je rappelle dans vingt minutes.',
    timeout: 'Bon. Personne. Je rappelle dans vingt minutes.',
};

export function CooperCall({ call, ended, waiting = 0, demo = false, onClose }: {
    call: ActiveCall;
    /** Fin vue par le serveur (boîte ouverte, porte d'entrée) ou après nos boutons */
    ended: EndedCall | null;
    waiting?: number;
    demo?: boolean;
    onClose: () => void;
}) {
    const [phase, setPhase] = useState<Phase>('ring');
    const [rings, setRings] = useState(1);
    const [liveAt, setLiveAt] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const [shown, setShown] = useState(0); // mots du sous-titre déjà dits
    const [blocked, setBlocked] = useState(false);
    const [noVideo, setNoVideo] = useState(false);
    const [end, setEnd] = useState<{ outcome: CallOutcome; line: string; took: number } | null>(null);
    const [nudged, setNudged] = useState(false);
    const lineAudio = useRef<HTMLAudioElement | null>(null);
    const nudgeAudio = useRef<HTMLAudioElement | null>(null);
    const busy = useRef(false);
    const words = call.line.split(' ');

    function showEnd(outcome: CallOutcome, line: string) {
        lineAudio.current?.pause();
        nudgeAudio.current?.pause();
        setEnd({ outcome, line, took: liveAt ? Date.now() - liveAt : 0 });
        setPhase('end');
    }

    async function finish(outcome: CallOutcome) {
        if (busy.current || phase === 'end') return;
        busy.current = true;
        if (demo) {
            showEnd(outcome, DEMO_END[outcome]);
            return;
        }
        const state = await endCall(call.id, outcome);
        const e = state?.ended?.id === call.id ? state.ended : null;
        showEnd(e?.outcome ?? outcome, e?.line ?? DEMO_END[outcome]);
    }

    function goLive() {
        setLiveAt(Date.now());
        setPhase('live');
    }

    // Voix chargée pendant que ça sonne : elle part dès qu'on décroche
    useEffect(() => {
        if (demo) return;
        const a = voice(`/api/cooper/call/audio?id=${encodeURIComponent(call.id)}&what=line`);
        a.load();
        lineAudio.current = a;
        const n = voice(`/api/cooper/call/audio?id=${encodeURIComponent(call.id)}&what=nudge`);
        n.preload = 'none';
        nudgeAudio.current = n;
        return () => {
            a.pause();
            n.pause();
            lineAudio.current = null;
            nudgeAudio.current = null;
        };
    }, [call.id, demo]);

    // Sonnerie, puis décroché automatique
    useEffect(() => {
        if (phase !== 'ring') return;
        ringTone();
        let n = 1;
        const t = window.setInterval(() => {
            n += 1;
            if (n > RINGS) {
                window.clearInterval(t);
                goLive();
                return;
            }
            setRings(n);
            ringTone();
        }, RING_EVERY_MS);
        return () => window.clearInterval(t);
    }, [phase]);

    // En direct : la voix, les sous-titres au rythme de la voix, l'horloge
    useEffect(() => {
        if (phase !== 'live') return;
        const a = lineAudio.current;
        let fallback = 0;
        const byTimer = () => {
            let i = 0;
            fallback = window.setInterval(() => {
                i += 1;
                setShown(i);
                if (i >= words.length) window.clearInterval(fallback);
            }, 330);
        };
        if (a) {
            a.play().catch(() => {
                setBlocked(true);
                setShown(words.length);
            });
            a.onerror = () => byTimer();
        } else byTimer();
        const tick = window.setInterval(() => {
            setNow(Date.now());
            if (a && a.duration > 0) setShown(a.ended ? words.length : Math.ceil((a.currentTime / a.duration) * words.length));
        }, 200);
        return () => {
            window.clearInterval(tick);
            window.clearInterval(fallback);
        };
    }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

    // Personne ne réagit : « Ooooh, tu m'entends ? » à 20 s, il raccroche à 30 s (appel manqué)
    useEffect(() => {
        if (phase !== 'live') return;
        const nudge = window.setTimeout(() => {
            lineAudio.current?.pause();
            nudgeAudio.current?.play().catch(() => {});
            setNudged(true);
        }, NUDGE_AT_MS);
        const t = window.setTimeout(() => finish('timeout'), LIVE_MAX_MS);
        return () => {
            window.clearTimeout(nudge);
            window.clearTimeout(t);
        };
    }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

    // Le serveur a fini l'appel (boîte ouverte pendant qu'il parle…)
    useEffect(() => {
        // L'état vient du serveur (sondé) : on s'y aligne ici
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (ended && ended.id === call.id && !end) showEnd(ended.outcome, ended.line);
    }, [ended?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fin : sa dernière phrase, puis on rend l'écran
    useEffect(() => {
        if (phase !== 'end') return;
        let closeAt = window.setTimeout(onClose, END_SHOWN_MS);
        if (!demo) {
            const a = voice(`/api/cooper/call/audio?id=${encodeURIComponent(call.id)}&what=end`);
            a.onended = () => {
                window.clearTimeout(closeAt);
                closeAt = window.setTimeout(onClose, 1_500);
            };
            a.play().catch(() => {});
            return () => {
                a.pause();
                window.clearTimeout(closeAt);
            };
        }
        return () => window.clearTimeout(closeAt);
    }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

    const pickUp = () => {
        if (phase === 'ring') goLive();
    };
    const hearIt = () => {
        const a = lineAudio.current;
        if (!a) return;
        a.currentTime = 0;
        a.play().then(() => setBlocked(false)).catch(() => {});
    };

    const why = call.kind === 'walk' ? 'C’est pour la promenade' : call.kind === 'test' ? 'Appel d’essai' : 'Depuis la cuisine, gamelle vide';
    const video = noVideo
        ? <img className="cc-still" src="/cooper.jpg" alt="Cooper" />
        : <video className="cc-main" src="/api/cooper/call/video" muted loop playsInline autoPlay preload="auto" onError={() => setNoVideo(true)} />;

    return (
        <div className="alert-layer cooper-call" role="dialog" aria-modal="true" aria-label="Cooper appelle" onPointerDown={phase === 'ring' ? pickUp : undefined}>
            <div className="cc-bg" aria-hidden="true" />
            {phase === 'ring' && (
                <div className="cc-ring">
                    <div className="cc-avatar" />
                    <div className="cc-who">Cooper</div>
                    <div className="cc-sub">Appel vidéo entrant · {why}</div>
                    <div className="cc-rings">Sonnerie {rings} sur {RINGS} · décroche tout seul</div>
                    <div className="cc-ring-btns">
                        <button type="button" className="cc-round no" onClick={(e) => { e.stopPropagation(); finish('later'); }}>
                            <i>
                                <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 11h-5v-2h3V6h2v7z" /></svg>
                            </i>
                            Dans 10 min
                        </button>
                        <button type="button" className="cc-round ok" onClick={pickUp}>
                            <i>
                                <svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" /></svg>
                            </i>
                            Décrocher
                        </button>
                    </div>
                    {waiting > 0 && <p className="alert-queue">Encore {waiting} alerte{waiting > 1 ? 's' : ''} après</p>}
                </div>
            )}

            {phase !== 'ring' && (
                <div className={`cc-live ${phase === 'end' ? 'over' : ''}`}>
                    {video}
                    <div className="cc-top">
                        <span className="cc-pill"><span className="cc-dot" />En direct · Cooper{call.retry ? ' (rappel)' : ''}</span>
                        <span className="cc-pill">{mmss(now - liveAt)}</span>
                    </div>
                    {call.kind !== 'walk' && (
                        <div className="cc-pip" aria-hidden="true">
                            <svg viewBox="0 0 160 120">
                                <rect width="160" height="120" fill="#3a3128" />
                                <rect y="86" width="160" height="34" fill="#5a4632" />
                                <rect x="38" y="44" width="84" height="50" rx="6" fill="#d7d0c4" />
                                <rect x="38" y="44" width="84" height="12" rx="4" fill="#bfb6a6" />
                                <text x="80" y="80" fontSize="11" textAnchor="middle" fill="#6b5f50" fontFamily="sans-serif">CROQUETTES</text>
                            </svg>
                            <b>Votre caméra : la boîte</b>
                        </div>
                    )}
                    {phase === 'live' && (
                        <>
                            {nudged ? <p className="cc-cap">{NUDGE}</p> : shown > 0 && <p className="cc-cap">{words.slice(0, shown).join(' ')}</p>}
                            {blocked && <button type="button" className="cc-hear" onClick={hearIt}>Touchez pour entendre Cooper</button>}
                            <div className="cc-bar">
                                {call.kind !== 'test' && <button type="button" className="cc-btn later" onClick={() => finish('later')}>Dans 10 min</button>}
                                {call.kind === 'walk'
                                    ? <button type="button" className="cc-btn feed" onClick={() => finish('walked')}>On sort !</button>
                                    : <button type="button" className="cc-btn feed" onClick={() => finish('fed')}>{call.kind === 'test' ? 'Je le nourris (essai)' : 'Je le nourris'}</button>}
                                <button type="button" className="cc-btn hang" onClick={() => finish('hung')}>Raccrocher</button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {phase === 'end' && end && (
                <div className="cc-end">
                    <div className="cc-avatar still" />
                    <div className="cc-end-text">
                        <span className="cc-end-k">Appel terminé · {mmss(end.took)}</span>
                        <p className="cc-end-q">« {end.line} »</p>
                        <span className={`cc-tag ${TAG[end.outcome].tone}`}>{call.kind === 'test' ? 'Essai terminé' : TAG[end.outcome].text}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
