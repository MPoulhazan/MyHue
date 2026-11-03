import { useEffect, useState } from 'react';
import axios from 'axios';

// ── Données de /api/sky (server/astro.js) ────────────────────────────────────

export type Level = 'excellent' | 'good' | 'fair' | 'poor' | 'bad' | 'moon';
export interface SkyHour { ts: number; sky: 'day' | 'twilight' | 'night'; cloud: number | null; moonUp: boolean; score: number }
export interface SkyEvent { type: 'shower' | 'eclipse' | 'fullmoon'; ts: number; title: string; level: Level; label: string; night?: string; zhr?: number }
export interface Planet { id: string; name: string; mag: number; from: number | null; bestTs: number; alt: number; dir: string }
export interface Aurora {
    level: 'alert' | 'cloudy' | 'watch' | 'calm';
    label: string;
    maxTonight: number;
    max: number;
    window: { from: number; to: number } | null;
    series: { ts: number; kp: number }[];
}
export interface Sky {
    updatedAt: number;
    moon: {
        phase: number; name: string; fraction: number; waxing: boolean; up: boolean;
        rise: number | null; set: number | null; nextFull: { ts: number; name: string }; nextNew: number;
    };
    sun: { set: number | null; rise: number | null };
    night: { hours: SkyHour[]; window: { from: number; to: number; score: number } | null; quality: { level: 'good' | 'fair' | 'bad'; label: string } };
    planets: Planet[];
    aurora: Aurora | null;
    events: SkyEvent[];
    highlight: { kind: 'aurora' | 'eclipse' | 'shower' | 'planet' | 'moon'; title: string; text: string };
}

export function useSky() {
    const [sky, setSky] = useState<Sky | null>(null);
    useEffect(() => {
        const load = () => axios.get('/api/sky').then(({ data }) => setSky(data)).catch(() => {});
        load();
        const t = setInterval(load, 15 * 60_000);
        return () => clearInterval(t);
    }, []);
    return sky;
}

// ── Formats ──────────────────────────────────────────────────────────────────

export const hm = (ts: number | null) => {
    if (ts == null) return '–';
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
export const hOnly = (ts: number) => `${new Date(ts).getHours()} h`;
export const pct = (f: number) => `${Math.round(f * 100)} %`;
