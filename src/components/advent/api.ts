import axios from 'axios';
import { adventPoll } from '../home/widgets/polls';
import type { AdventOpenResult } from './types';

/** Ouvre une case (celle du jour par défaut) ; l'écran plein s'affiche par AdventReveal. */
export async function openAdventCase(n?: number) {
    const { data } = await axios.post<AdventOpenResult>('/api/advent/open', n ? { n } : {});
    adventPoll.publish(data.view);
    return data;
}
