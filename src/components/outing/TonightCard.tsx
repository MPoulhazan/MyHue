import { tonightPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import type { Tonight } from '../../pages/outingTypes';
import './Outing.css';

// « Ce soir à deux » (maquette 4) : le jour d'une sortie prévue, l'heure de départ, Cooper et la météo

const hm = (ts: number) => {
    const d = new Date(ts);
    const m = d.getMinutes();
    return `${d.getHours()} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};
const span = (min: number) => {
    const h = Math.floor(min / 60);
    const q = Math.round((min % 60) / 15) * 15;
    return q === 60 ? `${h + 1} h` : q ? `${h} h ${q}` : `${h} h`;
};

/** Les lignes du programme, partagées par la carte de l'accueil et celle de Ma journée. */
export function TonightRows({ t }: { t: Tonight }) {
    return (
        <ul className="tn-rows">
            {t.leaveAt != null && (
                <li><strong className="tn-at go">{hm(t.leaveAt)}</strong>
                    <span>Partir {t.modeLabel} ({t.travelMin} min){t.bikes != null && t.station ? `, ${t.bikes} vélo${t.bikes > 1 ? 's' : ''} à ${t.station}` : ''}{t.bikeSkipped ? ', pas de BIXI avec ce temps' : ''}</span></li>
            )}
            {t.cooper && (
                <li><strong className="tn-at cooper">avant {hm(t.cooper.before)}</strong>
                    <span>Promenade et repas de Cooper : il sera seul environ {span(t.cooper.awayMin)}</span></li>
            )}
            {(t.weather.go || t.weather.back) && (
                <li><strong className="tn-at sky">Météo</strong>
                    <span>{[t.weather.go && `Aller : ${t.weather.go}`, t.weather.back && `retour : ${t.weather.back}`].filter(Boolean).join(' · ')}</span></li>
            )}
        </ul>
    );
}

const statusPill = (t: Tonight) =>
    t.status === 'confirmed' ? <StatusPill level="ok">confirmé</StatusPill>
        : <StatusPill level="warn">en attente{t.to ? ` de ${t.to.name}` : ''}</StatusPill>;

/** Carte de l'accueil (liste « Maintenant ») : en carte toute la journée de la sortie. */
export function TonightCard() {
    const data = tonightPoll.use();
    const t = data?.tonight;
    if (!t) return null;
    return (
        <WidgetCard className="tn-card" label="Ce soir à deux" title="Ce soir à deux" to="/journee" pills={statusPill(t)}>
            <p className="tn-title"><strong>{t.title} · {hm(t.start)}</strong>{t.where ? <span> · {t.where}</span> : null}</p>
            <TonightRows t={t} />
        </WidgetCard>
    );
}
