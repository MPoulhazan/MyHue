import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import type { Level } from '../home/widgets/WidgetCard';
import { MoonCanvas } from './MoonCanvas';
import { hm, pct, useSky } from './sky';
import './Sky.css';

const QUALITY: Record<'good' | 'fair' | 'bad', [Level, string, number]> = {
    good: ['ok', 'Bon', 3],
    fair: ['warn', 'Moyen', 2],
    bad: ['off', 'Mauvais', 1],
};

/** Carte « Ciel ce soir » de l'accueil : la lune et l'événement le plus important ; tout le ciel dans Météo. */
export function SkyCard() {
    const sky = useSky();
    if (!sky) return null;
    const { moon, highlight, night } = sky;
    const aurora = highlight.kind === 'aurora' && sky.aurora?.level === 'alert';
    const [level, word, dots] = QUALITY[night.quality.level];
    return (
        <WidgetCard className={`sky-card ${aurora ? 'aurora' : ''}`} label="Ciel ce soir" title="Ciel ce soir" to="/climate/weather#ciel"
            pills={aurora
                ? <StatusPill level="info">Alerte aurore</StatusPill>
                : (
                    <StatusPill level={level} label={night.quality.label}>
                        <span className="sky-dots" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= dots ? 'on' : ''} />)}</span>
                        {word}
                    </StatusPill>
                )}>
            <div className="sky-card-moon">
                <MoonCanvas size={56} fraction={moon.fraction} waxing={moon.waxing} label={`${moon.name}, ${pct(moon.fraction)} éclairée`} />
                <div>
                    <strong>{moon.name}</strong>
                    <span className="muted">{pct(moon.fraction)} · {moon.up ? `se couche ${hm(moon.set)}` : `se lève ${hm(moon.rise)}`}</span>
                    <span className={`sky-next k-${highlight.kind}`}>{highlight.title}</span>
                </div>
            </div>
        </WidgetCard>
    );
}
