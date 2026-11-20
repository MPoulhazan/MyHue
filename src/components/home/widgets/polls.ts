import { createSharedPoll } from '../../../hooks/sharedPoll';
import type { CooperView } from '../../cooper/CooperCard';
import type { MailView } from '../../mailbox/MailboxCard';
import type { BixiView } from '../../bixi/BixiCard';
import type { GuardView } from '../../guard/GuardCard';
import type { CommunautoView } from '../../communauto/CommunautoCard';
import type { CommuteView } from '../../commute/CommuteCard';
import type { MusicHome } from '../../../services/musicApi';
import type { Pin, WidgetId } from './relevance';

// Lectures partagées par les cartes et le registre des widgets : une requête par intervalle
export const cooperPoll = createSharedPoll<CooperView>('/api/cooper', 30_000);
export const mailboxPoll = createSharedPoll<MailView>('/api/mailbox', 30_000);
export const bixiPoll = createSharedPoll<BixiView>('/api/bixi', 60_000);
// 20 s : le rythme de la recherche côté serveur, pour voir une auto trouvée aussitôt
export const communautoPoll = createSharedPoll<CommunautoView>('/api/communauto', 20_000);
// Conseil de trajet : son horaire décide aussi quand la carte Déplacements passe devant
export const commutePoll = createSharedPoll<CommuteView>('/api/commute', 60_000);
export const guardPoll = createSharedPoll<GuardView>('/api/guard', 30_000);
export const musicPoll = createSharedPoll<MusicHome>('/api/music/home', 60_000);

/** Réglages Auto / Toujours / Masqué, partagés par la tablette et le téléphone (server/homeWidgets.js) */
export interface PinsView { pins: Partial<Record<WidgetId, Pin>> }
export const pinsPoll = createSharedPoll<PinsView>('/api/home-widgets', 60_000);
