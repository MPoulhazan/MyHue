import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { entrancePoll } from '../home/widgets/polls';

export interface RoomTimer {
    /** Minuterie du détecteur en cours : l'anneau autour du bouton se vide jusqu'à l'extinction */
    ring: { key: number; style: CSSProperties } | null;
    /** Ligne du bas de la carte à la place du texte habituel */
    sub: string | null;
}

/**
 * Minuterie de la lampe de l'entrée vue par une carte de pièce : rien si la pièce ne contient pas
 * cette lampe. L'anneau est une animation CSS (durée totale, décalée du temps déjà écoulé), relancée
 * seulement quand le Pi repousse l'extinction.
 */
export function useRoomTimer(lightIds: string[], lit: boolean): RoomTimer {
    const view = entrancePoll.use();
    const mine = Boolean(lit && view?.lightId && lightIds.includes(String(view.lightId)));
    const running = Boolean(mine && view?.lit && !view.manual && view.offAt);
    const offAt = running ? view!.offAt : null;
    // Figé à la première lecture de cette fin d'extinction : l'animation ne saute pas à chaque relecture
    const ring = useMemo(() => {
        if (!offAt || !view) return null;
        const total = (view.offTotalSec ?? view.offAfterSec) * 1000;
        const left = Math.max(0, offAt - view.now);
        return { key: offAt, style: { '--dur': `${total}ms`, '--delay': `${left - total}ms` } as CSSProperties };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offAt]);

    if (!mine || !view) return { ring: null, sub: null };
    if (view.manual) return { ring: null, sub: 'Allumée · sans minuterie' };
    if (!ring) return { ring: null, sub: null };
    return { ring, sub: view.long ? 'Quelqu’un en bas' : 'S’éteint toute seule' };
}
