import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Home } from '../../../hooks/useHome';
import { Icon } from '../../Icon';
import type { IconName } from '../../Icon';
import { HouseCard, Journal } from '../cards';
import { CityCard } from '../../city/CityCard';
import { CooperCard } from '../../cooper/CooperCard';
import { AdventCard } from '../../advent/AdventCard';
import { MailboxCard } from '../../mailbox/MailboxCard';
import { MovesCard } from '../../moves/MovesCard';
import { SkyCard } from '../../sky/SkyCard';
import { GuardCard } from '../../guard/GuardCard';
import { MusicCard } from '../../music/MusicCard';
import { WIDGET_META } from './meta';
import { WidgetSheet } from './WidgetCard';
import type { FeedItem, WidgetId } from './meta';
import './Widgets.css';

// ── Registre des widgets de l'accueil ────────────────────────────────────────
//
// Un nouveau widget s'ajoute ici, dans meta.ts (son libellé) et sur le Pi dans
// server/homeFeedLogic.js (sa pertinence), pas à la main dans Dashboard.tsx ou PhoneHome.tsx.

export interface WidgetCtx {
    home: Home;
    onAdd: () => void;
    /** L'état du widget selon le Pi (celui du moment du toucher pour une pastille ouverte) */
    itemOf: (id: WidgetId) => FeedItem | undefined;
}

const RENDER: Record<WidgetId, (ctx: WidgetCtx) => ReactNode> = {
    guard: () => <GuardCard />,
    city: () => <CityCard />,
    advent: () => <AdventCard />,
    cooper: () => <CooperCard />,
    mail: () => <MailboxCard />,
    music: ({ home }) => <MusicCard cast={home.cast} />,
    house: ({ home, onAdd }) => <HouseCard sensors={home.sensors} onAdd={onAdd} />,
    moves: ({ itemOf }) => <MovesCard form={itemOf('moves')?.form ?? null} />,
    sky: () => <SkyCard />,
    journal: ({ home }) => <Journal log={home.log} />,
};

const CHIP_ICON: Record<WidgetId, IconName | null> = {
    guard: 'shield', city: 'city', advent: 'gift', cooper: null, mail: 'mail', music: 'music', house: 'home', moves: 'bike', sky: 'moon', journal: 'list',
};

/** Les cartes pleines des widgets demandés, dans l'ordre donné. */
export function HomeWidgets({ ctx, ids }: { ctx: WidgetCtx; ids: WidgetId[] }) {
    return ids.map((id) => <Fragment key={id}>{RENDER[id](ctx)}</Fragment>);
}


/**
 * Panneau « Tout voir » de l'accueil : ce que « Maintenant » ne montre pas, une ligne chacun.
 * En toucher un ouvre sa carte dans « Maintenant » pendant un moment ; le retoucher la retire.
 */
export function AllWidgetsSheet({ states, ids, open, onPick, onClose }: {
    states: FeedItem[];
    ids: WidgetId[];
    open: WidgetId[];
    onPick: (id: WidgetId) => void;
    onClose: () => void;
}) {
    return (
        <WidgetSheet title="Tout voir" className="all-sheet" onClose={onClose}>
            <p className="all-lead">Touche une ligne pour ouvrir sa carte dans « Maintenant ».</p>
            <div className="all-list">
                {ids.map((id) => {
                    const icon = CHIP_ICON[id];
                    const shown = open.includes(id);
                    return (
                        <button key={id} type="button" className={`all-row ${shown ? 'on' : ''}`} onClick={() => onPick(id)}>
                            <span className="all-icon">{icon ? <Icon name={icon} size={20} strokeWidth={2} /> : <img src="/cooper.jpg" alt="" width={28} height={28} />}</span>
                            <b>{WIDGET_META[id].label}</b>
                            <span className="all-summary">{shown ? 'affichée dans Maintenant · toucher pour la retirer' : states.find((s) => s.id === id)?.summary}</span>
                            <Icon name="chevron" size={18} strokeWidth={2.4} />
                        </button>
                    );
                })}
            </div>
            <Link to="/settings/widgets" className="all-settings" onClick={onClose}>Choisir ce qui s’affiche</Link>
        </WidgetSheet>
    );
}
