import { useState } from 'react';
import axios from 'axios';
import { pinsPoll } from '../components/home/widgets/polls';
import { DEFAULT_PINS, WIDGET_META, WIDGET_ORDER } from '../components/home/widgets/relevance';
import type { Pin, WidgetId } from '../components/home/widgets/relevance';
import './Dashboard.css';
import './Settings.css';

const CHOICES: [Pin, string][] = [['auto', 'Auto'], ['always', 'Toujours'], ['hidden', 'Masqué']];

/** Réglages des widgets de l'accueil : Auto (selon ce qu'il a à dire), Toujours (carte fixe) ou Masqué. */
export function WidgetSettings() {
    const view = pinsPoll.use();
    const [busy, setBusy] = useState<WidgetId | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pinOf = (id: WidgetId) => view?.pins[id] ?? DEFAULT_PINS[id];

    const choose = async (id: WidgetId, pin: Pin) => {
        if (pinOf(id) === pin) return;
        setBusy(id);
        setError(null);
        try {
            const { data } = await axios.put('/api/home-widgets', { pins: { [id]: pin } });
            pinsPoll.publish(data);
        } catch {
            setError('Le réglage n’a pas été enregistré. Réessaie dans un instant.');
            pinsPoll.load();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="home settings-page">
            <header className="home-top">
                <div className="home-hello"><h1>Widgets de l’accueil</h1></div>
            </header>
            <p className="settings-note muted">
                En Auto, un widget passe en carte dans « Maintenant » quand il a quelque chose à dire, sinon il reste en pastille en bas.
                Cinq cartes au plus, celles sur Toujours comprises.
            </p>
            {error && <p className="settings-note warn" role="alert">{error}</p>}

            <div className="settings-items">
                {WIDGET_ORDER.map((id) => (
                    <div key={id} className="item-row widget-pin-row">
                        <span className="item-text">
                            <strong>{WIDGET_META[id].label}</strong>
                            <span className="muted">{WIDGET_META[id].when}</span>
                        </span>
                        <div className="widget-seg" role="group" aria-label={WIDGET_META[id].label}>
                            {CHOICES.map(([pin, label]) => (
                                <button key={pin} type="button" className={pinOf(id) === pin ? 'on' : ''} aria-pressed={pinOf(id) === pin}
                                    disabled={busy === id || !view} onClick={() => choose(id, pin)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
