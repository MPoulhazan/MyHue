import { createSharedPoll } from '../../../hooks/sharedPoll';
import type { CooperView } from '../../cooper/CooperCard';
import type { MailView } from '../../mailbox/MailboxCard';
import type { BixiView } from '../../bixi/BixiCard';
import type { Pin, WidgetId } from './relevance';

// Lectures partagées par les cartes et le registre des widgets : une requête par intervalle
export const cooperPoll = createSharedPoll<CooperView>('/api/cooper', 30_000);
export const mailboxPoll = createSharedPoll<MailView>('/api/mailbox', 30_000);
export const bixiPoll = createSharedPoll<BixiView>('/api/bixi', 60_000);

/** Réglages Auto / Toujours / Masqué, partagés par la tablette et le téléphone (server/homeWidgets.js) */
export interface PinsView { pins: Partial<Record<WidgetId, Pin>> }
export const pinsPoll = createSharedPoll<PinsView>('/api/home-widgets', 60_000);
