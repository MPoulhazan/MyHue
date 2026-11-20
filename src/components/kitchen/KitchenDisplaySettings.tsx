import { useEffect, useState } from 'react';
import axios from 'axios';
import { Icon } from '../Icon';

interface KitchenView {
    enabled: boolean;
    device: string;
    from: string;
    to: string;
    found: boolean;
    showing: boolean;
    pausedUntil: number | null;
    lastError: string | null;
}

const hm = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const status = (v: KitchenView) => {
    if (!v.found) return `Écran « ${v.device} » introuvable sur le réseau`;
    if (!v.enabled) return 'Désactivé';
    if (v.showing) return 'Affiché en ce moment';
    if (v.pausedUntil) return `Arrêté à la voix, revient vers ${hm(v.pausedUntil)}`;
    if (v.lastError) return `Envoi raté : ${v.lastError}`;
    return 'En attente';
};

/** Réglage de l'écran de la cuisine (Nest Hub) : marche, heures, affichage immédiat. */
export function KitchenDisplaySettings() {
    const [view, setView] = useState<KitchenView | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        axios.get('/api/kitchen-display').then(({ data }) => setView(data)).catch(() => {});
    }, []);

    if (!view) return null;

    const patch = (body: Partial<KitchenView>) =>
        axios.put('/api/kitchen-display', body).then(({ data }) => setView(data)).catch(() => {});

    const showNow = async () => {
        setBusy(true);
        try {
            const { data } = await axios.post('/api/kitchen-display/show');
            setView(data);
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            setView({ ...view, lastError: msg || 'échec' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="settings-group" aria-label="Écran de la cuisine">
            <div className="item-row widget-pin-row">
                <span className={`item-icon ${view.enabled ? '' : 'off'}`}><Icon name="grid" size={22} strokeWidth={2} /></span>
                <span className="item-text">
                    <strong>Écran de la cuisine</strong>
                    <span className="muted">Nest Hub « {view.device} » · {status(view)}</span>
                </span>
                <label className="with-icon muted">
                    de <input type="time" value={view.from} onChange={(e) => e.target.value && patch({ from: e.target.value })} />
                    à <input type="time" value={view.to} onChange={(e) => e.target.value && patch({ to: e.target.value })} />
                </label>
                <button type="button" className="ghost-btn" disabled={busy || !view.found} onClick={showNow}>
                    {busy ? 'Envoi…' : 'Afficher maintenant'}
                </button>
                <button type="button" className={`switch ${view.enabled ? 'on' : ''}`} aria-pressed={view.enabled}
                    aria-label={view.enabled ? 'Désactiver l’écran de la cuisine' : 'Activer l’écran de la cuisine'}
                    onClick={() => patch({ enabled: !view.enabled })}>
                    <span />
                </button>
            </div>
        </section>
    );
}
