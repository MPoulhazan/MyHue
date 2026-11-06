import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Home } from '../../../hooks/useHome';
import { HouseCard, Journal } from '../cards';
import { CityCard } from '../../city/CityCard';
import { MetroCard } from '../../city/MetroCard';
import { CooperCard } from '../../cooper/CooperCard';
import { MailboxCard } from '../../mailbox/MailboxCard';
import { BixiCard } from '../../bixi/BixiCard';
import { SkyCard } from '../../sky/SkyCard';
import { WIDGET_META, WIDGET_ORDER } from './relevance';
import type { WidgetId, WidgetMeta } from './relevance';

// ── Registre des widgets de l'accueil ────────────────────────────────────────
//
// Un nouveau widget s'ajoute ici et dans relevance.ts (sa pertinence, son libellé),
// pas à la main dans Dashboard.tsx ou PhoneHome.tsx.

export interface WidgetCtx {
    home: Home;
    onAdd: () => void;
}

const RENDER: Record<WidgetId, (ctx: WidgetCtx) => ReactNode> = {
    city: () => <CityCard />,
    cooper: () => <CooperCard />,
    mail: () => <MailboxCard />,
    house: ({ home, onAdd }) => <HouseCard sensors={home.sensors} onAdd={onAdd} />,
    bixi: () => <BixiCard />,
    metro: () => <MetroCard />,
    sky: () => <SkyCard />,
    journal: ({ home }) => <Journal log={home.log} />,
};

/** Les widgets retenus par `keep`, dans l'ordre du registre. */
export function HomeWidgets({ ctx, keep }: { ctx: WidgetCtx; keep: (meta: WidgetMeta) => boolean }) {
    return WIDGET_ORDER.filter((id) => keep(WIDGET_META[id]))
        .map((id) => <Fragment key={id}>{RENDER[id](ctx)}</Fragment>);
}
