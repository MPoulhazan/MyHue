import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { MoonCanvas } from './MoonCanvas';
import { hm, pct, useSky } from './sky';
import './Sky.css';

/** Carte « Ciel ce soir » de la home : la lune et l'événement le plus important, lien vers le bandeau de Météo. */
export function SkyCard() {
    const sky = useSky();
    if (!sky) return null;
    const { moon, highlight, night } = sky;
    const aurora = highlight.kind === 'aurora' && sky.aurora?.level === 'alert';
    const dots = { good: 3, fair: 2, bad: 1 }[night.quality.level];
    return (
        <section className={`card sky-card ${aurora ? 'aurora' : ''}`} aria-label="Ciel ce soir">
            <div className="card-head">
                <span className="card-title">Ciel ce soir</span>
                {aurora
                    ? <span className="sky-pill aurora">Alerte aurore</span>
                    : (
                        <span className="sky-pill dots" aria-label={night.quality.label}>
                            <span aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= dots ? 'on' : ''} />)}</span>
                            {night.quality.level === 'good' ? 'Bon' : night.quality.level === 'fair' ? 'Moyen' : 'Mauvais'}
                        </span>
                    )}
            </div>
            <div className="sky-card-moon">
                <MoonCanvas size={76} fraction={moon.fraction} waxing={moon.waxing} label={`${moon.name}, ${pct(moon.fraction)} éclairée`} />
                <div>
                    <strong>{moon.name}</strong>
                    <span className="muted">{pct(moon.fraction)} éclairée</span>
                    <span className="muted">{moon.up ? `Se couche ${hm(moon.set)}` : `Se lève ${hm(moon.rise)}`}</span>
                </div>
            </div>
            <div className={`sky-highlight k-${highlight.kind}`}>
                <strong>{highlight.title}</strong>
                <span>{highlight.text}</span>
            </div>
            <Link to="/climate/weather#ciel" className="foot-link sky-more">
                <span>Tout le ciel de la nuit</span>
                <Icon name="chevron" size={18} strokeWidth={2.2} />
            </Link>
        </section>
    );
}
