import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { adventPoll } from '../home/widgets/polls';
import type { AdventDay } from './types';
import './Advent.css';

const SEEN_KEY = 'myhue.advent.seen';
/** La case ouverte depuis moins longtemps que ça s'affiche sur les écrans qui ne l'ont pas vue */
const FRESH_MS = 3 * 60_000;
/** L'écran se referme seul : le temps d'une chanson, une minute pour le reste */
const CLOSE_MS = { song: 3.5 * 60_000, other: 60_000 };

const readSeen = () => {
    try {
        return localStorage.getItem(SEEN_KEY);
    } catch {
        return null;
    }
};
const writeSeen = (v: string) => {
    try {
        localStorage.setItem(SEEN_KEY, v);
    } catch {
        // sans stockage, l'écran se montre une fois par chargement
    }
};

/**
 * La case du jour en plein écran, dès qu'elle est ouverte (ici, sur un autre écran ou à la voix).
 * Une fois par écran : le marqueur est gardé dans le navigateur.
 */
export function AdventReveal() {
    const view = adventPoll.use();
    const navigate = useNavigate();
    const [seen, setSeen] = useState(readSeen);
    const day: AdventDay | null = view?.today ? view.days[view.today - 1] : null;
    const key = day && view?.season ? `${view.season.year}-${day.n}` : null;
    const show = Boolean(day?.openedAt && key && seen !== key && Date.now() - (day.openedAt ?? 0) < FRESH_MS);

    const close = () => {
        if (!key) return;
        writeSeen(key);
        setSeen(key);
    };

    useEffect(() => {
        if (!show || !day) return;
        const t = window.setTimeout(close, day.kind === 'song' ? CLOSE_MS.song : CLOSE_MS.other);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [show, day?.n]);

    // Quelques flocons, placés une fois pour toutes
    const flakes = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i * 0.73) % 9,
        dur: 9 + ((i * 1.7) % 7),
        size: 3 + (i % 4) * 1.5,
    })), []);

    return (
        <AnimatePresence>
            {show && day && (
                <motion.div className="advent-reveal" role="dialog" aria-modal="true" aria-label={`Case ${day.n} du calendrier de l’Avent`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
                    {flakes.map((f, i) => (
                        <span key={i} className="advent-flake" aria-hidden="true"
                            style={{ left: `${f.left}%`, width: f.size, height: f.size, animationDelay: `-${f.delay}s`, animationDuration: `${f.dur}s` }} />
                    ))}
                    <motion.div className="advent-reveal-card" onClick={(e) => e.stopPropagation()}
                        initial={{ scale: 0.85, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
                        <div className="advent-reveal-num">{day.n}</div>
                        <span className="advent-kind">{day.kind === 'song' ? 'Chanson du jour' : day.label}</span>
                        <h1>{day.title}</h1>
                        {day.photo && <img className="advent-photo" src={day.photo} alt="Cooper" />}
                        <p>{day.body}</p>
                        <div className="advent-reveal-actions">
                            <button type="button" className="advent-ghost" onClick={() => { close(); navigate('/avent'); }}>Voir le calendrier</button>
                            <button type="button" className="advent-primary" onClick={close}>Fermer</button>
                        </div>
                        {day.kind === 'song' && <p className="advent-hint">L’écran se referme seul après la chanson.</p>}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
