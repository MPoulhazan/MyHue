import { useState } from 'react';
import axios from 'axios';
import { cooperPoll } from '../home/widgets/polls';
import './Cooper.css';

// ── Données de /api/cooper (server/cooper.js) ────────────────────────────────

export type MealStatus = 'done' | 'upcoming' | 'soon' | 'due' | 'late' | 'missed' | 'unknown';
export interface Meal { id: string; label: string; time: string; status: MealStatus; at: number | null; late: boolean }
export interface CooperView {
    enabled: boolean;
    sensor: { did: string; name: string; online: boolean } | null;
    meals: Meal[];
    mood: 'fed' | 'waiting' | 'soon' | 'late' | 'double';
    line: string;
    blinking: boolean;
}

const hm = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Carte « Cooper parle » de l'accueil : sa bulle dit s'il a eu ses repas de 12 h et 18 h. */
export function CooperCard() {
    const view = cooperPoll.use();
    const [busy, setBusy] = useState(false);
    if (!view?.enabled || !view.sensor) return null;

    const late = view.mood === 'late' && view.meals.some((m) => m.status === 'late');
    const done = view.meals.filter((m) => m.status === 'done' && m.at);
    const last = done[done.length - 1];

    const markFed = async () => {
        setBusy(true);
        try {
            const { data } = await axios.post('/api/cooper/fed', {});
            cooperPoll.publish(data);
        } catch {
            cooperPoll.load();
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={`card cooper-card mood-${view.mood}`} aria-label="Repas de Cooper">
            <div className="card-head">
                <span className="card-title">Cooper</span>
                {late && <span className="cooper-pill late">Oublié</span>}
                {view.mood === 'double' && <span className="cooper-pill double">Déjà nourri</span>}
                {!view.sensor.online && <span className="cooper-pill off">Capteur muet</span>}
            </div>
            <div className="cooper-body">
                <img className={`cooper-photo ${late ? 'late' : ''}`} src="/cooper.jpg" alt="" width={64} height={64} />
                <p className="cooper-bubble" aria-live="polite">{view.line}</p>
            </div>
            <div className="cooper-foot">
                <span className="cooper-meals">
                    {view.meals.map((m) => (
                        <span key={m.id} className={`cooper-meal s-${m.status}`}>
                            {cap(m.label)}
                            {m.status === 'done' && ' ✓'}
                            {(m.status === 'late' || m.status === 'missed') && ' !'}
                        </span>
                    ))}
                </span>
                {late
                    ? <button type="button" className="cooper-done" onClick={markFed} disabled={busy}>C'est fait</button>
                    : <span className="cooper-time">{last ? hm(last.at!) : `Prochain à ${view.meals.find((m) => ['upcoming', 'soon', 'due'].includes(m.status))?.time.replace(':00', ' h') ?? '—'}`}</span>}
            </div>
        </section>
    );
}
