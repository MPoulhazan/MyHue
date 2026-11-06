import { useCity } from './useCity';
import './City.css';

const LAMP = { ice: 'bleu glace', alert: 'orange' };

/** Écran d'alerte de la tablette : un vrai danger (verglas, smog, avis d'ébullition…) reste affiché jusqu'à « J'ai vu ». */
export function CityAlert() {
    const { view, ack } = useCity();
    const e = view?.takeover;
    if (!e) return null;
    const facts = [
        { label: 'Quand', value: e.when },
        e.advice ? { label: 'Pour vous', value: e.advice } : null,
        e.lamp ? { label: 'Lampe du salon', value: `respire en ${LAMP[e.lamp]}` } : null,
    ].filter((f): f is { label: string; value: string } => f !== null);
    return (
        <div className="city-dim" role="alertdialog" aria-modal="true" aria-labelledby="city-alert-title">
            <div className={`city-takeover kind-${e.kind}`}>
                <span className="city-kicker">{e.source}</span>
                <h2 id="city-alert-title">{e.title}, {e.when}</h2>
                {e.detail && <p>{e.detail}</p>}
                <div className="city-facts">
                    {facts.map((f) => (
                        <div key={f.label} className="city-fact"><small>{f.label}</small><b>{f.value}</b></div>
                    ))}
                </div>
                <div className="city-actions">
                    <span className="muted">Le briefing du matin le redira.</span>
                    <button type="button" className="city-seen" onClick={() => ack(e.id)} autoFocus>J’ai vu</button>
                </div>
            </div>
        </div>
    );
}
