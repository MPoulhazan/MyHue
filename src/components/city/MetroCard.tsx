import { useCity } from './useCity';
import './City.css';

const LINE_COLOR: Record<string, string> = { 1: '#00a650', 2: '#ef8122', 4: '#ffd900', 5: '#0083ca' };

/** Carte « Métro » de l'accueil, à la place de la carte BIXI hors saison : l'état des lignes qu'on prend. */
export function MetroCard() {
    const { view } = useCity();
    const m = view?.metro;
    if (!m?.show) return null;
    const trouble = m.lines.filter((l) => !l.ok);
    const pill = m.error ? { cls: 'off', text: 'État inconnu' } : trouble.length ? { cls: 'bad', text: 'Perturbation' } : { cls: 'ok', text: 'Service normal' };
    return (
        <section className="card metro-card" aria-label="Métro">
            <div className="card-head">
                <span className="card-title">Métro{m.station ? ` · ${m.station}` : ''}</span>
                <span className={`metro-pill ${pill.cls}`}>{pill.text}</span>
            </div>
            {m.error ? (
                <p className="muted metro-note">{m.error === 'clé STM refusée' ? 'La STM refuse encore la clé : vérifie que l’application est abonnée à l’API i3 sur le portail développeurs.' : `STM injoignable : ${m.error}`}</p>
            ) : (
                <div className="metro-lines">
                    {m.lines.map((l) => (
                        <div key={l.line} className={`metro-line ${l.ok ? 'ok' : 'bad'}`}>
                            <i style={{ background: LINE_COLOR[l.line] || 'var(--h-muted)' }} />
                            <b>Ligne {l.name}</b>
                            <span>{l.text}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
