import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import {
  changeRetryAt,
  CHANGE_WINDOW_MS,
  limitReached,
  positionAt,
  type ActivityCause,
  type ActivityKind,
} from '../domain/activity.js';
import {
  decideChange,
  type ChangeRequest,
  type CloseReason,
  type CloseSnapshot,
} from '../domain/state.js';
import type {
  ActivityRepo,
  ActivityView,
  ConversationRepo,
  ConversationSignals,
  Executor,
  LockedState,
} from './ports.js';

export interface StateChangeDeps {
  conversations: ConversationRepo;
  activities: ActivityRepo;
  signals: ConversationSignals;
}

export interface RecordChangeInput {
  workspaceId: string;
  conversationId: string;
  kind: ActivityKind;
  cause: ActivityCause;
  /** Null for the automatic causes, which never count against the change limit. */
  actorAccountId: string | null;
  previousAssignee: string | null;
  newAssignee: string | null;
  /** The clock read after the conversation row lock was taken. */
  now: Date;
}

export interface RecordedChange {
  stateVersion: number;
  activity: ActivityView;
}

/**
 * The one place a state change is written: versioned update, activity entry (positioned no earlier
 * than the conversation's latest entry) and its signal, all on the caller's transaction. The caller
 * holds the conversation row lock and has decided the change; automatic causes (the customer wrote,
 * a reply failed, a member was deactivated) call this directly and skip the limit.
 */
export async function recordChange(
  deps: StateChangeDeps,
  tx: Executor,
  input: RecordChangeInput,
): Promise<RecordedChange> {
  const { conversations, activities, signals } = deps;
  const { workspaceId, conversationId, kind } = input;
  const assignment = kind === 'assigned' || kind === 'reassigned' || kind === 'unassigned';
  const stateVersion = await conversations.writeState(
    workspaceId,
    conversationId,
    assignment
      ? { assigneeAccountId: input.newAssignee }
      : { status: kind === 'closed' ? 'closed' : 'open' },
    tx,
  );
  if (stateVersion === null) throw new Error('conversation vanished under its row lock');

  const latest = await activities.latestFor(workspaceId, conversationId, tx);
  const activity: ActivityView = {
    id: newId(),
    conversationId,
    kind,
    cause: input.cause,
    actorAccountId: input.actorAccountId,
    previousAssigneeAccountId: assignment ? input.previousAssignee : null,
    newAssigneeAccountId: assignment ? input.newAssignee : null,
    positionAt: positionAt(input.now, latest?.positionAt ?? null),
    createdAt: input.now,
  };
  await activities.insert(workspaceId, activity, tx);
  await signals.activityChanged(tx, { workspaceId, conversationId, activityId: activity.id });
  return { stateVersion, activity };
}

export interface ChangeAssigneeInput {
  workspaceId: string;
  actorAccountId: string;
  conversationId: string;
  /** Null unassigns. */
  assigneeAccountId: string | null;
  expectedStateVersion: number;
}

export type ChangeStatusInput = {
  workspaceId: string;
  actorAccountId: string;
  conversationId: string;
  expectedStateVersion: number;
} & (
  | {
      to: 'closed';
      expectedCloseSnapshot: CloseSnapshot;
      confirm: boolean;
      /** The caller's membership `active_since`: messages before it count as read. */
      actorActiveSince: Date;
    }
  | { to: 'open' }
);

/** The refusals are results, not throws: `inbox` adds names and the summary and raises the errors. */
export type ChangeResult =
  | { outcome: 'recorded'; state: LockedState; activity: ActivityView }
  | { outcome: 'unchanged'; state: LockedState; latestChange: ActivityView | null }
  | { outcome: 'stale'; state: LockedState; latestChange: ActivityView | null }
  | {
      outcome: 'needs_confirmation';
      reasons: CloseReason[];
      state: LockedState;
      /** The snapshot a "close anyway" must send back. */
      snapshot: CloseSnapshot;
      latestChange: ActivityView | null;
      newestUnreadMessage: { id: string; receivedAt: Date } | null;
    }
  | { outcome: 'limited'; retryAt: Date }
  | { outcome: 'not_found' };

