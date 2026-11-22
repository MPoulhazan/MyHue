import { createSharedPoll } from '../../../hooks/sharedPoll';
import type { CooperView } from '../../cooper/CooperCard';
import type { MailView } from '../../mailbox/MailboxCard';
import type { BixiView } from '../../bixi/BixiCard';
import type { GuardView } from '../../guard/GuardCard';
import type { ActiveAlarm } from '../../alarm/HomeAlarm';
import type { CommunautoView } from '../../communauto/CommunautoCard';
import type { CommuteView } from '../../commute/CommuteCard';
import type { MusicHome } from '../../../services/musicApi';
import type { AdventView } from '../../advent/types';
import type { VeilleeStatus } from '../../veillee/VeilleeCard';
import type { NoelView } from '../../noel/NoelMorning';
import type { HomeFeed, Pin, WidgetId } from './meta';
import type { Tonight } from '../../../pages/outingTypes';

// Lectures partagées par les cartes et le registre des widgets : une requête par intervalle
export const cooperPoll = createSharedPoll<CooperView>('/api/cooper', 30_000);
export const mailboxPoll = createSharedPoll<MailView>('/api/mailbox', 30_000);
export const bixiPoll = createSharedPoll<BixiView>('/api/bixi', 60_000);
// 20 s : le rythme de la recherche côté serveur, pour voir une auto trouvée aussitôt
export const communautoPoll = createSharedPoll<CommunautoView>('/api/communauto', 20_000);
// Conseil de trajet : son horaire décide aussi quand la carte Déplacements passe devant
export const commutePoll = createSharedPoll<CommuteView>('/api/commute', 60_000);
// Fumée et fuite : l'écran d'alarme doit arriver vite
export const alarmPoll = createSharedPoll<{ active: ActiveAlarm[] }>('/api/alarm', 3_000);
export const guardPoll = createSharedPoll<GuardView>('/api/guard', 30_000);
// Calendrier de l'Avent : 15 s pour que la case ouverte à la voix s'affiche vite sur la tablette
// ?adventdemo=2026-12-12 : l'écran du calendrier tel qu'il sera ce jour-là (sans rien ouvrir)
const adventDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('adventdemo') : null;
export const adventPoll = createSharedPoll<AdventView>(adventDemo ? `/api/advent?at=${encodeURIComponent(adventDemo)}` : '/api/advent', 15_000);
// Veillée de Noël (décembre)
export const veilleePoll = createSharedPoll<VeilleeStatus>('/api/veillee', 30_000);
// Matin de Noël : l'écran « Il est passé ! » doit arriver vite
export const noelPoll = createSharedPoll<NoelView>('/api/noel', 15_000);
// Ce soir à deux : le jour d'une sortie prévue
export const tonightPoll = createSharedPoll<{ tonight: Tonight | null }>('/api/day/tonight', 60_000);
export const musicPoll = createSharedPoll<MusicHome>('/api/music/home', 60_000);

/** Liste « Maintenant » calculée par le Pi ; relue aussi aux bascules d'heure et quand un capteur change */
export const feedPoll = createSharedPoll<HomeFeed>('/api/home-feed', 20_000);

/** Réglages Auto / Toujours / Masqué, partagés par la tablette et le téléphone (server/homeWidgets.js) */
export interface PinsView { pins: Partial<Record<WidgetId, Pin>> }
export const pinsPoll = createSharedPoll<PinsView>('/api/home-widgets', 60_000);
