import type { Home } from '../../../hooks/useHome';
import { useCity } from '../../city/useCity';
import { useSky } from '../../sky/sky';
import { bixiPoll, cooperPoll, mailboxPoll } from './polls';
import {
    arrange, bixiRelevance, cityRelevance, cooperRelevance, houseRelevance,
    journalRelevance, mailRelevance, metroRelevance, skyRelevance,
} from './relevance';
import type { Arrangement, WidgetState } from './relevance';

/** La pertinence de chaque widget d'après son état, et la mise en page qui en découle. */
export function useHomeWidgets(home: Home): { states: WidgetState[]; arrangement: Arrangement } {
    const { view: city } = useCity();
    const cooper = cooperPoll.use();
    const mail = mailboxPoll.use();
    const bixi = bixiPoll.use();
    const sky = useSky();

    const states = [
        cityRelevance(city),
        cooperRelevance(cooper),
        mailRelevance(mail),
        houseRelevance(home.sensors),
        bixiRelevance(bixi),
        metroRelevance(city),
        skyRelevance(sky),
        journalRelevance(),
    ];
    return { states, arrangement: arrange(states) };
}
