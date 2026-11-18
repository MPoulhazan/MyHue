import { useState } from 'react';
import axios from 'axios';
import { guardPoll } from '../home/widgets/polls';
import './Guard.css';

// ── Données de /api/guard (server/guard.js) ──────────────────────────────────

export interface GuardView {
    mode: 'alarm' | 'vacation' | null;
    since: number | null;
    by: string | null;
    events: { at: number; sensor: string; what: 'open' | 'motion' }[];
    simulate: boolean;
    sim: { onFrom: string; onTo: string; offFrom: string; offTo: string };
    simToday: { onAt: number; offAt: number; lit: boolean } | null;
    /** Capteurs en pause : ils ne déclencheront pas d'alerte */
    pausedSensors?: { ieee: string; name: string }[];
}

const hm = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
const hmMin = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const day = (ts: number) => {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString() ? hm(ts) : `${d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' })} ${hm(ts)}`;
};

const LABEL = { alarm: 'Mode alarme', vacation: 'Mode vacances' } as const;

/** Carte « Alarme » : activer à la main, voir les passages, couper en rentrant. */
export function GuardCard() {
    const view = guardPoll.use();
    const [busy, setBusy] = useState(false);
    if (!view) return null;

    const put = async (body: object) => {
        setBusy(true);
        try {
            const { data } = await axios.put('/api/guard', body);
            guardPoll.publish(data);
        } catch {
            guardPoll.load();
        } finally {
            setBusy(false);
        }
    };

    const paused = view.pausedSensors ?? [];
    const resumeAll = async () => {
        setBusy(true);
        await Promise.all(paused.map((p) => axios.delete(`/api/sensors/${encodeURIComponent(p.ieee)}/pause`).catch(() => {})));
        await guardPoll.load();
        setBusy(false);
    };
    // Une pause oubliée ne doit pas faire un trou dans la surveillance
    const pausedWarning = paused.length > 0 && (
        <div className="guard-paused" role="status">
            <span>⚠️ En pause, {view.mode ? 'non surveillé' : 'ne sera pas surveillé'} : <b>{paused.map((p) => p.name).join(', ')}</b></span>
            <button type="button" className="guard-btn" disabled={busy} onClick={resumeAll}>Réactiver</button>
        </div>
    );

    if (!view.mode) {
        return (
            <section className="card guard-card" aria-label="Alarme">
                <div className="card-head">
                    <span className="card-title">Alarme</span>
                    <span className="guard-pill off">Désactivée</span>
                </div>
                <p className="guard-line">Porte ou mouvement pendant votre absence : un Telegram tout de suite.</p>
                {pausedWarning}
                <div className="guard-actions">
                    <button type="button" className="guard-btn" disabled={busy} onClick={() => put({ mode: 'alarm' })}>Mode alarme</button>
                    <button type="button" className="guard-btn" disabled={busy} onClick={() => put({ mode: 'vacation' })}>Mode vacances</button>
                </div>
            </section>
        );
    }

    const sim = view.simToday;
    return (
        <section className="card guard-card on" aria-label="Alarme">
            <div className="card-head">
                <span className="card-title">{LABEL[view.mode]}</span>
                <span className="guard-pill">Actif{view.since ? ` depuis ${day(view.since)}` : ''}</span>
            </div>
            {pausedWarning}
            {view.events.length ? (
                <ul className="guard-events">
                    {view.events.slice(0, 4).map((e) => (
                        <li key={e.at}><b>{day(e.at)}</b> {e.what === 'open' ? `${e.sensor} ouverte` : `mouvement, ${e.sensor}`}</li>
                    ))}
                </ul>
            ) : (
                <p className="guard-line">Rien à signaler.</p>
            )}
            {view.mode === 'vacation' && (
                <label className="guard-sim">
                    <input type="checkbox" checked={view.simulate} disabled={busy} onChange={(e) => put({ simulate: e.target.checked })} />
                    <span>
                        Salon allumé le soir
                        {view.simulate && sim ? ` · ce soir ${hmMin(sim.onAt)} → ${hmMin(sim.offAt)}` : view.simulate ? ` · ${view.sim.onFrom}–${view.sim.offTo}` : ''}
                    </span>
                </label>
            )}
            <div className="guard-actions">
                <button type="button" className="guard-btn stop" disabled={busy} onClick={() => put({ mode: null })}>On est rentrés</button>
            </div>
        </section>
    );
}
