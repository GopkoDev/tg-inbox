import { describe, expect, it } from 'vitest';
import {
  closeReasons,
  decideChange,
  sameSnapshot,
  type ChangeContext,
  type CloseSnapshot,
  type ConversationState,
} from './state.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

const snap = (seq = 3, reply: CloseSnapshot['latestReply'] = { id: 'r1', state: 'sent' }) => ({
  customerMessageSeq: seq,
  latestReply: reply,
});
const state = (over: Partial<ConversationState> = {}): ConversationState => ({
  status: 'open',
  assigneeAccountId: null,
  stateVersion: 5,
  customerMessageSeq: 3,
  ...over,
});
const ctx = (over: Partial<ChangeContext> = {}): ChangeContext => ({
  customerWaiting: false,
  newestCustomerArrival: null,
  unreadFloor: t(10),
  latestReply: { id: 'r1', state: 'sent' },
  ...over,
});

describe('sameSnapshot', () => {
  it('equal field by field', () => {
    expect(sameSnapshot(snap(), snap())).toBe(true);
    expect(sameSnapshot(snap(3, null), snap(3, null))).toBe(true);
  });
  it('differs by counter, reply id, reply state or reply presence', () => {
    expect(sameSnapshot(snap(3), snap(4))).toBe(false);
    expect(sameSnapshot(snap(), snap(3, { id: 'r2', state: 'sent' }))).toBe(false);
    expect(sameSnapshot(snap(), snap(3, { id: 'r1', state: 'not_delivered' }))).toBe(false);
    expect(sameSnapshot(snap(), snap(3, null))).toBe(false);
    expect(sameSnapshot(snap(3, null), snap())).toBe(false);
  });
});

describe('closeReasons (AC-06)', () => {
  const base = {
    customerWaiting: false,
    newestCustomerArrival: null,
    unreadFloor: t(10),
    current: snap(),
    sent: snap(),
  };
  it('none when nothing holds', () => {
    expect(closeReasons(base)).toEqual([]);
  });
  it('customer_waiting', () => {
    expect(closeReasons({ ...base, customerWaiting: true })).toEqual(['customer_waiting']);
  });
  it('unread_customer_message only when strictly after the floor', () => {
    expect(closeReasons({ ...base, newestCustomerArrival: t(11) })).toEqual([
      'unread_customer_message',
    ]);
    expect(closeReasons({ ...base, newestCustomerArrival: t(10) })).toEqual([]);
    expect(closeReasons({ ...base, newestCustomerArrival: t(9) })).toEqual([]);
  });
  it('new_customer_message when the counter grew past the sent snapshot', () => {
    expect(closeReasons({ ...base, current: snap(4) })).toEqual(['new_customer_message']);
  });
  it('reply_not_delivered / reply_not_confirmed from the latest reply state', () => {
    const nd = snap(3, { id: 'r1', state: 'not_delivered' });
    const nc = snap(3, { id: 'r1', state: 'not_confirmed' });
    expect(closeReasons({ ...base, current: nd, sent: nd })).toEqual(['reply_not_delivered']);
    expect(closeReasons({ ...base, current: nc, sent: nc })).toEqual(['reply_not_confirmed']);
  });
  it('sending and sent replies are no reason', () => {
    const s = snap(3, { id: 'r1', state: 'sending' });
    expect(closeReasons({ ...base, current: s, sent: s })).toEqual([]);
  });
  it('lists every reason in a fixed order', () => {
    const nd = snap(4, { id: 'r1', state: 'not_delivered' });
    expect(
      closeReasons({
        customerWaiting: true,
        newestCustomerArrival: t(11),
        unreadFloor: t(10),
        current: nd,
        sent: snap(3),
      }),
    ).toEqual([
      'customer_waiting',
      'unread_customer_message',
      'new_customer_message',
      'reply_not_delivered',
    ]);
  });
});

describe('decideChange: assign / unassign (AC-03)', () => {
  it('assign to the current assignee is unchanged even with a stale version', () => {
    const r = decideChange(
      state({ assigneeAccountId: 'a' }),
      { type: 'assign', assigneeAccountId: 'a', expectedVersion: 1 },
      ctx(),
    );
    expect(r).toEqual({ outcome: 'unchanged' });
  });
  it('unassign of an unassigned conversation is unchanged even with a stale version', () => {
    expect(decideChange(state(), { type: 'unassign', expectedVersion: 1 }, ctx())).toEqual({
      outcome: 'unchanged',
    });
  });
  it('stale version refuses', () => {
    expect(
      decideChange(state(), { type: 'assign', assigneeAccountId: 'a', expectedVersion: 4 }, ctx()),
    ).toEqual({ outcome: 'stale' });
    expect(
      decideChange(
        state({ assigneeAccountId: 'a' }),
        { type: 'unassign', expectedVersion: 4 },
        ctx(),
      ),
    ).toEqual({ outcome: 'stale' });
  });
  it('assign on an unassigned conversation is allowed as assigned', () => {
    expect(
      decideChange(state(), { type: 'assign', assigneeAccountId: 'a', expectedVersion: 5 }, ctx()),
    ).toEqual({ outcome: 'allowed', kind: 'assigned', previousAssignee: null, newAssignee: 'a' });
  });
  it('assign to another member is reassigned', () => {
    expect(
      decideChange(
        state({ assigneeAccountId: 'a' }),
        { type: 'assign', assigneeAccountId: 'b', expectedVersion: 5 },
        ctx(),
      ),
    ).toEqual({ outcome: 'allowed', kind: 'reassigned', previousAssignee: 'a', newAssignee: 'b' });
  });
  it('unassign is allowed as unassigned', () => {
    expect(
      decideChange(
        state({ assigneeAccountId: 'a' }),
        { type: 'unassign', expectedVersion: 5 },
        ctx(),
      ),
    ).toEqual({ outcome: 'allowed', kind: 'unassigned', previousAssignee: 'a', newAssignee: null });
  });
  it('assigning a closed conversation is allowed and evaluates no close reasons', () => {
    const r = decideChange(
      state({ status: 'closed' }),
      { type: 'assign', assigneeAccountId: 'a', expectedVersion: 5 },
      ctx({ customerWaiting: true }),
    );
    expect(r.outcome).toBe('allowed');
  });
});

