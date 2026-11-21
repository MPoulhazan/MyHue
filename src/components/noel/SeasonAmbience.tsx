import { useMemo } from 'react';
import { createSharedPoll } from '../../hooks/sharedPoll';
import './Noel.css';

interface Ambience { on: boolean; snow: number; code: number | null; preview?: boolean }

// ?snowdemo=1 : aperçu de la neige, même hors saison
const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('snowdemo') === '1';
const ambiencePoll = createSharedPoll<Ambience>(demo ? '/api/christmas/ambience?snow=1' : '/api/christmas/ambience', 5 * 60_000);

/**
 * Ambiance de la saison, de fin novembre au 31 décembre : un mince fil de guirlande en haut
 * de l'écran, et de la neige qui tombe quand il neige vraiment dehors (plus ou moins selon l'intensité).
 */
export function SeasonAmbience() {
    const amb = ambiencePoll.use();
    const count = amb?.on ? Math.round(70 * (amb.snow || 0)) : 0;
    const flakes = useMemo(() => Array.from({ length: count }, (_, i) => ({
        left: (i * 41 + 7) % 100,
        delay: (i * 0.83) % 14,
        dur: 12 + ((i * 2.3) % 10),
        size: 2 + (i % 5),
        drift: ((i % 7) - 3) * 12,
        opacity: 0.25 + (i % 4) * 0.1,
    })), [count]);

    if (!amb?.on) return null;
    return (
        <>
            <div className="season-garland" aria-hidden="true" />
            {count > 0 && (
                <div className="season-snow" aria-hidden="true">
                    {flakes.map((f, i) => (
                        <span key={i} className="season-flake" style={{
                            left: `${f.left}%`, width: f.size, height: f.size, opacity: f.opacity,
                            animationDelay: `-${f.delay}s`, animationDuration: `${f.dur}s`,
                            ['--drift' as string]: `${f.drift}px`,
                        }} />
                    ))}
                </div>
            )}
        </>
    );
}
