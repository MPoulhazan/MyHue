import { BixiCard } from '../bixi/BixiCard';
import { MetroCard } from '../city/MetroCard';
import { CommunautoCard, CommunautoLauncher } from '../communauto/CommunautoCard';
import { communautoPoll } from '../home/widgets/polls';
import type { MovesForm } from '../home/widgets/meta';

// ── Carte « Déplacements » : une seule carte pour BIXI, bus, métro et Communauto ──

/** Dans le détail du trajet ou du métro : chercher une Communauto sans changer de carte. */
function CommunautoMore() {
    return (
        <section className="moves-more" aria-label="Communauto">
            <h3 className="sub-title">Une Communauto plutôt ?</h3>
            <CommunautoLauncher />
        </section>
    );
}

/**
 * Montre la forme choisie par le Pi avec la pastille (server/homeFeedLogic.js movesForm) :
 * Communauto en cours, conseil de trajet en saison BIXI, état du métro hors saison, Communauto au repos.
 */
export function MovesCard({ form }: { form: MovesForm }) {
    const communauto = communautoPoll.use();

    if (form === 'communauto' || form === 'communauto-idle') return <CommunautoCard />;
    const more = communauto ? <CommunautoMore /> : null;
    if (form === 'trip') return <BixiCard more={more} />;
    if (form === 'metro') return <MetroCard more={more} />;
    return null;
}
