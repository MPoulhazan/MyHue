import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import { useCity } from './useCity';
import type { CityEvent } from './useCity';
import './City.css';

const GROUPS: [CityEvent['bucket'], string][] = [
    ['now', 'En ce moment'],
    ['today', 'Aujourd’hui'],
    ['tomorrow', 'Demain'],
    ['weekend', 'Ce week-end'],
    ['later', 'Plus tard'],
];
/** Dans la carte : les plus graves seulement ; le reste dans le détail */
const COMPACT = 2;

function Event({ e, onBin }: { e: CityEvent; onBin: () => void }) {
    return (
        <div className={`city-ev ${e.level}`} title={[e.detail, e.advice, e.source].filter(Boolean).join(' · ')}>
            <i />
            <span className="city-ev-text">
                <b>{e.title}</b>
                <small><span className="city-when">{e.when}</span>{e.detail && <> · {e.detail}</>}</small>
            </span>
            {e.action === 'collecte' && <button type="button" className="city-do" onClick={onBin}>C’est sorti</button>}
        </div>
    );
}

/** Carte « En ville » : alertes météo, avis du quartier et événements. Cachée quand il n'y a rien. */
export function CityCard() {
    const { view, binOut } = useCity();
    if (!view?.enabled || !view.events.length) return null;

    // Les événements arrivent du plus grave au moins grave
    const events = view.events;
    const dangers = events.filter((e) => e.level === 'danger').length;
    const more = events.length - COMPACT;
    return (
        <WidgetCard className="city-card" label="En ville" title="En ville"
            pills={dangers > 0 && <StatusPill level="bad">{dangers} danger{dangers > 1 ? 's' : ''}</StatusPill>}
            detail={{
                title: 'En ville',
                className: 'city-sheet',
                body: (
                    <div className="city-agenda">
                        {GROUPS.map(([key, label]) => {
                            const list = events.filter((e) => e.bucket === key);
                            if (!list.length) return null;
                            return (
                                <div key={key} className="city-day">
                                    <span className="city-day-name">{label}</span>
                                    {list.map((e) => <Event key={e.id} e={e} onBin={binOut} />)}
                                </div>
                            );
                        })}
                    </div>
                ),
            }}>
            <div className="city-agenda">
                {events.slice(0, COMPACT).map((e) => <Event key={e.id} e={e} onBin={binOut} />)}
                {more > 0 && <span className="city-more">+ {more} autre{more > 1 ? 's' : ''}</span>}
            </div>
        </WidgetCard>
    );
}
