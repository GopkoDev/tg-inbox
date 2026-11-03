export const POST_STATES = [
  'draft',
  'scheduled',
  'sending',
  'published',
  'deleted',
  'failed',
  'missed',
  'not_confirmed',
] as const;
export type PostState = (typeof POST_STATES)[number];

const TRANSITIONS: Record<PostState, readonly PostState[]> = {
  draft: ['scheduled'],
  scheduled: ['sending', 'draft', 'missed', 'failed'],
  sending: ['published', 'failed', 'not_confirmed'],
  published: ['deleted'],
  deleted: [],
  failed: [],
  missed: [],
  not_confirmed: [],
};

export function canTransition(from: PostState, to: PostState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Only a draft is edited in place; a scheduled post first goes back to draft. */
export function canEdit(state: PostState): boolean {
  return state === 'draft';
}

export function needsAttention(state: PostState): boolean {
  return state === 'failed' || state === 'missed' || state === 'not_confirmed';
}
