import { BixiCard } from '../bixi/BixiCard';
import { MetroCard } from '../city/MetroCard';
import { useCity } from '../city/useCity';
import { CommunautoCard, CommunautoLauncher } from '../communauto/CommunautoCard';
import { bixiPoll, communautoPoll, commutePoll } from '../home/widgets/polls';
import { movesForm } from '../home/widgets/relevance';

// ── Carte « Déplacements » : une seule carte pour BIXI, bus, métro et Communauto ──

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
 * Montre la forme qui compte maintenant, choisie par movesForm (la même règle que la pastille) :
 * Communauto en cours, conseil de trajet en saison BIXI, état du métro hors saison, Communauto au repos.
 */
export function MovesCard() {
    const commute = commutePoll.use();
    const bixi = bixiPoll.use();
    const communauto = communautoPoll.use();
    const { view: city } = useCity();
    const form = movesForm({ commute, bixi, city, communauto });

    if (form === 'communauto' || form === 'communauto-idle') return <CommunautoCard />;
    const more = communauto ? <CommunautoMore /> : null;
    if (form === 'trip') return <BixiCard more={more} />;
    if (form === 'metro') return <MetroCard more={more} />;
    return null;
}
