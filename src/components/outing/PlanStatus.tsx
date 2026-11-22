import axios from 'axios';
import { Icon } from '../Icon';
import type { Plan } from '../../pages/outingTypes';
import { planWhen } from './planWhen';
import './Outing.css';

// La sortie prévue et où en est l'invitation : envoyée, en attente, confirmée, refusée

export function PlanStatus({ plan, onChange, onShowCode, compact = false }: { plan: Plan; onChange: () => void; onShowCode: () => void; compact?: boolean }) {
    const act = async (action: 'confirm' | 'decline' | 'cancel') => {
        await axios.post(`/api/day/plan/${action}`).catch(() => {});
        onChange();
    };
    const who = plan.to?.name || 'l’autre';
    const line = {
        sent: 'Invitation envoyée',
        pending: `En attente de ${who}`,
        confirmed: 'Confirmé',
        declined: `${who} ne peut pas`,
    }[plan.status];
    const open = plan.status === 'sent' || plan.status === 'pending';

    return (
        <div className={`ps ps-${plan.status} ${compact ? 'compact' : ''}`}>
            {!compact && <strong className="ps-title">{plan.title}</strong>}
            <span className="ps-when">{planWhen(plan.start)}{plan.where && !compact ? ` · ${plan.where}` : ''}</span>
            <span className="ps-line" aria-live="polite">
                {plan.status === 'confirmed' ? <Icon name="check" size={18} strokeWidth={2.5} /> : <span className="ps-dot" aria-hidden="true" />}
                {line}
            </span>
            {open && plan.tracked && <span className="ps-sub">La réponse de {who} s’affichera ici toute seule.</span>}
            <div className="ps-actions">
                {open && <button className="ps-btn" onClick={() => act('confirm')}>{who} a dit oui</button>}
                {open && <button className="ps-btn quiet" onClick={onShowCode}>Revoir le code</button>}
                {plan.status === 'declined' && <button className="ps-btn" onClick={() => act('cancel')}>Choisir autre chose</button>}
                {plan.status !== 'declined' && <button className="ps-btn quiet" onClick={() => act('cancel')}>Annuler la sortie</button>}
            </div>
        </div>
    );
}
