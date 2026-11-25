import { useState } from 'react';
import axios from 'axios';
import { guardPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
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
    /** Mode armé tout seul après 24 h d'absence : il se coupe quand un téléphone revient */
    auto?: boolean;
    /** Simulation lancée par la maison vide (12 h de porte fermée), sans alarme */
    autoSim?: boolean;
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

/** Carte « Alarme » : activer à la main, voir les passages, couper en rentrant. */
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
            <span>En pause, {view.mode ? 'non surveillé' : 'ne sera pas surveillé'} : <b>{paused.map((p) => p.name).join(', ')}</b></span>
            <button type="button" className="guard-btn" disabled={busy} onClick={resumeAll}>Réactiver</button>
        </div>
    );

    if (!view.mode) {
        return (
            <WidgetCard className="guard-card" label="Alarme" title="Alarme"
                pills={<StatusPill level="off">Désactivée</StatusPill>}
                detail={{ title: 'Alarme', body: <p className="lead">Porte ou mouvement quand la maison est vide : un Telegram tout de suite. En mode vacances, les lumières s’allument aussi le soir pour faire croire qu’on est là. Personne et porte d’entrée fermée depuis 12 h : la simulation part toute seule ; 24 h : l’alarme s’arme.</p> }}>
                {pausedWarning}
                {view.autoSim && (
                    <p className="wcard-line">
                        Personne depuis 12 h : simulation de présence le soir
                        {view.simToday ? ` (${hmMin(view.simToday.onAt)} → ${hmMin(view.simToday.offAt)})` : ''}. L’alarme s’arme après 24 h.
                    </p>
                )}
                <div className="guard-actions">
                    <button type="button" className="guard-btn" disabled={busy} onClick={() => put({ mode: 'alarm' })}>Mode alarme</button>
                    <button type="button" className="guard-btn" disabled={busy} onClick={() => put({ mode: 'vacation' })}>Mode vacances</button>
                </div>
            </WidgetCard>
        );
    }

    const sim = view.simToday;
    const events = (n: number) => view.events.length ? (
        <ul className="guard-events">
            {view.events.slice(0, n).map((e) => (
                <li key={e.at}><b>{day(e.at)}</b> {e.what === 'open' ? `${e.sensor} ouverte` : `mouvement, ${e.sensor}`}</li>
            ))}
        </ul>
    ) : (
        <p className="wcard-line">Rien à signaler.</p>
    );
    const simulation = view.mode === 'vacation' && (
                <label className="guard-sim">
                    <input type="checkbox" checked={view.simulate} disabled={busy} onChange={(e) => put({ simulate: e.target.checked })} />
                    <span>
                        Lumières le soir (salon, cuisine, salle à manger)
                        {view.simulate && sim ? ` · ce soir ${hmMin(sim.onAt)} → ${hmMin(sim.offAt)}` : view.simulate ? ' · dès la nuit tombée' : ''}
                    </span>
                </label>
    );
    return (
        <WidgetCard className="guard-card on" label="Alarme" title={LABEL[view.mode]}
            pills={<StatusPill level="bad">Actif{view.since ? ` depuis ${day(view.since)}` : ''}</StatusPill>}
            detail={{ title: LABEL[view.mode], body: <>{events(12)}{simulation}</> }}>
            {pausedWarning}
            {view.auto && <p className="wcard-line">Armé tout seul après 24 h d’absence : il se coupe quand un téléphone revient sur le Wi-Fi.</p>}
            {events(1)}
            <div className="guard-actions">
                <button type="button" className="guard-btn stop" disabled={busy} onClick={() => put({ mode: null })}>On est rentrés</button>
            </div>
        </WidgetCard>
    );
}
