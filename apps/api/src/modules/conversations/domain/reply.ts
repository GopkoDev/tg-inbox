export const REPLY_STATES = ['sending', 'sent', 'not_delivered', 'not_confirmed'] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export const FAILURE_REASONS = [
  'customer_blocked',
  'customer_account_gone',
  'chat_not_found',
  'bot_not_working',
  'author_access_removed',
  'telegram_not_accepted',
  'delivery_interrupted',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

const TRANSITIONS: Record<ReplyState, readonly ReplyState[]> = {
  sending: ['sent', 'not_delivered', 'not_confirmed'],
  sent: [],
  not_delivered: ['sending'],
  not_confirmed: ['sending'],
};

export function canTransition(from: ReplyState, to: ReplyState): boolean {
  return TRANSITIONS[from].includes(to);
}
