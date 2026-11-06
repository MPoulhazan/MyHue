import { useState } from 'react';
import axios from 'axios';
import { mailboxPoll } from '../home/widgets/polls';
import './Mailbox.css';

// ── Données de /api/mailbox (server/mailbox.js) ──────────────────────────────

export interface MailView {
    enabled: boolean;
    sensor: { did: string; name: string; online: boolean; battery: number | null } | null;
    waiting: { since: number; count: number } | null;
    today: { delivery: number | null; pickup: number | null };
    pending: boolean;
    night: { at: number } | null;
    usual: number | null;
    mood: 'mail' | 'pending' | 'night' | 'off' | 'done' | 'empty';
    line: string;
    lamp: boolean;
}

const hm = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
const hmMin = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;

/** Carte « Okayyy ! Le courrier » de l'accueil : le visiteur dit si le facteur est passé. */
export function MailboxCard() {
    const view = mailboxPoll.use();
    const [busy, setBusy] = useState(false);
    if (!view?.enabled || !view.sensor) return null;

    const post = async (url: string) => {
        setBusy(true);
        try {
            const { data } = await axios.post(url, {});
            mailboxPoll.publish(data);
        } catch {
            mailboxPoll.load();
        } finally {
            setBusy(false);
        }
    };

    const { delivery, pickup } = view.today;
    return (
        <section className={`card mail-card mood-${view.mood}`} aria-label="Boîte aux lettres">
            <div className="card-head">
                <span className="card-title">Courrier</span>
                {view.waiting && <span className="mail-pill mail">Dans la boîte</span>}
                {view.night && <span className="mail-pill night">Ouverte la nuit</span>}
                {!view.sensor.online && <span className="mail-pill off">Capteur muet</span>}
            </div>
            <div className="mail-body">
                <span className={`mail-photo ${view.waiting ? 'ring' : ''}`} role="img" aria-label="" />
                <p className="mail-bubble" aria-live="polite">{view.line}</p>
            </div>
            <div className="mail-foot">
                <span className="mail-chips">
                    {delivery && <span className="mail-chip s-mail">Facteur {hm(delivery)}</span>}
                    {pickup && (!delivery || pickup > delivery) && <span className="mail-chip s-done">Relevé {hm(pickup)}</span>}
                    {!delivery && view.usual != null && <span className="mail-chip">D’habitude ~{hmMin(view.usual)}</span>}
                </span>
                {view.night
                    ? <button type="button" className="mail-btn" onClick={() => post('/api/mailbox/night-ok')} disabled={busy}>C’était moi</button>
                    : view.waiting && <button type="button" className="mail-btn" onClick={() => post('/api/mailbox/collected')} disabled={busy}>Relevé</button>}
            </div>
        </section>
    );
}