describe('decideChange: reopen (AC-05)', () => {
  it('already open is unchanged, even with a stale version', () => {
    expect(decideChange(state(), { type: 'reopen', expectedVersion: 1 }, ctx())).toEqual({
      outcome: 'unchanged',
    });
  });
  it('stale version refuses', () => {
    expect(
      decideChange(state({ status: 'closed' }), { type: 'reopen', expectedVersion: 4 }, ctx()),
    ).toEqual({ outcome: 'stale' });
  });
  it('allowed, keeping the assignee, and evaluates no close reasons', () => {
    const r = decideChange(
      state({ status: 'closed', assigneeAccountId: 'a' }),
      { type: 'reopen', expectedVersion: 5 },
      ctx({ customerWaiting: true, latestReply: { id: 'r1', state: 'not_delivered' } }),
    );
    expect(r).toEqual({
      outcome: 'allowed',
      kind: 'reopened',
      previousAssignee: 'a',
      newAssignee: 'a',
    });
  });
});

describe('decideChange: close (AC-03, AC-06)', () => {
  const close = (
    over: Partial<{ expectedVersion: number; snapshot: CloseSnapshot; confirm: boolean }> = {},
  ) => ({
    type: 'close' as const,
    expectedVersion: 5,
    snapshot: snap(),
    confirm: false,
    ...over,
  });

  it('already closed is unchanged, even with confirm and a stale version', () => {
    expect(
      decideChange(
        state({ status: 'closed' }),
        close({ confirm: true, expectedVersion: 1 }),
        ctx(),
      ),
    ).toEqual({ outcome: 'unchanged' });
  });
  it('allowed when the version matches and no reason holds', () => {
    expect(decideChange(state({ assigneeAccountId: 'a' }), close(), ctx())).toEqual({
      outcome: 'allowed',
      kind: 'closed',
      previousAssignee: 'a',
      newAssignee: 'a',
    });
  });
  it('stale version with no other reason asks with state_changed, never stale', () => {
    expect(decideChange(state(), close({ expectedVersion: 4 }), ctx())).toEqual({
      outcome: 'needs_confirmation',
      reasons: ['state_changed'],
    });
  });
  it('a stale version is not overridden by confirm', () => {
    expect(decideChange(state(), close({ expectedVersion: 4, confirm: true }), ctx())).toEqual({
      outcome: 'needs_confirmation',
      reasons: ['state_changed'],
    });
  });
  it('state_changed comes first among every reason', () => {
    const r = decideChange(state(), close({ expectedVersion: 4 }), ctx({ customerWaiting: true }));
    expect(r).toEqual({
      outcome: 'needs_confirmation',
      reasons: ['state_changed', 'customer_waiting'],
    });
  });
  it('a reason without confirm asks', () => {
    expect(decideChange(state(), close(), ctx({ customerWaiting: true }))).toEqual({
      outcome: 'needs_confirmation',
      reasons: ['customer_waiting'],
    });
  });
  it('confirm with an equal snapshot closes over the reasons', () => {
    const r = decideChange(
      state(),
      close({ confirm: true }),
      ctx({ customerWaiting: true, newestCustomerArrival: t(11) }),
    );
    expect(r.outcome).toBe('allowed');
  });
  it('confirm with a grown counter asks again with new_customer_message', () => {
    expect(decideChange(state({ customerMessageSeq: 4 }), close({ confirm: true }), ctx())).toEqual(
      { outcome: 'needs_confirmation', reasons: ['new_customer_message'] },
    );
  });
  it('confirm with a differing latest reply state asks again with the current reasons', () => {
    const r = decideChange(
      state(),
      close({ confirm: true }),
      ctx({ latestReply: { id: 'r1', state: 'not_delivered' } }),
    );
    expect(r).toEqual({ outcome: 'needs_confirmation', reasons: ['reply_not_delivered'] });
  });
  it('a differing reply id with no reason holding is allowed (no reason to ask)', () => {
    const r = decideChange(
      state(),
      close({ confirm: true }),
      ctx({ latestReply: { id: 'r2', state: 'sent' } }),
    );
    expect(r.outcome).toBe('allowed');
  });
  it('confirm without any reason and an equal snapshot is allowed', () => {
    expect(decideChange(state(), close({ confirm: true }), ctx()).outcome).toBe('allowed');
  });
});
