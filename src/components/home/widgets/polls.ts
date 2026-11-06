import { createSharedPoll } from '../../../hooks/sharedPoll';
import type { CooperView } from '../../cooper/CooperCard';
import type { MailView } from '../../mailbox/MailboxCard';
import type { BixiView } from '../../bixi/BixiCard';

// Lectures partagées par les cartes et le registre des widgets : une requête par intervalle
export const cooperPoll = createSharedPoll<CooperView>('/api/cooper', 30_000);
export const mailboxPoll = createSharedPoll<MailView>('/api/mailbox', 30_000);
export const bixiPoll = createSharedPoll<BixiView>('/api/bixi', 60_000);
