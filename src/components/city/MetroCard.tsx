import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import { useCity } from './useCity';
import './City.css';

const LINE_COLOR: Record<string, string> = { 1: '#00a650', 2: '#ef8122', 4: '#ffd900', 5: '#0083ca' };

/** Carte « Métro » de l'accueil, à la place de la carte BIXI hors saison : l'état des lignes qu'on prend. */
export function MetroCard() {
    const { view } = useCity();
    const m = view?.metro;
    if (!m?.show) return null;
    const trouble = m.lines.filter((l) => !l.ok);
    const pill = m.error
        ? <StatusPill level="off">État inconnu</StatusPill>
        : trouble.length ? <StatusPill level="bad">Perturbation</StatusPill> : <StatusPill level="ok">Service normal</StatusPill>;
    const lines = (full: boolean) => (
        <div className={`metro-lines ${full ? 'full' : ''}`}>
            {m.lines.map((l) => (
                <div key={l.line} className={`metro-line ${l.ok ? 'ok' : 'bad'}`}>
                    <i style={{ background: LINE_COLOR[l.line] || 'var(--h-muted)' }} />
                    <b>Ligne {l.name}</b>
                    <span>{l.text}</span>
                </div>
            ))}
        </div>
    );
    const title = `Métro${m.station ? ` · ${m.station}` : ''}`;
    return (
        <WidgetCard className="metro-card" label="Métro" title={title} pills={pill}
            detail={m.error ? undefined : { title, body: lines(true) }}>
            {m.error
                ? <p className="wcard-line">{m.error === 'clé STM refusée' ? 'La STM refuse encore la clé : vérifie que l’application est abonnée à l’API i3 sur le portail développeurs.' : `STM injoignable : ${m.error}`}</p>
                : lines(false)}
        </WidgetCard>
    );
}
