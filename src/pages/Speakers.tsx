import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import './Dashboard.css';
import './Settings.css';

// Fiche eureka d'un appareil Cast (/api/google-home/devices), lente quand un appareil ne répond pas
interface Details {
    id: string;
    online: boolean;
    eureka: {
        ssid: string | null;
        signalLevel: number | null;
        uptime: string | null;
        castBuildRevision: string | null;
    } | null;
}

const signal = (dbm: number | null) => {
    if (dbm == null) return null;
    if (dbm >= -50) return 'excellent';
    if (dbm >= -60) return 'bon';
    if (dbm >= -70) return 'correct';
    return 'faible';
};

/** Enceintes Google Cast : la liste s'affiche tout de suite, les détails arrivent ensuite. */
export function Speakers() {
    const { cast } = useHomeData();
    const [details, setDetails] = useState<Record<string, Details>>({});
    const [loading, setLoading] = useState(true);

    const fetchDetails = useCallback(() => {
        axios.get('/api/google-home/devices', { timeout: 30_000 })
            .then(({ data }) => setDetails(Object.fromEntries((data.devices as Details[]).map((d) => [d.id, d]))))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);
    useEffect(fetchDetails, [fetchDetails]);

    const load = () => {
        setLoading(true);
        fetchDetails();
    };

    return (
        <div className="home settings-page">
            <header className="home-top">
                <div className="home-hello"><h1>Enceintes</h1>
                    <span className="muted">{cast.speakers.filter((s) => s.online).length} sur {cast.speakers.length} en ligne</span></div>
                <button type="button" className="pill-btn with-icon" onClick={load} disabled={loading}>
                    <Icon name="refresh" size={18} strokeWidth={2.2} className={loading ? 'spin' : ''} /> {loading ? 'Vérification…' : 'Vérifier'}
                </button>
            </header>

            {!cast.speakers.length && <p className="muted">Recherche des enceintes…</p>}

            <div className="settings-items">
                {cast.speakers.map((s) => {
                    const d = details[s.id];
                    const online = d ? d.online : s.online;
                    const e = d?.eureka;
                    const quality = signal(e?.signalLevel ?? null);
                    return (
                        <div key={s.id} className="item-row static">
                            <span className={`item-icon ${online ? '' : 'off'}`}><Icon name="cast" size={22} strokeWidth={2} /></span>
                            <span className="item-text">
                                <strong>{s.name}</strong>
                                <span className="muted">
                                    {online
                                        ? [s.host, e?.ssid && `Wi-Fi ${e.ssid}`, quality && `signal ${quality}`, e?.uptime && `allumée depuis ${e.uptime}`].filter(Boolean).join(' · ')
                                        : `ne répond pas sur ${s.host}`}
                                </span>
                            </span>
                            <span className={`item-value ${online ? 'ok' : 'warn'}`}>{online ? 'en ligne' : 'hors ligne'}</span>
                        </div>
                    );
                })}
            </div>

            <p className="muted settings-note">
                MyHue retrouve seul une enceinte qui a changé d’adresse sur le réseau. Une enceinte hors ligne est
                débranchée ou hors du Wi-Fi.
            </p>
        </div>
    );
}
