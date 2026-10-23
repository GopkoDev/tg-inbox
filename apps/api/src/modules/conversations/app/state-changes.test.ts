import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { CloseSnapshot } from '../domain/state.js';
import { fakeActivityRepo, fakeConversationRepo, fakeConversationSignals } from './fakes.js';
import type { Executor } from './ports.js';
import { createStateChanges, recordChange } from './state-changes.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const ME = 'me';
const A = 'member-a';
const B = 'member-b';
const NO_REPLY: CloseSnapshot = { customerMessageSeq: 0, latestReply: null };

async function setup() {
  const conversations = fakeConversationRepo();
  const activities = fakeActivityRepo();
  const signals = fakeConversationSignals();
  const clock = fixedClock(at(1000));
  const tx = { marker: 'tx' } as unknown as Executor;
  const changes = createStateChanges({ conversations, activities, signals, clock });
  const { conversationId } = await conversations.upsert(
    W,
    { contactId: 'ct', telegramChatId: 1n },
    at(0),
  );
  const row = conversations.rows[0]!;
  // answered: the last reply is newer than the last customer message, so a close asks nothing
  row.lastReplySentAt = at(10);
  row.lastMessageReceivedAt = at(5);
  const assign = (o: Partial<Parameters<typeof changes.changeAssignee>[1]> = {}) =>
    changes.changeAssignee(tx, {
      workspaceId: W,
      actorAccountId: ME,
      conversationId,
      assigneeAccountId: A,
      expectedStateVersion: 0,
      ...o,
    });
  const close = (
    o: Partial<Extract<Parameters<typeof changes.changeStatus>[1], { to: 'closed' }>> = {},
  ) =>
    changes.changeStatus(tx, {
      workspaceId: W,
      actorAccountId: ME,
      conversationId,
      to: 'closed',
      expectedStateVersion: 0,
      expectedCloseSnapshot: NO_REPLY,
      confirm: false,
      actorActiveSince: at(0),
      ...o,
    });
  const reopen = (expectedStateVersion = 0) =>
    changes.changeStatus(tx, {
      workspaceId: W,
      actorAccountId: ME,
      conversationId,
      to: 'open',
      expectedStateVersion,
    });
  return {
    conversations,
    activities,
    signals,
    clock,
    tx,
    changes,
    conversationId,
    row,
    assign,
    close,
    reopen,
  };
}

/** `n` recorded changes by `actor` created at `created` (seconds). */
function seedChanges(
  s: Awaited<ReturnType<typeof setup>>,
  n: number,
  created: number,
  actor = ME,
  workspaceId = W,
) {
  for (let i = 0; i < n; i++) {
    s.activities.rows.push({
      id: newId(),
      workspaceId,
      conversationId: 'other',
      kind: 'closed',
      cause: 'member',
      actorAccountId: actor,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: null,
      positionAt: at(created),
      createdAt: at(created),
    });
  }
}

