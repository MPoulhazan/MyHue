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
const MAX = 5;

/** Carte « En ville » : alertes météo, avis du quartier et événements, rangés par jour. Cachée quand il n'y a rien. */
export function CityCard() {
    const { view } = useCity();
    if (!view?.enabled || !view.events.length) return null;

    // Les événements arrivent du plus grave au moins grave : on garde les MAX premiers
    const shown = view.events.slice(0, MAX);
    const dangers = view.events.filter((e) => e.level === 'danger').length;
    const hidden = view.events.length - shown.length;
    return (
        <section className="card city-card" aria-label="En ville">
            <div className="card-head">
                <span className="card-title">En ville</span>
                {dangers > 0 && <span className="city-pill danger">{dangers} danger{dangers > 1 ? 's' : ''}</span>}
            </div>
            <div className="city-agenda">
                {GROUPS.map(([key, label]) => {
                    const list = shown.filter((e) => e.bucket === key);
                    if (!list.length) return null;
                    return (
                        <div key={key} className="city-day">
                            <span className="city-day-name">{label}</span>
                            {list.map((e) => (
                                <div key={e.id} className={`city-ev ${e.level}`} title={[e.detail, e.advice, e.source].filter(Boolean).join(' · ')}>
                                    <i />
                                    <span className="city-ev-text">
                                        <b>{e.title}</b>
                                        <small><span className="city-when">{e.when}</span>{e.detail && <> · {e.detail}</>}</small>
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                })}
                {hidden > 0 && <span className="city-more">+ {hidden} autre{hidden > 1 ? 's' : ''}</span>}
            </div>
        </section>
    );
}