export interface StateChanges {
  changeAssignee(tx: Executor, input: ChangeAssigneeInput): Promise<ChangeResult>;
  changeStatus(tx: Executor, input: ChangeStatusInput): Promise<ChangeResult>;
}

export function createStateChanges(deps: StateChangeDeps & { clock: Clock }): StateChanges {
  const { conversations, activities, clock } = deps;

  /** Lock row → decide → limit → write; the order of sad.md §6, critical flow 1. */
  async function run(
    tx: Executor,
    base: { workspaceId: string; actorAccountId: string; conversationId: string },
    request: ChangeRequest,
    close: { activeSince: Date } | null,
  ): Promise<ChangeResult> {
    const { workspaceId, conversationId } = base;
    const state = await conversations.lockState(workspaceId, conversationId, tx);
    if (!state) return { outcome: 'not_found' };
    const now = clock.now();

    // Close reasons are read only for a close; every other request ignores them.
    const unread = close
      ? await conversations.newestUnreadCustomerMessage(
          workspaceId,
          conversationId,
          base.actorAccountId,
          close.activeSince,
          tx,
        )
      : null;
    const latestReply = close
      ? await conversations.latestReply(workspaceId, conversationId, tx)
      : null;

    const decision = decideChange(state, request, {
      customerWaiting: state.waitingForReply,
      // The read already applied the member's watermark; any arrival it returns is past the floor.
      newestCustomerArrival: unread?.receivedAt ?? null,
      unreadFloor: new Date(0),
      latestReply,
    });

    switch (decision.outcome) {
      case 'unchanged':
      case 'stale':
        return {
          outcome: decision.outcome,
          state,
          latestChange: await activities.latestFor(workspaceId, conversationId, tx),
        };
      case 'needs_confirmation':
        return {
          outcome: 'needs_confirmation',
          reasons: decision.reasons,
          state,
          snapshot: { customerMessageSeq: state.customerMessageSeq, latestReply },
          latestChange: await activities.latestFor(workspaceId, conversationId, tx),
          newestUnreadMessage: unread,
        };
      case 'allowed': {
        // Only an allowed change is counted, so a refused or in-place request never is.
        const since = new Date(now.getTime() - CHANGE_WINDOW_MS);
        const { count, oldestCreatedAt } = await activities.countByActorSince(
          workspaceId,
          base.actorAccountId,
          since,
          tx,
        );
        if (limitReached(count) && oldestCreatedAt) {
          return { outcome: 'limited', retryAt: changeRetryAt(oldestCreatedAt) };
        }
        const recorded = await recordChange(deps, tx, {
          workspaceId,
          conversationId,
          kind: decision.kind,
          cause: 'member',
          actorAccountId: base.actorAccountId,
          previousAssignee: decision.previousAssignee,
          newAssignee: decision.newAssignee,
          now,
        });
        return {
          outcome: 'recorded',
          state: {
            ...state,
            stateVersion: recorded.stateVersion,
            ...(decision.kind === 'closed' ? { status: 'closed' as const } : {}),
            ...(decision.kind === 'reopened' ? { status: 'open' as const } : {}),
            ...(['assigned', 'reassigned', 'unassigned'].includes(decision.kind)
              ? { assigneeAccountId: decision.newAssignee }
              : {}),
          },
          activity: recorded.activity,
        };
      }
    }
  }

  return {
    changeAssignee(tx, input) {
      const { assigneeAccountId, expectedStateVersion } = input;
      return run(
        tx,
        input,
        assigneeAccountId === null
          ? { type: 'unassign', expectedVersion: expectedStateVersion }
          : { type: 'assign', assigneeAccountId, expectedVersion: expectedStateVersion },
        null,
      );
    },
    changeStatus(tx, input) {
      if (input.to === 'open') {
        return run(
          tx,
          input,
          { type: 'reopen', expectedVersion: input.expectedStateVersion },
          null,
        );
      }
      return run(
        tx,
        input,
        {
          type: 'close',
          expectedVersion: input.expectedStateVersion,
          snapshot: input.expectedCloseSnapshot,
          confirm: input.confirm,
        },
        { activeSince: input.actorActiveSince },
      );
    },
  };
}
