import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@tg/shared';
import { fixedClock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  AssigneeNotActiveError,
  ChangeLimitReachedError,
  ConversationStateChangedError,
  NotFoundError,
} from '../../../platform/errors.js';
import type { ActivityView, Executor, LockedState } from '../../conversations/app/ports.js';
import type { ChangeResult } from '../../conversations/app/state-changes.js';
import { createChangeState } from './change-state.js';

const WS = '01920000-0000-7000-8000-000000000001';
const CONV = '01920000-0000-7000-8000-0000000000c1';
const ME = '01920000-0000-7000-8000-0000000000b1';
const MATE = '01920000-0000-7000-8000-0000000000b2';
const NOW = new Date('2026-10-18T10:00:00Z');
const member = { accountId: ME, activeSince: new Date('2026-10-01T00:00:00Z') };

const state: LockedState = {
  status: 'open',
  assigneeAccountId: MATE,
  stateVersion: 4,
  customerMessageSeq: 1,
  waitingForReply: false,
  lastActivityAt: NOW,
} as LockedState;
const activity: ActivityView = {
  id: '01920000-0000-7000-8000-0000000000d1',
  conversationId: CONV,
  kind: 'assigned',
  cause: 'member',
  actorAccountId: ME,
  previousAssigneeAccountId: null,
  newAssigneeAccountId: MATE,
  positionAt: NOW,
  createdAt: NOW,
};

function setup(o: { active?: string[]; result?: ChangeResult } = {}) {
  const calls: string[] = [];
  const tx = { tag: 'tx' } as unknown as Executor;
  const active = o.active ?? [ME, MATE];
  const summary = { id: CONV, state_version: 4 } as ConversationSummary;
  const changeState = createChangeState({
    transaction: async (fn) => {
      calls.push('begin');
      const r = await fn(tx);
      calls.push('commit');
      return r;
    },
    workspaces: {
      async lockActiveMembers(t, ws, ids) {
        expect(t).toBe(tx);
        expect(ws).toBe(WS);
        calls.push(`lock:${ids.join(',')}`);
        return ids.filter((id) => active.includes(id));
      },
      async displayNames() {
        return new Map([
          [ME, 'Me'],
          [MATE, 'Mate'],
        ]);
      },
    },
    changes: {
      async changeAssignee(t, input) {
        expect(t).toBe(tx);
        calls.push(`change:${input.assigneeAccountId}:${input.expectedStateVersion}`);
        return o.result ?? { outcome: 'recorded', state, activity };
      },
      async changeStatus() {
        throw new Error('not used');
      },
    },
    reads: {
      async getConversation() {
        calls.push('summary');
        return summary;
      },
    },
    clock: fixedClock(NOW),
  });
  return { calls, changeState, summary };
}

const assign = (s: ReturnType<typeof setup>, pick: string | null = MATE) =>
  s.changeState.assign(WS, member, CONV, { assigneeAccountId: pick, expectedStateVersion: 4 });

describe('assign', () => {
  it('share-locks the caller and the pick, then changes the conversation', async () => {
    const s = setup();
    const r = await assign(s);
    expect(s.calls).toEqual([
      'begin',
      `lock:${ME},${MATE}`,
      `change:${MATE}:4`,
      'commit',
      'summary',
    ]);
    expect(r).toMatchObject({
      workspace_id: WS,
      outcome: 'recorded',
      conversation: s.summary,
      activity: {
        type: 'activity',
        id: activity.id,
        actor: { account_id: ME, display_name: 'Me' },
        new_assignee: { account_id: MATE, display_name: 'Mate' },
        previous_assignee: null,
      },
    });
  });

  it('locks the caller once when assigning to self', async () => {
    const s = setup();
    await assign(s, ME);
    expect(s.calls[1]).toBe(`lock:${ME}`);
  });

  it('a caller deactivated under the lock gets ACCESS_REMOVED and nothing changes', async () => {
    const s = setup({ active: [MATE] });
    await expect(assign(s)).rejects.toBeInstanceOf(AccessRemovedError);
    expect(s.calls.some((c) => c.startsWith('change'))).toBe(false);
  });

  it('the caller check wins over the pick check', async () => {
    const s = setup({ active: [] });
    await expect(assign(s)).rejects.toBeInstanceOf(AccessRemovedError);
  });

  it('a pick that is not an active member (deactivated or foreign) is refused before the conversation is touched', async () => {
    const s = setup({ active: [ME] });
    await expect(assign(s)).rejects.toBeInstanceOf(AssigneeNotActiveError);
    expect(s.calls.some((c) => c.startsWith('change'))).toBe(false);
  });

  it('unchanged: 200 body with a null activity', async () => {
    const s = setup({ result: { outcome: 'unchanged', state, latestChange: activity } });
    expect(await assign(s)).toMatchObject({ outcome: 'unchanged', activity: null });
  });

  it('stale: CONVERSATION_STATE_CHANGED with the current summary and the latest change', async () => {
    const s = setup({ result: { outcome: 'stale', state, latestChange: activity } });
    const err = await assign(s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConversationStateChangedError);
    expect((err as ConversationStateChangedError).details).toMatchObject({
      conversation: s.summary,
      latest_change: { id: activity.id, kind: 'assigned' },
    });
  });

  it('stale with no entry yet: latest_change is null', async () => {
    const s = setup({ result: { outcome: 'stale', state, latestChange: null } });
    const err = (await assign(s).catch((e: unknown) => e)) as ConversationStateChangedError;
    expect(err.details).toMatchObject({ latest_change: null });
  });

  it('limited: CHANGE_LIMIT_REACHED with the seconds rounded up', async () => {
    const retryAt = new Date(NOW.getTime() + 12_300);
    const s = setup({ result: { outcome: 'limited', retryAt } });
    const err = await assign(s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChangeLimitReachedError);
    expect((err as ChangeLimitReachedError).headers).toEqual({ 'Retry-After': '13' });
  });

  it('not_found: a missing or foreign conversation is a 404', async () => {
    const s = setup({ result: { outcome: 'not_found' } });
    await expect(assign(s)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('unassign', () => {
  it('locks only the caller and passes a null assignee', async () => {
    const s = setup({ result: { outcome: 'recorded', state, activity } });
    await s.changeState.unassign(WS, member, CONV, { expectedStateVersion: 4 });
    expect(s.calls.slice(0, 3)).toEqual(['begin', `lock:${ME}`, 'change:null:4']);
  });

  it('a deactivated caller gets ACCESS_REMOVED', async () => {
    const s = setup({ active: [] });
    await expect(
      s.changeState.unassign(WS, member, CONV, { expectedStateVersion: 4 }),
    ).rejects.toBeInstanceOf(AccessRemovedError);
  });
});
