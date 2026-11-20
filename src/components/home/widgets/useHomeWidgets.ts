import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import type { Home } from '../../../hooks/useHome';
import { feedPoll } from './polls';
import type { FeedItem, HomeFeed, WidgetId } from './meta';

/** Une pastille touchée montre sa carte pendant ce temps, puis repart dans le bandeau. */
const PEEK_MS = 2 * 60_000;

/** Relit la liste tout de suite, sans le cache de 15 s du Pi. */
const loadFresh = () => axios.get<HomeFeed>('/api/home-feed', { params: { fresh: 1 } }).then(({ data }) => feedPoll.publish(data)).catch(() => {});

/** Ce qui change la pertinence de la carte Maison : portes, fuites, fumée, piles, capteurs muets. */
const sensorsKey = (sensors: Home['sensors']) => sensors
    .map((s) => `${s.did}:${s.isOnline ? 1 : 0}:${s.props.isOpen ? 1 : 0}:${s.props.leak ? 1 : 0}:${s.props.smoke ? 1 : 0}:${(s.props.battery ?? 100) < 20 ? 1 : 0}`)
    .join('|');

/**
 * La liste « Maintenant » calculée par le Pi (/api/home-feed) : les cartes, les pastilles,
 * et les pastilles ouvertes à la main.
 */
export function useHomeWidgets(home: Home): {
    states: FeedItem[];
    arrangement: { cards: WidgetId[]; chips: WidgetId[] };
    peek: WidgetId[];
    /** Toutes les cartes ouvertes à la main, même celles déjà en carte (le téléphone n'en montre que 3) */
    peekAll: WidgetId[];
    togglePeek: (id: WidgetId) => void;
    /** L'état d'un widget tel que la carte doit le montrer (celui du moment du toucher pour une pastille ouverte) */
    itemOf: (id: WidgetId) => FeedItem | undefined;
} {
    const feed = feedPoll.use();

    // Une bascule d'heure annoncée par le Pi (départ, soir, matin) : on relit à ce moment-là
    useEffect(() => {
        if (!feed?.nextChange) return;
        const t = setTimeout(loadFresh, Math.max(1000, feed.nextChange - Date.now() + 1000));
        return () => clearTimeout(t);
    }, [feed?.nextChange]);

    // Une porte qui s'ouvre, une fuite : la carte Maison arrive sans attendre le prochain relevé
    const key = sensorsKey(home.sensors);
    const firstKey = useRef(key);
    useEffect(() => {
        if (key === firstKey.current) return;
        const t = setTimeout(loadFresh, 800);
        return () => clearTimeout(t);
    }, [key]);

    const states = useMemo(() => feed?.items ?? [], [feed]);
    const arrangement = useMemo(() => ({ cards: feed?.cards ?? [], chips: feed?.chips ?? [] }), [feed]);

    // Pastilles ouvertes à la main : elles gardent l'état du moment du toucher, puis se referment seules
    const [peek, setPeek] = useState<{ id: WidgetId; until: number; item?: FeedItem }[]>([]);
    const togglePeek = useCallback((id: WidgetId) => setPeek((list) =>
        list.some((p) => p.id === id)
            ? list.filter((p) => p.id !== id)
            : [...list, { id, until: Date.now() + PEEK_MS, item: states.find((s) => s.id === id) }]), [states]);
    useEffect(() => {
        if (!peek.length) return;
        const next = Math.min(...peek.map((p) => p.until)) - Date.now();
        const t = setTimeout(() => setPeek((list) => list.filter((p) => p.until > Date.now())), Math.max(0, next));
        return () => clearTimeout(t);
    }, [peek]);

    // Une pastille ouverte qui devient une carte d'elle-même n'a plus besoin de l'être
    const open = peek.filter((p) => arrangement.chips.includes(p.id));
    const itemOf = (id: WidgetId) => peek.find((p) => p.id === id)?.item ?? states.find((s) => s.id === id);
    return { states, arrangement, peek: open.map((p) => p.id), peekAll: peek.map((p) => p.id), togglePeek, itemOf };
}
