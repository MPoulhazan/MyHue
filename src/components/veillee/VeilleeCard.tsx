import { useState } from 'react';
import axios from 'axios';
import { veilleePoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import './Veillee.css';

export interface VeilleeStatus {
    available: boolean;
    active: boolean;
    startedAt: number | null;
    endsAt: number | null;
    log: string | null;
    music: boolean;
    heat: { target: number } | null;
    notes: string[];
}

const hourOf = (ts: number) => new Date(ts).toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' }).replace(':00', ' h').replace(':', ' h ');

/** Carte de l'accueil, en décembre : lancer la veillée, puis la terminer. */
export function VeilleeCard() {
    const status = veilleePoll.use();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!status || (!status.available && !status.active)) return null;

    const act = async (what: 'start' | 'stop') => {
        setBusy(true);
        setError(null);
        try {
            const { data } = await axios.post<VeilleeStatus>(`/api/veillee/${what}`);
            veilleePoll.publish(data);
        } catch (e) {
            setError(axios.isAxiosError(e) ? e.response?.data?.error || 'La veillée ne répond pas' : 'La veillée ne répond pas');
        } finally {
            setBusy(false);
        }
    };

    const what = status.active
        ? [status.log ? 'la bûche au projecteur' : null, status.music ? 'le jazz au salon' : null, 'le feu dans les lampes', status.heat ? `${status.heat.target} °C` : null].filter(Boolean).join(', ')
        : null;

    return (
        <WidgetCard className={`veillee-card ${status.active ? 'is-on' : ''}`} label="Veillée" title="Veillée"
            pills={status.active && status.endsAt ? <StatusPill level="warn">jusqu’à {hourOf(status.endsAt)}</StatusPill> : null}>
            {status.active ? (
                <>
                    <p className="wcard-line">En cours : {what}.</p>
                    {status.notes.length > 0 && <p className="wcard-line veillee-note">Pas pu : {status.notes.map((n) => n.split(' : ')[0].toLowerCase()).join(', ')}.</p>}
                    <button type="button" className="veillee-btn ghost" onClick={() => act('stop')} disabled={busy}>
                        {busy ? 'Un instant…' : 'Terminer la veillée'}
                    </button>
                </>
            ) : (
                <>
                    <p className="wcard-line">Bûche au projecteur, jazz de Noël, feu de cheminée et un degré de plus, pour 3 h.</p>
                    <button type="button" className="veillee-btn" onClick={() => act('start')} disabled={busy}>
                        {busy ? 'On allume le feu…' : 'Lancer la veillée'}
                    </button>
                </>
            )}
            {error && <p className="wcard-line veillee-note">{error}</p>}
        </WidgetCard>
    );
}
