import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import axios from 'axios';
import { entrancePoll } from '../home/widgets/polls';
import type { EntranceView } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import { Icon } from '../Icon';
import './EntranceCard.css';

const mmss = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Fin de la minuterie sur l'horloge de l'écran, à partir du temps restant vu par le Pi. */
function useLeft(view: EntranceView | null) {
    const [now, setNow] = useState(Date.now);
    const running = Boolean(view?.offAt && view.lit && !view.manual);
    // Relu à chaque lecture du Pi : l'écart entre les deux horloges ne compte pas
    const base = useMemo(
        // eslint-disable-next-line react-hooks/purity
        () => (running && view?.offAt ? { endsAt: Date.now() + (view.offAt - view.now), total: (view.offTotalSec ?? view.offAfterSec) * 1000 } : null),
        [running, view?.offAt, view?.now, view?.offTotalSec, view?.offAfterSec],
    );
    useEffect(() => {
        if (!base) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [base]);
    if (!base) return null;
    return { left: Math.max(0, base.endsAt - now), total: base.total };
}

/**
 * Carte « Entrée » de l'accueil : tant que la lampe est allumée, le temps avant qu'elle
 * s'éteigne (le même anneau que sur sa tuile), garder allumée ou éteindre.
 */
export function EntranceCard() {
    const view = entrancePoll.use();
    const timer = useLeft(view);
    const [busy, setBusy] = useState(false);
    if (!view || !(view.lit || view.manual)) return null;

    const act = async (action: 'hold' | 'off') => {
        setBusy(true);
        try {
            const { data } = await axios.post<EntranceView>(`/api/entrance-light/${action}`);
            entrancePoll.publish(data);
        } catch {
            entrancePoll.load();
        } finally {
            setBusy(false);
        }
    };

    const longMin = Math.round(view.longOffAfterSec / 60);
    const ending = timer != null && timer.left <= 15_000;
    const pill = view.manual
        ? <StatusPill level="info">Sans minuterie</StatusPill>
        : view.long ? <StatusPill level="ok">Quelqu’un en bas</StatusPill> : <StatusPill level="off">Passage</StatusPill>;
    const line = view.manual
        ? 'Allumée à la main : elle reste allumée jusqu’à ce qu’on l’éteigne.'
        : view.long
            ? `Chaque mouvement relance ${longMin} min.`
            : `Vue une 2ᵉ fois par le détecteur, elle reste ${longMin} min.`;

    return (
        <WidgetCard className="entrance-card" label="Lampe de l’entrée" title="Entrée" pills={pill}
            detail={{
                title: 'Lampe de l’entrée',
                body: <p className="lead">Elle s’allume quand la porte s’ouvre ou que le détecteur de l’escalier voit quelqu’un, et s’éteint {Math.round(view.offAfterSec / 60)} min après. Si le détecteur la revoit pendant qu’elle est allumée, quelqu’un est resté en bas (lessive, chaussures) : elle tient {longMin} min, relancées à chaque mouvement. « Garder allumée » coupe la minuterie jusqu’à ce qu’on l’éteigne.</p>,
            }}>
            <div className={`entrance-body ${ending ? 'ending' : ''}`}>
                <span className="entrance-dial">
                    {timer && <span className="entrance-ring" aria-hidden="true" style={{ '--p': Math.min(1, timer.left / timer.total) } as CSSProperties} />}
                    <span className="entrance-dial-in">
                        {timer ? <b className="entrance-left">{mmss(timer.left)}</b> : <Icon name="lights" size={26} strokeWidth={2} />}
                    </span>
                </span>
                <div className="entrance-text">
                    <b>{view.manual ? 'Allumée' : timer ? `S’éteint dans ${mmss(timer.left)}` : 'Allumée'}</b>
                    <span className="muted">{line}</span>
                </div>
            </div>
            <div className="entrance-actions">
                {!view.manual && <button type="button" className="entrance-btn" disabled={busy} onClick={() => act('hold')}>Garder allumée</button>}
                <button type="button" className="entrance-btn off" disabled={busy} onClick={() => act('off')}>Éteindre</button>
            </div>
        </WidgetCard>
    );
}
