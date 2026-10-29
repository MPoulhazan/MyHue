import { useEffect, useState } from 'react';
import axios from 'axios';
import { fmt } from './cards';

/** Courbe de température des dernières 24 h (historique Home Assistant). */
export function TemperatureChart({ did, name }: { did: string; name: string }) {
    const [points, setPoints] = useState<{ ts: number; temperature: number }[]>([]);
    useEffect(() => {
        axios.get(`/api/zigbee/history/${encodeURIComponent(did)}`, { params: { hours: 24 } })
            .then(({ data }) => setPoints((data.points || []).filter((p: { temperature: number | null }) => p.temperature != null)))
            .catch(() => {});
    }, [did]);

    if (points.length < 2) return <p className="muted">Pas encore assez de mesures sur 24 h.</p>;

    const W = 350;
    const H = 110;
    const t0 = points[0].ts;
    const t1 = points[points.length - 1].ts;
    const temps = points.map((p) => p.temperature);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(max - min, 1);
    const path = points
        .map((p) => `${(((p.ts - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 8 - ((p.temperature - min) / span) * (H - 16)).toFixed(1)}`)
        .join(' ');

    return (
        <figure className="temp-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
                aria-label={`Température de ${name} sur 24 heures, entre ${fmt(min)} et ${fmt(max)} degrés`}>
                <polyline points={path} fill="none" stroke="var(--h-cool)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <figcaption className="muted">
                <span>Min {fmt(min)}°</span>
                <span>Max {fmt(max)}°</span>
            </figcaption>
        </figure>
    );
}
