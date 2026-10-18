import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { fakeConversationSignals, fakeReadMarkRepo } from './fakes.js';
import { createInboxReads, type ListInput } from './inbox-reads.js';
import type { ConversationListReads, Executor, ListPageQuery } from './ports.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const C = 'c1';
const A = 'a1';

function setup(arrivals: Date[] | null = [at(50)]) {
  const marks = fakeReadMarkRepo({ arrivals });
  const signals = fakeConversationSignals();
  const tx = { marker: 'tx' } as unknown as Executor;
  const reads = createInboxReads({
    transaction: (fn) => fn(tx),
    marks,
    signals,
    // the list / thread readers are not used by mark read
    lists: undefined as never,
    threads: undefined as never,
    clock: fixedClock(at(100)),
  });
  return { reads, signals, marks, tx };
}

const input = (readThroughAt: Date) => ({
  conversationId: C,
  accountId: A,
  activeSince: at(0),
  readThroughAt,
});

describe('inbox reads: mark read', () => {
  it('raises the watermark and publishes conversation.changed (read) in the same transaction', async () => {
    const { reads, signals, tx } = setup();
    const state = await reads.markRead(W, input(at(30)));
    expect(state?.readThroughAt).toEqual(at(30));
    expect(signals.read).toEqual([{ workspaceId: W, conversationId: C, accountId: A, tx }]);
  });

  it('keeps a higher stored watermark and clamps a future time to the newest arrival', async () => {
    const { reads } = setup();
    await reads.markRead(W, input(at(40)));
    expect((await reads.markRead(W, input(at(10))))?.readThroughAt).toEqual(at(40));
    expect((await reads.markRead(W, input(at(9999))))?.readThroughAt).toEqual(at(50));
  });

  it('answers null and publishes nothing for a conversation that is not in the workspace', async () => {
    const { reads, signals } = setup(null);
    expect(await reads.markRead(W, input(at(30)))).toBeNull();
    expect(signals.read).toEqual([]);
  });
});

describe('inbox reads: lists', () => {
  const row = (id: string, s: number) => ({
    id,
    contactId: 'k',
    lastActivityAt: at(s),
    lastItem: null,
    unreadCount: 0,
    waitingForReply: false,
    status: 'open' as const,
    assigneeAccountId: null,
    stateVersion: 0,
  });
  function listSetup() {
    const queries: ListPageQuery[] = [];
    const lists = {
      async listPage(_w: string, q: ListPageQuery) {
        queries.push(q);
        return { rows: [row('r1', 20), row('r2', 10)], hasNext: true };
      },
      summary: async () => null,
    } as unknown as ConversationListReads;
    const reads = createInboxReads({
      transaction: (fn) => fn({} as Executor),
      lists,
      threads: undefined as never,
      marks: undefined as never,
      signals: fakeConversationSignals(),
      clock: fixedClock(at(100)),
    });
    return { reads, queries };
  }
  const input = (o: Partial<ListInput> = {}): ListInput => ({
    accountId: A,
    activeSince: at(0),
    contactIds: null,
    status: 'open',
    assignee: 'all',
    search: '',
    cursor: null,
    limit: 2,
    ...o,
  });

  it('passes the lenses to the list and binds the next cursor to them', async () => {
    const { reads, queries } = listSetup();
    const lens = {
      status: 'closed' as const,
      assignee: 'mine' as const,
      search: 'ann',
      contactIds: ['k'],
    };
    const page = await reads.listConversations(W, input(lens));
    expect(queries[0]).toMatchObject({ status: 'closed', assignee: 'mine', contactIds: ['k'] });
    const next = page.nextCursor!;
    await reads.listConversations(W, input({ ...lens, cursor: next }));
    expect(queries[1]!.after).toEqual({ lastActivityAt: at(10), id: 'r2' });
  });

  it.each([{ status: 'open' as const }, { assignee: 'unassigned' as const }, { search: 'bob' }])(
    'rejects a cursor presented with other lenses %j',
    async (other) => {
      const { reads } = listSetup();
      const lens = { status: 'closed', assignee: 'mine', search: 'ann' } as const;
      const { nextCursor } = await reads.listConversations(W, input(lens));
      await expect(
        reads.listConversations(W, input({ ...lens, ...other, cursor: nextCursor })),
      ).rejects.toThrow('The cursor is not valid.');
    },
  );
});
