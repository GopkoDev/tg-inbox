import type { ActivityKind } from './activity.js';
import { activityKindFor } from './activity.js';

export type ConversationStatus = 'open' | 'closed';
export type ReplyState = 'sending' | 'sent' | 'not_delivered' | 'not_confirmed';
export type CloseReason =
  | 'state_changed'
  | 'customer_waiting'
  | 'unread_customer_message'
  | 'new_customer_message'
  | 'reply_not_delivered'
  | 'reply_not_confirmed';

export interface LatestReply {
  id: string;
  state: ReplyState;
}

export interface CloseSnapshot {
  customerMessageSeq: number;
  latestReply: LatestReply | null;
}

export interface ConversationState {
  status: ConversationStatus;
  assigneeAccountId: string | null;
  stateVersion: number;
  customerMessageSeq: number;
}

export type ChangeRequest =
  | { type: 'assign'; assigneeAccountId: string; expectedVersion: number }
  | { type: 'unassign'; expectedVersion: number }
  | { type: 'close'; expectedVersion: number; snapshot: CloseSnapshot; confirm: boolean }
  | { type: 'reopen'; expectedVersion: number };

/** Facts read under the conversation row lock; only a close uses them. */
export interface ChangeContext {
  customerWaiting: boolean;
  /** Arrival of the newest customer message, null when there is none. */
  newestCustomerArrival: Date | null;
  /** The later of the member's arrival watermark and active-since. */
  unreadFloor: Date;
  latestReply: LatestReply | null;
}

export type ChangeDecision =
  | { outcome: 'unchanged' }
  | { outcome: 'stale' }
  | { outcome: 'needs_confirmation'; reasons: CloseReason[] }
  | {
      outcome: 'allowed';
      kind: ActivityKind;
      previousAssignee: string | null;
      newAssignee: string | null;
    };

export function sameSnapshot(a: CloseSnapshot, b: CloseSnapshot): boolean {
  if (a.customerMessageSeq !== b.customerMessageSeq) return false;
  if (a.latestReply === null || b.latestReply === null) return a.latestReply === b.latestReply;
  return a.latestReply.id === b.latestReply.id && a.latestReply.state === b.latestReply.state;
}

/** The reasons to ask before closing, excluding `state_changed` (the version is checked apart). */
export function closeReasons(input: {
  customerWaiting: boolean;
  newestCustomerArrival: Date | null;
  unreadFloor: Date;
  current: CloseSnapshot;
  sent: CloseSnapshot;
}): CloseReason[] {
  const reasons: CloseReason[] = [];
  if (input.customerWaiting) reasons.push('customer_waiting');
  if (
    input.newestCustomerArrival &&
    input.newestCustomerArrival.getTime() > input.unreadFloor.getTime()
  ) {
    reasons.push('unread_customer_message');
  }
  if (input.current.customerMessageSeq > input.sent.customerMessageSeq) {
    reasons.push('new_customer_message');
  }
  const replyState = input.current.latestReply?.state;
  if (replyState === 'not_delivered') reasons.push('reply_not_delivered');
  if (replyState === 'not_confirmed') reasons.push('reply_not_confirmed');
  return reasons;
}

/** The no-op check runs before the version check; a member reopen evaluates no close reasons. */
export function decideChange(
  current: ConversationState,
  request: ChangeRequest,
  ctx: ChangeContext,
): ChangeDecision {
  const versionMatches = request.expectedVersion === current.stateVersion;
  const keep = current.assigneeAccountId;

  switch (request.type) {
    case 'assign': {
      if (keep === request.assigneeAccountId) return { outcome: 'unchanged' };
      if (!versionMatches) return { outcome: 'stale' };
      const kind = activityKindFor(keep, request.assigneeAccountId);
      if (!kind) return { outcome: 'unchanged' };
      return {
        outcome: 'allowed',
        kind,
        previousAssignee: keep,
        newAssignee: request.assigneeAccountId,
      };
    }
    case 'unassign': {
      if (keep === null) return { outcome: 'unchanged' };
      if (!versionMatches) return { outcome: 'stale' };
      return { outcome: 'allowed', kind: 'unassigned', previousAssignee: keep, newAssignee: null };
    }
    case 'reopen': {
      if (current.status === 'open') return { outcome: 'unchanged' };
      if (!versionMatches) return { outcome: 'stale' };
      return { outcome: 'allowed', kind: 'reopened', previousAssignee: keep, newAssignee: keep };
    }
    case 'close': {
      if (current.status === 'closed') return { outcome: 'unchanged' };
      const now: CloseSnapshot = {
        customerMessageSeq: current.customerMessageSeq,
        latestReply: ctx.latestReply,
      };
      const reasons = closeReasons({
        customerWaiting: ctx.customerWaiting,
        newestCustomerArrival: ctx.newestCustomerArrival,
        unreadFloor: ctx.unreadFloor,
        current: now,
        sent: request.snapshot,
      });
      const all: CloseReason[] = versionMatches ? reasons : ['state_changed', ...reasons];
      const confirmed = request.confirm && sameSnapshot(now, request.snapshot);
      if (all.length === 0 || (versionMatches && confirmed)) {
        return { outcome: 'allowed', kind: 'closed', previousAssignee: keep, newAssignee: keep };
      }
      return { outcome: 'needs_confirmation', reasons: all };
    }
  }
}
