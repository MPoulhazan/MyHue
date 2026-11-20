import { useState } from 'react';
import axios from 'axios';
import { cooperPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
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
    /** Moment de la journée qui prend la bulle : dodo (21 h – 8 h), réveil (« Ça pousse »), promenade faite. */
    moment?: 'dodo' | 'pousse' | 'walked' | null;
    blinking: boolean;
}

const hm = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MOMENT_PHOTO: Record<string, string> = { dodo: '/cooper-dodo.webp', pousse: '/cooper-pousse.webp' };

/** Carte « Cooper parle » de l'accueil : sa bulle dit s'il a eu ses repas de 12 h et 18 h. */
export function CooperCard() {
    const view = cooperPoll.use();
    const [busy, setBusy] = useState(false);
    if (!view?.enabled || !view.sensor) return null;

    const late = view.mood === 'late' && view.meals.some((m) => m.status === 'late');

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
        <WidgetCard className={`cooper-card mood-${view.mood}${view.moment ? ` moment-${view.moment}` : ''}`} label="Repas de Cooper" title="Cooper"
            pills={<>
                {view.meals.map((m) => (
                    <span key={m.id} className={`cooper-meal s-${m.status}`} title={m.status === 'done' && m.at ? `${cap(m.label)} à ${hm(m.at)}` : undefined}>
                        {cap(m.label)}
                        {m.status === 'done' && ' ✓'}
                        {(m.status === 'late' || m.status === 'missed') && ' !'}
                    </span>
                ))}
                {late && <StatusPill level="bad">Oublié</StatusPill>}
                {view.mood === 'double' && <StatusPill level="warn">Déjà nourri</StatusPill>}
                {!view.sensor.online && <StatusPill level="off">Capteur muet</StatusPill>}
            </>}>
            <div className="cooper-body">
                {view.moment && MOMENT_PHOTO[view.moment]
                    ? <img className="cooper-photo moment" src={MOMENT_PHOTO[view.moment]} alt="" width={96} height={96} />
                    : <img className={`cooper-photo ${late ? 'late' : ''}`} src="/cooper.jpg" alt="" width={64} height={64} />}
                <p className="cooper-bubble" aria-live="polite">{view.line}</p>
            </div>
            {late && (
                <div className="cooper-foot">
                    <button type="button" className="cooper-done" onClick={markFed} disabled={busy}>C'est fait</button>
                </div>
            )}
        </WidgetCard>
    );
}
