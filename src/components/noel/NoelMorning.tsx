import { useMemo, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { noelPoll } from '../home/widgets/polls';
import '../advent/Advent.css';
import './Noel.css';

export interface NoelView {
    morning: boolean;
    fired: boolean;
    active: boolean;
    firedAt: number | null;
    endsAt: number | null;
    cooper: string;
    photo: string;
}

const CLOSED_KEY = 'myhue.noel.closed';
const readClosed = () => {
    try {
        return localStorage.getItem(CLOSED_KEY);
    } catch {
        return null;
    }
};
const writeClosed = (v: string) => {
    try {
        localStorage.setItem(CLOSED_KEY, v);
    } catch {
        // sans stockage, l'écran se referme seul à la fin de la magie
    }
};

/**
 * « Il est passé ! » en plein écran, le matin du 25, pendant les 5 min de la magie.
 * Le Pi la déclenche au premier mouvement ; l'écran se referme quand elle finit.
 */
export function NoelMorning() {
    const view = noelPoll.use();
    const [closed, setClosed] = useState(readClosed);
    const key = view?.firedAt ? String(view.firedAt) : null;
    const show = Boolean(view?.active && key && closed !== key);

    const close = () => {
        if (!key) return;
        writeClosed(key);
        setClosed(key);
    };
    const backToNormal = async () => {
        close();
        try {
            const { data } = await axios.post<NoelView>('/api/noel/end');
            noelPoll.publish(data);
        } catch {
            noelPoll.load();
        }
    };

    const flakes = useMemo(() => Array.from({ length: 48 }, (_, i) => ({
        left: (i * 29) % 100,
        delay: (i * 0.61) % 9,
        dur: 8 + ((i * 1.3) % 7),
        size: 3 + (i % 4) * 1.5,
        gold: i % 5 === 0,
    })), []);

    return (
        <AnimatePresence>
            {show && view && (
                <motion.div className="advent-reveal noel-reveal" role="dialog" aria-modal="true" aria-label="Il est passé !"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
                    {flakes.map((f, i) => (
                        <span key={i} className={`advent-flake ${f.gold ? 'noel-gold' : ''}`} aria-hidden="true"
                            style={{ left: `${f.left}%`, width: f.size, height: f.size, animationDelay: `-${f.delay}s`, animationDuration: `${f.dur}s` }} />
                    ))}
                    <motion.div className="advent-reveal-card noel-card" onClick={(e) => e.stopPropagation()}
                        initial={{ scale: 0.8, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 20 }}>
                        <span className="advent-kind">25 décembre</span>
                        <h1 className="noel-title">Il est passé&nbsp;!</h1>
                        <p>Joyeux Noël. Les cadeaux sont sous le sapin.</p>
                        <img className="advent-photo" src={view.photo} alt="Cooper" />
                        <p className="noel-cooper">{view.cooper}</p>
                        <div className="advent-reveal-actions">
                            <button type="button" className="advent-ghost" onClick={backToNormal}>Remettre la maison normale</button>
                            <button type="button" className="advent-primary" onClick={close}>Fermer</button>
                        </div>
                        <p className="advent-hint">Le salon redevient normal dans quelques minutes.</p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
