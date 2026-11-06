import { useEffect, useState } from 'react';
import axios from 'axios';

/**
 * Une lecture d'API partagée par tous les composants qui la demandent : une seule
 * requête par intervalle, même si la carte et le registre des widgets lisent la même chose.
 */
export function createSharedPoll<T>(url: string, everyMs: number) {
    let value: T | null = null;
    const listeners = new Set<(v: T | null) => void>();
    let timer: ReturnType<typeof setInterval> | null = null;

    const publish = (v: T) => {
        value = v;
        listeners.forEach((fn) => fn(v));
    };
    const load = () => axios.get(url).then(({ data }) => publish(data)).catch(() => {});

    function use() {
        const [v, setV] = useState<T | null>(value);
        useEffect(() => {
            listeners.add(setV);
            setV(value);
            if (!timer) {
                load();
                timer = setInterval(load, everyMs);
            }
            return () => {
                listeners.delete(setV);
                if (!listeners.size && timer) {
                    clearInterval(timer);
                    timer = null;
                }
            };
        }, []);
        return v;
    }

    return { use, load, publish };
}
