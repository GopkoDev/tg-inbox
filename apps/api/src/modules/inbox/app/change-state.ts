import type { ConversationStateChange, ConversationSummary } from '@tg/shared';
import {
  AccessRemovedError,
  AssigneeNotActiveError,
  ChangeLimitReachedError,
  CloseNeedsConfirmationError,
  ConversationStateChangedError,
  NotFoundError,
} from '../../../platform/errors.js';
import type { ActivityView, LockedState } from '../../conversations/app/ports.js';
import type { CloseSnapshot } from '../../conversations/domain/state.js';
import type { ChangeResult } from '../../conversations/app/state-changes.js';
import type { Member } from './reads.js';
import { activityDto, orNull } from './reads.js';
import type { ChangeStateDeps } from './ports.js';

/**
 * The member changes of a conversation (flow 5): one transaction that share-locks the memberships,
 * then changes the conversation (sad.md §8 lock order: memberships, conversation row, limit lock,
 * activity insert). The refusals of the contract are raised here, after the transaction, so a
 * refusal never leaves anything behind.
 */
export function createChangeState(deps: ChangeStateDeps) {
  const { transaction, workspaces, changes, reads, clock } = deps;

  async function namesOf(
    workspaceId: string,
    activities: (ActivityView | null)[],
    state?: LockedState,
  ) {
    const ids = new Set<string>();
    if (state?.assigneeAccountId) ids.add(state.assigneeAccountId);
    for (const a of activities) {
      if (!a) continue;
      for (const id of [a.actorAccountId, a.previousAssigneeAccountId, a.newAssigneeAccountId]) {
        if (id !== null) ids.add(id);
      }
    }
    return ids.size ? workspaces.displayNames(workspaceId, [...ids]) : new Map<string, string>();
  }

  /**
   * The refusal's summary: what "close anyway" / "go ahead" echo — the version, status, assignee and
   * close snapshot — are the values checked under the row lock, never a read after the commit, so a
   * capture or a failed reply committed in between makes the next attempt ask again (AC-03, AC-06).
   * The rest (contact, preview, unread) comes from the summary read.
   */
  async function locked(
    workspaceId: string,
    member: Member,
    conversationId: string,
    result: { state: LockedState; snapshot: CloseSnapshot },
    names: Map<string, string>,
  ): Promise<ConversationSummary> {
    const read = await reads.getConversation(workspaceId, member, conversationId);
    const { state, snapshot } = result;
    return {
      ...read,
      state_version: state.stateVersion,
      status: state.status,
      assignee: orNull(names, state.assigneeAccountId),
      close_snapshot: {
        customer_message_seq: snapshot.customerMessageSeq,
        latest_reply: snapshot.latestReply && {
          id: snapshot.latestReply.id,
          state: snapshot.latestReply.state,
        },
      },
    };
  }

  /** Turns the use case's result into the 200 body, or the refusal it stands for. */
  async function answer(
    workspaceId: string,
    member: Member,
    conversationId: string,
    result: ChangeResult,
  ): Promise<ConversationStateChange> {
    switch (result.outcome) {
      case 'not_found':
        throw new NotFoundError('Not found');
      case 'limited':
        throw new ChangeLimitReachedError(
          result.retryAt,
          Math.max(1, Math.ceil((result.retryAt.getTime() - clock.now().getTime()) / 1000)),
        );
      case 'stale': {
        const names = await namesOf(workspaceId, [result.latestChange], result.state);
        throw new ConversationStateChangedError(
          await locked(workspaceId, member, conversationId, result, names),
          result.latestChange && activityDto(workspaceId, result.latestChange, names),
        );
      }
      case 'needs_confirmation': {
        const names = await namesOf(workspaceId, [result.latestChange], result.state);
        const unread = result.newestUnreadMessage;
        throw new CloseNeedsConfirmationError({
          reasons: result.reasons,
          // The contract names the stale change only when the version is a reason (AC-06).
          stale_change:
            result.reasons.includes('state_changed') && result.latestChange
              ? activityDto(workspaceId, result.latestChange, names)
              : null,
          newest_unread_message: unread && {
            id: unread.id,
            received_at: unread.receivedAt.toISOString(),
          },
          conversation: await locked(workspaceId, member, conversationId, result, names),
        });
      }
      case 'recorded':
      case 'unchanged': {
        const conversation = await reads.getConversation(workspaceId, member, conversationId);
        const activity = result.outcome === 'recorded' ? result.activity : null;
        const names = await namesOf(workspaceId, [activity]);
        return {
          workspace_id: workspaceId,
          outcome: result.outcome,
          conversation,
          activity: activity && activityDto(workspaceId, activity, names),
        };
      }
    }
  }

  /** Flow 5 steps 1-2: the caller and the pick under `FOR SHARE`, then the conversation. */
  function change(
    workspaceId: string,
    member: Member,
    conversationId: string,
    assigneeAccountId: string | null,
    expectedStateVersion: number,
  ): Promise<ConversationStateChange> {
    return transaction(async (tx) => {
      const wanted = [...new Set([member.accountId, assigneeAccountId ?? member.accountId])];
      const active = await workspaces.lockActiveMembers(tx, workspaceId, wanted);
      if (!active.includes(member.accountId)) {
        throw new AccessRemovedError('Your access to this workspace was removed');
      }
      if (assigneeAccountId !== null && !active.includes(assigneeAccountId)) {
        throw new AssigneeNotActiveError();
      }
      return changes.changeAssignee(tx, {
        workspaceId,
        actorAccountId: member.accountId,
        conversationId,
        assigneeAccountId,
        expectedStateVersion,
      });
    }).then((result) => answer(workspaceId, member, conversationId, result));
  }

  /** Flow 7 and 8: the caller under `FOR SHARE`, then the status change on the conversation. */
  function changeStatus(
    workspaceId: string,
    member: Member,
    conversationId: string,
    expectedStateVersion: number,
    to: { to: 'open' } | { to: 'closed'; snapshot: CloseSnapshot; confirm: boolean },
  ): Promise<ConversationStateChange> {
    return transaction(async (tx) => {
      const active = await workspaces.lockActiveMembers(tx, workspaceId, [member.accountId]);
      if (!active.includes(member.accountId)) {
        throw new AccessRemovedError('Your access to this workspace was removed');
      }
      const base = {
        workspaceId,
        actorAccountId: member.accountId,
        conversationId,
        expectedStateVersion,
      };
      return changes.changeStatus(
        tx,
        to.to === 'open'
          ? { ...base, to: 'open' }
          : {
              ...base,
              to: 'closed',
              expectedCloseSnapshot: to.snapshot,
              confirm: to.confirm,
              actorActiveSince: member.activeSince,
            },
      );
    }).then((result) => answer(workspaceId, member, conversationId, result));
  }

  return {
    close: (
      workspaceId: string,
      member: Member,
      conversationId: string,
      input: {
        expectedStateVersion: number;
        expectedCloseSnapshot: CloseSnapshot;
        confirm: boolean;
      },
    ) =>
      changeStatus(workspaceId, member, conversationId, input.expectedStateVersion, {
        to: 'closed',
        snapshot: input.expectedCloseSnapshot,
        confirm: input.confirm,
      }),

    reopen: (
      workspaceId: string,
      member: Member,
      conversationId: string,
      input: { expectedStateVersion: number },
    ) =>
      changeStatus(workspaceId, member, conversationId, input.expectedStateVersion, {
        to: 'open',
      }),

    assign: (
      workspaceId: string,
      member: Member,
      conversationId: string,
      input: { assigneeAccountId: string | null; expectedStateVersion: number },
    ) =>
      change(
        workspaceId,
        member,
        conversationId,
        input.assigneeAccountId,
        input.expectedStateVersion,
      ),

    unassign: (
      workspaceId: string,
      member: Member,
      conversationId: string,
      input: { expectedStateVersion: number },
    ) => change(workspaceId, member, conversationId, null, input.expectedStateVersion),
  };
}

export type ChangeState = ReturnType<typeof createChangeState>;
