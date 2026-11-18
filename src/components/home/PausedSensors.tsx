import { useState } from 'react';
import axios from 'axios';
import type { Sensor } from '../../hooks/useHome';
import { Icon } from '../Icon';
import { hhmm } from './cards';

const until = (u: Sensor['pausedUntil']) => {
    if (u == null || u === 'forever') return '';
    const d = new Date(u);
    return ` jusqu’à ${d.toDateString() === new Date().toDateString() ? '' : 'demain '}${hhmm(d)}`;
};

/**
 * Pastille de l'accueil tant qu'un capteur est en pause, pour ne pas l'oublier :
 * la toucher le réactive (l'état revient par le flux des capteurs).
 */
export function PausedSensors({ sensors }: { sensors: Sensor[] }) {
    const [busy, setBusy] = useState<string | null>(null);
    const paused = sensors.filter((s) => s.pausedUntil);
    if (!paused.length) return null;
    const resume = async (s: Sensor) => {
        setBusy(s.did);
        await axios.delete(`/api/sensors/${encodeURIComponent(s.did)}/pause`).catch(() => {});
        setBusy(null);
    };
    return (
        <>
            {paused.map((s) => (
                <button key={s.did} type="button" className="weather-pill paused-pill" disabled={busy === s.did}
                    title="Toucher pour réactiver" onClick={() => resume(s)}>
                    <Icon name="pause" size={16} strokeWidth={2.4} />
                    <span><strong>{s.name}</strong> en pause{until(s.pausedUntil)}</span>
                    <span className="paused-pill-action">Réactiver</span>
                </button>
            ))}
        </>
    );
}
