import { useCallback, useEffect, useState } from 'react';
import type { Home } from '../../../hooks/useHome';
import { useCity } from '../../city/useCity';
import { useSky } from '../../sky/sky';
import { bixiPoll, cooperPoll, mailboxPoll } from './polls';
import {
    arrange, bixiRelevance, cityRelevance, cooperRelevance, houseRelevance,
    journalRelevance, mailRelevance, metroRelevance, skyRelevance,
} from './relevance';
import type { Arrangement, WidgetId, WidgetState } from './relevance';

/** Une pastille touchée montre sa carte pendant ce temps, puis repart dans le bandeau. */
const PEEK_MS = 2 * 60_000;

/** La pertinence de chaque widget d'après son état, et la mise en page qui en découle. */
export function useHomeWidgets(home: Home): {
    states: WidgetState[];
    arrangement: Arrangement;
    peek: WidgetId[];
    togglePeek: (id: WidgetId) => void;
} {
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
        journalRelevance(home.log.length),
    ];
    const arrangement = arrange(states);

    // Pastilles ouvertes à la main : elles se referment seules
    const [peek, setPeek] = useState<{ id: WidgetId; until: number }[]>([]);
    const togglePeek = useCallback((id: WidgetId) => setPeek((list) =>
        list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : [...list, { id, until: Date.now() + PEEK_MS }]), []);
    useEffect(() => {
        if (!peek.length) return;
        const next = Math.min(...peek.map((p) => p.until)) - Date.now();
        const t = setTimeout(() => setPeek((list) => list.filter((p) => p.until > Date.now())), Math.max(0, next));
        return () => clearTimeout(t);
    }, [peek]);

    // Une pastille ouverte qui devient une carte d'elle-même n'a plus besoin de l'être
    const open = peek.map((p) => p.id).filter((id) => arrangement.chips.includes(id));
    return { states, arrangement, peek: open, togglePeek };
}
