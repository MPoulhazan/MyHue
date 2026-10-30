import type { ServiceHealth } from '../../hooks/useHome';
import { Icon } from '../Icon';

const sinceLabel = (iso: string) => {
    const d = new Date(iso);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return `depuis ${time}`;
    return `depuis le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`;
};

/** Bandeau en haut de tous les écrans tant qu'un service de la maison est en panne. */
export function ServiceAlert({ services }: { services: ServiceHealth[] }) {
    const down = services.filter((s) => !s.ok);
    if (!down.length) return null;
    return (
        <div className="service-alert" role="alert">
            {down.map((s) => (
                <div key={s.id} className="service-alert-row">
                    <Icon name="alert" size={22} strokeWidth={2.2} />
                    <div>
                        <strong>{s.label} hors ligne</strong> <span className="service-alert-since">{sinceLabel(s.since)}</span>
                        {s.hint && <div className="service-alert-hint">{s.hint}</div>}
                    </div>
                </div>
            ))}
        </div>
    );
}