describe('changeAssignee', () => {
  it('not_found when the conversation is not in the workspace', async () => {
    const s = await setup();
    expect(await s.assign({ conversationId: 'nope' })).toEqual({ outcome: 'not_found' });
  });

  it('assigns: writes, raises the version, records one entry and signals it on the same tx', async () => {
    const s = await setup();
    const r = await s.assign();
    expect(r.outcome).toBe('recorded');
    if (r.outcome !== 'recorded') return;
    expect(s.row.assigneeAccountId).toBe(A);
    expect(s.row.stateVersion).toBe(1);
    expect(r.state).toMatchObject({ assigneeAccountId: A, stateVersion: 1, status: 'open' });
    expect(s.activities.rows).toHaveLength(1);
    expect(r.activity).toEqual({
      id: s.activities.rows[0]!.id,
      conversationId: s.conversationId,
      kind: 'assigned',
      cause: 'member',
      actorAccountId: ME,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: A,
      positionAt: at(1000),
      createdAt: at(1000),
    });
    expect(s.signals.activities).toEqual([
      { workspaceId: W, conversationId: s.conversationId, activityId: r.activity.id, tx: s.tx },
    ]);
  });

  it('reassigns A to B as one entry', async () => {
    const s = await setup();
    s.row.assigneeAccountId = A;
    s.row.stateVersion = 4;
    const r = await s.assign({ assigneeAccountId: B, expectedStateVersion: 4 });
    expect(r.outcome).toBe('recorded');
    expect(s.activities.rows).toHaveLength(1);
    expect(s.activities.rows[0]).toMatchObject({
      kind: 'reassigned',
      previousAssigneeAccountId: A,
      newAssigneeAccountId: B,
    });
  });

  it('unassigns', async () => {
    const s = await setup();
    s.row.assigneeAccountId = A;
    const r = await s.assign({ assigneeAccountId: null });
    expect(r.outcome).toBe('recorded');
    expect(s.row.assigneeAccountId).toBeNull();
    expect(s.activities.rows[0]).toMatchObject({
      kind: 'unassigned',
      previousAssigneeAccountId: A,
      newAssigneeAccountId: null,
    });
  });

  it('assigning the current assignee with a stale version is unchanged: nothing recorded or signalled', async () => {
    const s = await setup();
    s.row.assigneeAccountId = A;
    s.row.stateVersion = 5;
    const r = await s.assign({ assigneeAccountId: A, expectedStateVersion: 1 });
    expect(r).toMatchObject({ outcome: 'unchanged', latestChange: null });
    expect(s.row.stateVersion).toBe(5);
    expect(s.activities.rows).toHaveLength(0);
    expect(s.signals.activities).toHaveLength(0);
  });

  it('a stale version is refused with the current state and the latest entry', async () => {
    const s = await setup();
    s.row.assigneeAccountId = B;
    s.row.stateVersion = 3;
    s.activities.rows.push({
      id: 'x1',
      workspaceId: W,
      conversationId: s.conversationId,
      kind: 'assigned',
      cause: 'member',
      actorAccountId: B,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: B,
      positionAt: at(900),
      createdAt: at(900),
    });
    const r = await s.assign({ expectedStateVersion: 2 });
    expect(r).toMatchObject({
      outcome: 'stale',
      state: { assigneeAccountId: B, stateVersion: 3 },
      latestChange: { id: 'x1' },
    });
    expect(s.row.stateVersion).toBe(3);
    expect(s.signals.activities).toHaveLength(0);
  });

  it('a closed conversation can be assigned and stays closed', async () => {
    const s = await setup();
    s.row.status = 'closed';
    const r = await s.assign();
    expect(r.outcome).toBe('recorded');
    expect(s.row.status).toBe('closed');
  });

  it('the entry is never positioned before the latest entry of the conversation', async () => {
    const s = await setup();
    s.activities.rows.push({
      id: 'later',
      workspaceId: W,
      conversationId: s.conversationId,
      kind: 'closed',
      cause: 'customer_wrote' as never,
      actorAccountId: null,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: null,
      positionAt: at(2000),
      createdAt: at(1),
    });
    const r = await s.assign();
    if (r.outcome !== 'recorded') throw new Error('expected recorded');
    expect(r.activity.positionAt).toEqual(at(2000));
    expect(r.activity.createdAt).toEqual(at(1000));
  });

  it('refuses the 61st change with retry_at = oldest + 60 s; writes nothing', async () => {
    const s = await setup();
    seedChanges(s, 1, 960);
    seedChanges(s, 59, 990);
    const r = await s.assign();
    expect(r).toEqual({ outcome: 'limited', retryAt: at(1020) });
    expect(s.row.stateVersion).toBe(0);
    expect(s.activities.rows).toHaveLength(60);
    expect(s.signals.activities).toHaveLength(0);
  });

  it('counts only this member, this workspace and the last 60 s', async () => {
    const s = await setup();
    seedChanges(s, 30, 1, ME); // older than the window
    seedChanges(s, 60, 990, 'someone-else');
    seedChanges(s, 60, 990, ME, 'w2');
    seedChanges(s, 59, 990, ME);
    expect((await s.assign()).outcome).toBe('recorded');
  });

  it('checks no-op and stale before the limit: refused or unchanged requests are not limited', async () => {
    const s = await setup();
    seedChanges(s, 60, 990);
    s.row.assigneeAccountId = A;
    s.row.stateVersion = 2;
    expect((await s.assign({ assigneeAccountId: A })).outcome).toBe('unchanged');
    expect((await s.assign({ assigneeAccountId: B, expectedStateVersion: 1 })).outcome).toBe(
      'stale',
    );
    expect((await s.assign({ assigneeAccountId: B, expectedStateVersion: 2 })).outcome).toBe(
      'limited',
    );
  });
});

