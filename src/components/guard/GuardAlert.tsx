import { useState } from 'react';
import axios from 'axios';
import { QueueNote } from '../alerts/QueueNote';
import { guardPoll } from '../home/widgets/polls';
import type { GuardView } from './GuardCard';
import './Guard.css';

const hm = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Plein écran quand une porte s'ouvre ou qu'un mouvement est vu pendant le mode alarme ou
 * vacances. « J'ai vu » le range (sur cet écran) ; « On est rentrés » coupe la surveillance.
 */
export function GuardAlert({ view, event, waiting, onSeen, demo = false }: {
    view: GuardView;
    event: GuardView['events'][number];
    waiting: number;
    onSeen: (at: number) => void;
    /** Données de démonstration : on ne coupe pas la vraie alarme */
    demo?: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const home = async () => {
        if (demo) return onSeen(event.at);
        setBusy(true);
        try {
            const { data } = await axios.put('/api/guard', { mode: null });
            guardPoll.publish(data);
            onSeen(event.at);
        } catch {
            guardPoll.load();
        } finally {
            setBusy(false);
        }
    };
    const others = view.events.filter((e) => e.at !== event.at && event.at - e.at < 30 * 60_000).length;
    return (
        <div className="guard-dim alert-layer" role="alertdialog" aria-modal="true" aria-labelledby="guard-alert-title">
            <div className="guard-takeover">
                <span className="guard-kicker">{view.mode === 'vacation' ? 'Mode vacances' : 'Mode alarme'} · {hm(event.at)}</span>
                <h2 id="guard-alert-title">{event.what === 'open' ? `${event.sensor} ouverte` : `Mouvement, ${event.sensor}`}</h2>
                <p>Personne ne devait être là. Telegram a été prévenu{others ? `, avec ${others} autre${others > 1 ? 's' : ''} passage${others > 1 ? 's' : ''} juste avant` : ''}.</p>
                <div className="guard-takeover-actions">
                    <button type="button" className="guard-btn stop" disabled={busy} onClick={home}>On est rentrés</button>
                    <button type="button" className="guard-btn" onClick={() => onSeen(event.at)} autoFocus>J’ai vu</button>
                </div>
                <QueueNote waiting={waiting} />
            </div>
        </div>
    );
}
