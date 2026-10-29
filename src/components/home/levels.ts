import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import type { DashLight } from '../../hooks/useHome';

// Réglage d'intensité partagé par les cartes de pièce et l'écran Lumières

export const avgLevel = (lights: DashLight[]) => {
    const on = lights.filter((l) => l.reachable && l.level > 0);
    return on.length ? Math.round(on.reduce((a, l) => a + l.level, 0) / on.length) : 0;
};

/** Tuile réglable : toucher = onTap, glisser horizontalement = intensité (pas de 5 %). */
export function useLevelGesture(level: number, onLevel: (v: number) => void, onTap: () => void) {
    const gesture = useRef<{ x: number; base: number; moved: boolean; width: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const handlers = {
        onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
            if ((e.target as HTMLElement).closest('button')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture.current = { x: e.clientX, base: level, moved: false, width: e.currentTarget.clientWidth };
        },
        onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
            const g = gesture.current;
            if (!g) return;
            const dx = e.clientX - g.x;
            if (!g.moved && Math.abs(dx) < 10) return;
            if (!g.moved) {
                g.moved = true;
                setDragging(true);
            }
            const v = Math.round(Math.max(0, Math.min(100, g.base + (dx / g.width) * 100)) / 5) * 5;
            onLevel(v);
        },
        onPointerUp: () => {
            const g = gesture.current;
            gesture.current = null;
            setDragging(false);
            if (g && !g.moved) onTap();
        },
        onPointerCancel: () => {
            gesture.current = null;
            setDragging(false);
        },
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTap();
            }
            if (e.key === 'ArrowRight') onLevel(Math.min(100, level + 10));
            if (e.key === 'ArrowLeft') onLevel(Math.max(0, level - 10));
        },
    };

    return { dragging, handlers };
}

/** Dernière intensité non nulle, pour rallumer au même niveau. */
export function useLastLevel(level: number) {
    const last = useRef(level || 70);
    useEffect(() => {
        if (level) last.current = level;
    }, [level]);
    return last;
}
