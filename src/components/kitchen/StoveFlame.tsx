import { useEffect, useRef, useState } from 'react';
import './StoveFlame.css';

// ── Cuisinière sur l'écran de la cuisine ─────────────────────────────────────
//
// Une casserole sur une petite flamme tant que la hotte chauffe (server/stove.js).
// Quand elle refroidit, la flamme s'éteint (petit filet de fumée), puis tout disparaît.

const POLL_MS = 15_000;
/** Durée de l'animation d'extinction avant de retirer le bloc */
const OUT_MS = 5_000;

type Phase = 'hidden' | 'on' | 'out';

const minutes = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60_000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

export function StoveFlame() {
    const [phase, setPhase] = useState<Phase>('hidden');
    const [since, setSince] = useState<number | null>(null);
    const [, tick] = useState(0);
    const phaseRef = useRef<Phase>('hidden');
    phaseRef.current = phase;

    useEffect(() => {
        let alive = true;
        let outTimer: number | undefined;
        const load = () =>
            fetch('/api/stove')
                .then((r) => (r.ok ? r.json() : null))
                .then((d: { found?: boolean; on?: boolean; since?: number | null } | null) => {
                    if (!alive || !d) return;
                    if (d.found && d.on) {
                        window.clearTimeout(outTimer);
                        setSince(d.since ?? null);
                        setPhase('on');
                    } else if (phaseRef.current === 'on') {
                        setPhase('out');
                        outTimer = window.setTimeout(() => alive && setPhase('hidden'), OUT_MS);
                    }
                })
                .catch(() => {});
        load();
        const t = window.setInterval(load, POLL_MS);
        const clock = window.setInterval(() => tick((n) => n + 1), 30_000);
        return () => {
            alive = false;
            window.clearInterval(t);
            window.clearInterval(clock);
            window.clearTimeout(outTimer);
        };
    }, []);

    if (phase === 'hidden') return null;
    const on = phase === 'on';

    return (
        <div className={`stove-flame ${on ? 'is-on' : 'is-out'}`} role="status" aria-live="polite">
            <svg viewBox="0 0 120 110" className="stove-flame-art" aria-hidden="true">
                {/* Vapeur au-dessus de la casserole */}
                <g className="sf-steam">
                    <path d="M44 30 q-6 -8 0 -16 q6 -8 0 -16" />
                    <path d="M60 28 q-6 -8 0 -16 q6 -8 0 -16" />
                    <path d="M76 30 q-6 -8 0 -16 q6 -8 0 -16" />
                </g>
                {/* Casserole */}
                <rect className="sf-pot" x="28" y="38" width="64" height="38" rx="7" />
                <rect className="sf-rim" x="24" y="34" width="72" height="7" rx="3.5" />
                <rect className="sf-handle" x="96" y="44" width="20" height="6" rx="3" />
                {/* Grille du brûleur */}
                <rect className="sf-grate" x="20" y="80" width="80" height="4" rx="2" />
                {/* Flammes */}
                <g className="sf-flames">
                    <path className="sf-f sf-f1" d="M42 100 c-6 -6 -4 -12 0 -16 c1 5 6 6 6 11 c0 3 -3 5 -6 5z" />
                    <path className="sf-f sf-f2" d="M60 101 c-8 -7 -5 -15 0 -20 c1 6 8 8 8 14 c0 4 -4 6 -8 6z" />
                    <path className="sf-f sf-f3" d="M78 100 c-6 -6 -4 -12 0 -16 c1 5 6 6 6 11 c0 3 -3 5 -6 5z" />
                </g>
                {/* Fumée quand la flamme s'éteint */}
                <g className="sf-smoke">
                    <path d="M60 98 q-5 -6 0 -11 q5 -5 0 -10" />
                </g>
                <rect className="sf-burner" x="34" y="101" width="52" height="5" rx="2.5" />
            </svg>
            <div className="stove-flame-text">
                <strong>{on ? 'Ça chauffe' : 'Éteinte'}</strong>
                <span>{on ? (since ? `depuis ${minutes(Date.now() - since)}` : 'cuisinière allumée') : 'la hotte refroidit'}</span>
            </div>
        </div>
    );
}
