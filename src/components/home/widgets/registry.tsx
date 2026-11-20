import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Home } from '../../../hooks/useHome';
import { Icon } from '../../Icon';
import type { IconName } from '../../Icon';
import { HouseCard, Journal } from '../cards';
import { CityCard } from '../../city/CityCard';
import { CooperCard } from '../../cooper/CooperCard';
import { MailboxCard } from '../../mailbox/MailboxCard';
import { MovesCard } from '../../moves/MovesCard';
import { SkyCard } from '../../sky/SkyCard';
import { GuardCard } from '../../guard/GuardCard';
import { MusicCard } from '../../music/MusicCard';
import { WIDGET_META } from './meta';
import type { FeedItem, WidgetId } from './meta';
import './Widgets.css';

// ── Registre des widgets de l'accueil ────────────────────────────────────────
//
// Un nouveau widget s'ajoute ici et dans relevance.ts (sa pertinence, son libellé),
// pas à la main dans Dashboard.tsx ou PhoneHome.tsx.

export interface WidgetCtx {
    home: Home;
    onAdd: () => void;
    /** L'état du widget selon le Pi (celui du moment du toucher pour une pastille ouverte) */
    itemOf: (id: WidgetId) => FeedItem | undefined;
}

const RENDER: Record<WidgetId, (ctx: WidgetCtx) => ReactNode> = {
    guard: () => <GuardCard />,
    city: () => <CityCard />,
    cooper: () => <CooperCard />,
    mail: () => <MailboxCard />,
    music: ({ home }) => <MusicCard cast={home.cast} />,
    house: ({ home, onAdd }) => <HouseCard sensors={home.sensors} onAdd={onAdd} />,
    moves: ({ itemOf }) => <MovesCard form={itemOf('moves')?.form ?? null} />,
    sky: () => <SkyCard />,
    journal: ({ home }) => <Journal log={home.log} />,
};

const CHIP_ICON: Record<WidgetId, IconName | null> = {
    guard: 'shield', city: 'city', cooper: null, mail: 'mail', music: 'music', house: 'home', moves: 'bike', sky: 'moon', journal: 'list',
};

/** Les cartes pleines des widgets demandés, dans l'ordre donné. */
export function HomeWidgets({ ctx, ids }: { ctx: WidgetCtx; ids: WidgetId[] }) {
    return ids.map((id) => <Fragment key={id}>{RENDER[id](ctx)}</Fragment>);
}

/** Bandeau « Rien de neuf » : une pastille par widget calme ; la toucher ouvre sa carte un moment. */
export function WidgetChips({ states, ids, open, onToggle }: {
    states: FeedItem[];
    ids: WidgetId[];
    open: WidgetId[];
    onToggle: (id: WidgetId) => void;
}) {
    if (!ids.length) return null;
    return (
        <nav className="widget-chips" aria-label="Rien de neuf">
            <span className="widget-chips-label">Rien de neuf</span>
            {ids.map((id) => {
                const icon = CHIP_ICON[id];
                const on = open.includes(id);
                return (
                    <button key={id} type="button" className={`widget-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onToggle(id)}>
                        {icon ? <Icon name={icon} size={18} strokeWidth={2} /> : <img className="widget-chip-photo" src="/cooper.jpg" alt="" width={24} height={24} />}
                        <b>{WIDGET_META[id].label}</b>
                        <span>{states.find((s) => s.id === id)?.summary}</span>
                    </button>
                );
            })}
        </nav>
    );
}
