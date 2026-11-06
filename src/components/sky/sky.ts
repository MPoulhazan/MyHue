import { createSharedPoll } from '../../hooks/sharedPoll';

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
export interface IssPass { start: number; end: number; durationMin: number; maxEl: number; peakTs: number; from: string; to: string; brightness: string }
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
    iss: IssPass[] | null;
    highlight: { kind: 'aurora' | 'eclipse' | 'iss' | 'shower' | 'planet' | 'moon'; title: string; text: string };
}

// Une seule lecture partagée par la carte, la page Météo et le registre des widgets
const skyPoll = createSharedPoll<Sky>('/api/sky', 15 * 60_000);
export const useSky = skyPoll.use;

// ── Formats ──────────────────────────────────────────────────────────────────

export const hm = (ts: number | null) => {
    if (ts == null) return '–';
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
export const hOnly = (ts: number) => `${new Date(ts).getHours()} h`;
export const pct = (f: number) => `${Math.round(f * 100)} %`;
