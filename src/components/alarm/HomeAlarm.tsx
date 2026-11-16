import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import './HomeAlarm.css';

interface ActiveAlarm {
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
 * Écran d'alarme de la tablette (fumée, fuite) : reste affiché tant que l'alarme est levée.
 * « Lumières normales » = « C'est réglé » sur Telegram : les lampes reprennent leur état d'avant.
 */
export function HomeAlarm() {
    const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        axios.get('/api/alarm').then(({ data }) => setAlarms(data.active || [])).catch(() => {});
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(load, 3000);
        return () => clearInterval(timer);
    }, [load]);

    const a = alarms[0];
    if (!a) return null;

    const clear = async () => {
        setBusy(true);
        try {
            // Toutes les alarmes en cours : un seul geste rend la maison normale
            for (const x of alarms) await axios.post('/api/alarm/clear', { did: x.did });
        } finally {
            setBusy(false);
            load();
        }
    };

    const where = a.room ? `${a.room} · ${a.name}` : a.name;
    return (
        <div className="home-alarm-dim" role="alertdialog" aria-modal="true" aria-labelledby="home-alarm-title">
            <div className="home-alarm">
                <span className="home-alarm-kicker">Alarme maison · depuis {hhmm(a.since)}</span>
                <h2 id="home-alarm-title">{TITLE[a.type] || 'Alarme'}</h2>
                <p className="home-alarm-where">{where}{alarms.length > 1 ? ` et ${alarms.length - 1} autre${alarms.length > 2 ? 's' : ''}` : ''}</p>
                <p className="home-alarm-advice">{ADVICE[a.type] || 'Va vérifier tout de suite.'}</p>
                <button type="button" className="home-alarm-btn" onClick={clear} disabled={busy} autoFocus>
                    {busy ? 'Un instant…' : 'Lumières normales'}
                </button>
                <small className="home-alarm-note">Les lampes reprennent leur état d’avant et Telegram est prévenu. Si ça recommence, l’alarme repart.</small>
            </div>
        </div>
    );
}
