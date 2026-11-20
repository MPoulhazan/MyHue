import { useState } from 'react';
import axios from 'axios';
import { QueueNote } from '../alerts/QueueNote';
import './HomeAlarm.css';

export interface ActiveAlarm {
    did: string;
    name: string;
    room: string | null;
    type: string;
    since: number;
}

const TITLE: Record<string, string> = { smoke: 'Fumée détectée', water_leak: 'Fuite d’eau détectée' };
const ADVICE: Record<string, string> = {
    smoke: 'Vérifie tout de suite. En cas de feu : sors et appelle le 911.',
    water_leak: 'Va vérifier tout de suite et coupe l’eau si besoin.',
};
const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

/**
 * Écran d'alarme (fumée ou fuite), montré par AlertHost tant que l'alarme est levée.
 * « Lumières normales » = « C'est réglé » sur Telegram : les lampes reprennent leur état d'avant.
 * @param alarms les alarmes de cette sorte (la fumée et la fuite ont chacune leur écran)
 * @param all    toutes les alarmes en cours : un seul geste rend la maison normale
 */
export function HomeAlarm({ alarms, all, waiting, onCleared }: { alarms: ActiveAlarm[]; all: ActiveAlarm[]; waiting: number; onCleared: () => void }) {
    const [busy, setBusy] = useState(false);
    const a = alarms[0];
    if (!a) return null;

    const clear = async () => {
        setBusy(true);
        try {
            for (const x of all) await axios.post('/api/alarm/clear', { did: x.did });
        } finally {
            setBusy(false);
            onCleared();
        }
    };

    const where = a.room ? `${a.room} · ${a.name}` : a.name;
    return (
        <div className="home-alarm-dim alert-layer" role="alertdialog" aria-modal="true" aria-labelledby="home-alarm-title">
            <div className="home-alarm">
                <span className="home-alarm-kicker">Alarme maison · depuis {hhmm(a.since)}</span>
                <h2 id="home-alarm-title">{TITLE[a.type] || 'Alarme'}</h2>
                <p className="home-alarm-where">{where}{alarms.length > 1 ? ` et ${alarms.length - 1} autre${alarms.length > 2 ? 's' : ''}` : ''}</p>
                <p className="home-alarm-advice">{ADVICE[a.type] || 'Va vérifier tout de suite.'}</p>
                <button type="button" className="home-alarm-btn" onClick={clear} disabled={busy} autoFocus>
                    {busy ? 'Un instant…' : 'Lumières normales'}
                </button>
                <small className="home-alarm-note">Les lampes reprennent leur état d’avant et Telegram est prévenu. Si ça recommence, l’alarme repart.</small>
                <QueueNote waiting={waiting} />
            </div>
        </div>
    );
}
