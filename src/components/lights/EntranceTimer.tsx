import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { entrancePoll } from '../home/widgets/polls';

const mmss = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Bas d'une carte de pièce allumée. Si la pièce contient la lampe de l'entrée et que sa minuterie
 * tourne : le temps avant l'extinction et une barre qui se vide ; sinon le texte habituel.
 */
export function RoomTimerSub({ lightIds, sub }: { lightIds: string[]; sub: string }) {
    const view = entrancePoll.use();
    const mine = Boolean(view?.lightId && lightIds.includes(String(view.lightId)));
    const running = Boolean(mine && view?.lit && !view.manual && view.offAt);
    // Relu à chaque lecture du Pi : compté sur l'horloge de l'écran, l'écart entre les deux ne compte pas
    const base = useMemo(
        // eslint-disable-next-line react-hooks/purity
        () => (running && view?.offAt ? { endsAt: Date.now() + (view.offAt - view.now), total: (view.offTotalSec ?? view.offAfterSec) * 1000 } : null),
        [running, view?.offAt, view?.now, view?.offTotalSec, view?.offAfterSec],
    );
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!base) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [base]);

    if (mine && view?.manual) return <span className="room-sub">Allumée · sans minuterie</span>;
    if (!base) return <span className="room-sub">{sub}</span>;
    const left = Math.max(0, base.endsAt - now);
    const ending = left <= 15_000;
    return (
        <>
            <span className={`room-sub room-timer ${ending ? 'ending' : ''}`} title="S’éteint toute seule (détecteur)">
                S’éteint dans <b>{mmss(left)}</b>{view?.long ? ' · quelqu’un en bas' : ''}
            </span>
            <span className={`room-timer-bar ${ending ? 'ending' : ''}`} aria-hidden="true" style={{ '--p': Math.min(1, left / base.total) } as CSSProperties} />
        </>
    );
}
