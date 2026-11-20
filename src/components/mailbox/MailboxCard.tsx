import { useState } from 'react';
import axios from 'axios';
import { mailboxPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
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

/** Carte « Okayyy ! Le courrier » de l'accueil : le visiteur dit si le facteur est passé. */
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
        <WidgetCard className={`mail-card mood-${view.mood}`} label="Boîte aux lettres" title="Courrier"
            pills={(view.waiting || view.night || !view.sensor.online || delivery || pickup) && <>
                {/* Le facteur et le relevé du jour ; « d'habitude » est déjà dans la bulle */}
                {delivery && !view.waiting && <StatusPill level="info">Facteur {hm(delivery)}</StatusPill>}
                {pickup && (!delivery || pickup > delivery) && <StatusPill level="ok">Relevé {hm(pickup)}</StatusPill>}
                {view.waiting && <StatusPill level="warn">Dans la boîte</StatusPill>}
                {view.night && <StatusPill level="bad">Ouverte la nuit</StatusPill>}
                {!view.sensor.online && <StatusPill level="off">Capteur muet</StatusPill>}
            </>}>
            <div className="mail-body">
                <span className={`mail-photo ${view.waiting ? 'ring' : ''}`} role="img" aria-label="" />
                <p className="mail-bubble" aria-live="polite">{view.line}</p>
            </div>
            {(view.night || view.waiting) && (
                <div className="mail-foot">
                    {view.night
                        ? <button type="button" className="mail-btn" onClick={() => post('/api/mailbox/night-ok')} disabled={busy}>C’était moi</button>
                        : <button type="button" className="mail-btn" onClick={() => post('/api/mailbox/collected')} disabled={busy}>Relevé</button>}
                </div>
            )}
        </WidgetCard>
    );
}