describe('changeStatus', () => {
  it('closes an answered, read conversation: keeps the assignee, records a closed entry without assignees', async () => {
    const s = await setup();
    s.row.assigneeAccountId = A;
    const r = await s.close();
    expect(r.outcome).toBe('recorded');
    expect(s.row).toMatchObject({ status: 'closed', assigneeAccountId: A, stateVersion: 1 });
    expect(s.activities.rows[0]).toMatchObject({
      kind: 'closed',
      cause: 'member',
      actorAccountId: ME,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: null,
    });
    expect(s.signals.activities).toHaveLength(1);
  });

  it('closing a closed conversation is unchanged', async () => {
    const s = await setup();
    s.row.status = 'closed';
    expect(await s.close({ expectedStateVersion: 9 })).toMatchObject({ outcome: 'unchanged' });
    expect(s.activities.rows).toHaveLength(0);
  });

  it('asks when the customer is waiting: reasons, current snapshot, nothing written; confirm with that snapshot closes', async () => {
    const s = await setup();
    s.row.lastReplySentAt = null;
    const first = await s.close();
    expect(first).toMatchObject({
      outcome: 'needs_confirmation',
      reasons: ['customer_waiting'],
      snapshot: { customerMessageSeq: 0, latestReply: null },
      state: { stateVersion: 0 },
    });
    expect(s.row.status).toBe('open');
    expect(s.activities.rows).toHaveLength(0);
    const second = await s.close({ confirm: true });
    expect(second.outcome).toBe('recorded');
    expect(s.row.status).toBe('closed');
  });

  it('asks when a customer message arrived after the member watermark; returns the message', async () => {
    const s = await setup();
    s.conversations.reads.unread = { id: 'm9', receivedAt: at(7) };
    const r = await s.close();
    expect(r).toMatchObject({
      outcome: 'needs_confirmation',
      reasons: ['unread_customer_message'],
      newestUnreadMessage: { id: 'm9', receivedAt: at(7) },
    });
  });

  it('(b2) a first close after a message the screen has not shown asks with new_customer_message', async () => {
    const s = await setup();
    s.row.customerMessageSeq = 3;
    const r = await s.close({
      expectedCloseSnapshot: { customerMessageSeq: 2, latestReply: null },
    });
    expect(r).toMatchObject({
      outcome: 'needs_confirmation',
      reasons: ['new_customer_message'],
      snapshot: { customerMessageSeq: 3 },
    });
  });

  it('close anyway with a snapshot older than the reply that turned not_confirmed asks again', async () => {
    const s = await setup();
    s.row.lastReplySentAt = null;
    s.conversations.reads.latestReply = { id: 'r1', state: 'not_confirmed' };
    const r = await s.close({ confirm: true });
    expect(r).toMatchObject({
      outcome: 'needs_confirmation',
      reasons: ['customer_waiting', 'reply_not_confirmed'],
      snapshot: { latestReply: { id: 'r1', state: 'not_confirmed' } },
    });
    expect(s.row.status).toBe('open');
  });

  it('a close with a stale version asks with state_changed and the latest entry, even when confirmed', async () => {
    const s = await setup();
    s.row.stateVersion = 2;
    s.activities.rows.push({
      id: 'x1',
      workspaceId: W,
      conversationId: s.conversationId,
      kind: 'assigned',
      cause: 'member',
      actorAccountId: B,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: B,
      positionAt: at(900),
      createdAt: at(900),
    });
    const r = await s.close({ expectedStateVersion: 1, confirm: true });
    expect(r).toMatchObject({
      outcome: 'needs_confirmation',
      reasons: ['state_changed'],
      latestChange: { id: 'x1' },
    });
    expect(s.row.status).toBe('open');
  });

  it('refuses a clean close at the limit; an already-closed request at the limit is unchanged', async () => {
    const s = await setup();
    seedChanges(s, 60, 990);
    expect(await s.close()).toEqual({ outcome: 'limited', retryAt: at(1050) });
    expect(s.row.status).toBe('open');
    s.row.status = 'closed';
    expect((await s.close()).outcome).toBe('unchanged');
  });

  it('a confirmation that is refused by the limit is not counted and writes nothing', async () => {
    const s = await setup();
    s.row.lastReplySentAt = null;
    seedChanges(s, 60, 990);
    expect((await s.close({ confirm: true })).outcome).toBe('limited');
    expect(s.activities.rows).toHaveLength(60);
  });

  it('reopens a closed conversation with the same assignee and a reopened entry', async () => {
    const s = await setup();
    s.row.status = 'closed';
    s.row.assigneeAccountId = A;
    const r = await s.reopen();
    expect(r.outcome).toBe('recorded');
    expect(s.row).toMatchObject({ status: 'open', assigneeAccountId: A, stateVersion: 1 });
    expect(s.activities.rows[0]).toMatchObject({ kind: 'reopened', cause: 'member' });
  });

  it('a close ends the waiting period; an assignee change leaves it (AC-08)', async () => {
    const s = await setup();
    s.row.lastReplySentAt = null;
    s.row.waiting = { since: at(3), startedBy: 'message' };
    expect((await s.assign()).outcome).toBe('recorded');
    expect(s.row.waiting).toEqual({ since: at(3), startedBy: 'message' });
    expect(
      (
        await s.changes.changeAssignee(s.tx, {
          workspaceId: W,
          actorAccountId: ME,
          conversationId: s.conversationId,
          assigneeAccountId: null,
          expectedStateVersion: 1,
        })
      ).outcome,
    ).toBe('recorded');
    expect(s.row.waiting).toEqual({ since: at(3), startedBy: 'message' });
    expect(
      (
        await s.close({
          expectedStateVersion: 2,
          confirm: true,
          expectedCloseSnapshot: { customerMessageSeq: 0, latestReply: null },
        })
      ).outcome,
    ).toBe('recorded');
    expect(s.row).toMatchObject({ status: 'closed', waiting: null });
  });

  it('a member reopen over an unanswered customer message starts a reopen period (AC-07, AC-08)', async () => {
    const s = await setup();
    s.row.status = 'closed';
    s.row.lastReplySentAt = at(2);
    s.row.lastMessageReceivedAt = at(5);
    await s.reopen();
    expect(s.row.waiting).toEqual({ since: at(1000), startedBy: 'reopen' });
  });

  it('a member reopen of an answered conversation leaves it not waiting', async () => {
    const s = await setup();
    s.row.status = 'closed';
    await s.reopen();
    expect(s.row).toMatchObject({ status: 'open', waiting: null });
  });

  it('reopening an open conversation is unchanged; with a stale version it is refused', async () => {
    const s = await setup();
    expect((await s.reopen()).outcome).toBe('unchanged');
    s.row.status = 'closed';
    s.row.stateVersion = 3;
    expect((await s.reopen(2)).outcome).toBe('stale');
  });

  it('not_found when the conversation is not in the workspace', async () => {
    const s = await setup();
    expect(await s.close({ conversationId: 'nope' })).toEqual({ outcome: 'not_found' });
  });
});

describe('recordChange (automatic causes)', () => {
  it('writes, records and signals without the limit and without an actor', async () => {
    const s = await setup();
    seedChanges(s, 60, 990);
    s.row.status = 'closed';
    const r = await recordChange(
      { conversations: s.conversations, activities: s.activities, signals: s.signals },
      s.tx,
      {
        workspaceId: W,
        conversationId: s.conversationId,
        kind: 'reopened',
        cause: 'customer_wrote',
        actorAccountId: null,
        previousAssignee: null,
        newAssignee: null,
        now: at(1000),
      },
    );
    expect(s.row).toMatchObject({ status: 'open', stateVersion: 1 });
    expect(r.stateVersion).toBe(1);
    expect(r.activity).toMatchObject({
      kind: 'reopened',
      cause: 'customer_wrote',
      actorAccountId: null,
    });
    expect(s.signals.activities).toHaveLength(1);
  });
});
