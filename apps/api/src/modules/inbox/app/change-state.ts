import type { ConversationStateChange } from '@tg/shared';
import {
  AccessRemovedError,
  AssigneeNotActiveError,
  ChangeLimitReachedError,
  ConversationStateChangedError,
  NotFoundError,
} from '../../../platform/errors.js';
import type { ActivityView } from '../../conversations/app/ports.js';
import type { ChangeResult } from '../../conversations/app/state-changes.js';
import type { Member } from './reads.js';
import { activityDto } from './reads.js';
import type { ChangeStateDeps } from './ports.js';

/**
 * The member changes of a conversation (flow 5): one transaction that share-locks the memberships,
 * then changes the conversation (sad.md §8 lock order: memberships, conversation row, limit lock,
 * activity insert). The refusals of the contract are raised here, after the transaction, so a
 * refusal never leaves anything behind.
 */
export function createChangeState(deps: ChangeStateDeps) {
  const { transaction, workspaces, changes, reads, clock } = deps;

  async function namesOf(workspaceId: string, activities: (ActivityView | null)[]) {
    const ids = new Set<string>();
    for (const a of activities) {
      if (!a) continue;
      for (const id of [a.actorAccountId, a.previousAssigneeAccountId, a.newAssigneeAccountId]) {
        if (id !== null) ids.add(id);
      }
    }
    return ids.size ? workspaces.displayNames(workspaceId, [...ids]) : new Map<string, string>();
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
        const conversation = await reads.getConversation(workspaceId, member, conversationId);
        const names = await namesOf(workspaceId, [result.latestChange]);
        throw new ConversationStateChangedError(
          conversation,
          result.latestChange && activityDto(workspaceId, result.latestChange, names),
        );
      }
      case 'needs_confirmation':
        // Only a close can need confirmation; the assignment routes never ask for one.
        throw new Error('an assignment cannot need confirmation');
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

  return {
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
