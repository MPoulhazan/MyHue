import { useRef } from 'react';
import { Icon, type IconName } from './Icon';
import type { Moment } from '../hooks/useHome';

const LONG_PRESS_MS = 600;

/**
 * Bouton de teinte (Neutre, Chaud, Très chaud, Aléatoire).
 * Aléatoire : appui court = une palette répartie sur les lampes, appui long = une seule couleur partout.
 */
export function MomentButton({ moment, onRun, className, iconSize = 20 }: {
    moment: Moment;
    onRun: (id: string, opts?: { same?: boolean }) => void;
    className?: string;
    iconSize?: number;
}) {
    const timer = useRef<number | null>(null);
    const longDone = useRef(false);
    const random = moment.id === 'aleatoire';

    const clear = () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
    };

    return (
        <button type="button" className={className} style={{ userSelect: 'none', WebkitTouchCallout: 'none' }}
            title={random ? 'Appui long : une seule couleur partout' : undefined}
            onPointerDown={() => {
                if (!random) return;
                longDone.current = false;
                clear();
                timer.current = window.setTimeout(() => {
                    longDone.current = true;
                    onRun(moment.id, { same: true });
                }, LONG_PRESS_MS);
            }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            onContextMenu={(e) => random && e.preventDefault()}
            onClick={() => {
                if (longDone.current) {
                    longDone.current = false;
                    return;
                }
                onRun(moment.id);
            }}>
            <Icon name={moment.icon as IconName} size={iconSize} />{moment.label}
        </button>
    );
}
