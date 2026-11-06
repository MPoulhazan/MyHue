import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

// ── Données de /api/city (server/city.js) ────────────────────────────────────

export type Level = 'danger' | 'heads' | 'info';
export interface CityEvent {
    id: string;
    level: Level;
    kind: string;
    title: string;
    detail: string;
    advice: string;
    start: number | null;
    end: number | null;
    source: string;
    link: string | null;
    when: string;
    bucket: 'now' | 'today' | 'tomorrow' | 'weekend' | 'later';
}
export interface CityView {
    enabled: boolean;
    updatedAt: number | null;
    events: CityEvent[];
    takeover: (CityEvent & { lamp: 'ice' | 'alert' | null }) | null;
}

// Une seule lecture partagée par la carte et l'écran d'alerte
let shared: CityView | null = null;
const listeners = new Set<(v: CityView) => void>();
const publish = (v: CityView) => {
    shared = v;
    listeners.forEach((fn) => fn(v));
};
let timer: ReturnType<typeof setInterval> | null = null;
const load = () => axios.get('/api/city').then(({ data }) => publish(data)).catch(() => {});

export function useCity() {
    const [view, setView] = useState<CityView | null>(shared);
    useEffect(() => {
        listeners.add(setView);
        if (!timer) {
            load();
            timer = setInterval(load, 60_000);
        }
        return () => {
            listeners.delete(setView);
            if (!listeners.size && timer) {
                clearInterval(timer);
                timer = null;
            }
        };
    }, []);
    const ack = useCallback((id: string) => axios.post('/api/city/ack', { id }).then(({ data }) => publish(data)).catch(load), []);
    return { view, ack };
}
