import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { fakeConversationSignals, fakeReplyRepo } from './fakes.js';
import type { Executor } from './ports.js';
import { createReplies } from './replies.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const C = 'c1';
const ME = 'me';
const MATE = 'mate';

function setup() {
  const repo = fakeReplyRepo({ conversations: [[W, C]] });
  const signals = fakeConversationSignals();
  const clock = fixedClock(at(100));
  const tx = { marker: 'tx' } as unknown as Executor;
  const enqueued: Array<[Executor, string, string]> = [];
  const replies = createReplies({
    transaction: (fn) => fn(tx),
    replies: repo,
    signals,
    clock,
  });
  const enqueueDrain = async (t: Executor, w: string, c: string) => {
    enqueued.push([t, w, c]);
  };
  const create = (o: Partial<Parameters<typeof replies.createReply>[0]> = {}) =>
    replies.createReply({
      workspaceId: W,
      conversationId: C,
      authorId: ME,
      clientKey: 'k1',
      body: 'Hi',
      lastSeenReplyId: null,
      confirmTeammate: false,
      limit: 30,
      windowMs: 60_000,
      enqueueDrain,
      ...o,
    });
  const requeue = (o: Partial<Parameters<typeof replies.requeueReply>[0]> & { replyId: string }) =>
    replies.requeueReply({
      workspaceId: W,
      conversationId: C,
      memberId: ME,
      confirmDuplicate: false,
      limit: 30,
      windowMs: 60_000,
      enqueueDrain,
      ...o,
    });
  return { repo, signals, clock, tx, enqueued, create, requeue };
}

describe('createReply', () => {
  it('stores a sending reply with a send attempt, enqueues the drain and signals created in the same transaction', async () => {
    const { create, repo, signals, enqueued, tx } = setup();
    const r = await create();
    expect(r.status).toBe('created');
    if (r.status !== 'created') return;
    expect(r.reply).toMatchObject({ state: 'sending', body: 'Hi', authorAccountId: ME });
    expect(repo.attempts).toMatchObject([
      { kind: 'send', initiatedByAccountId: ME, replyId: r.reply.id },
    ]);
    expect(enqueued).toEqual([[tx, W, C]]);
    expect(signals.replies).toEqual([
      { workspaceId: W, conversationId: C, replyId: r.reply.id, change: 'created', tx },
    ]);
  });

  it('returns the stored reply for a repeated client key and stores/enqueues nothing more (AC-11)', async () => {
    const { create, repo, enqueued, signals } = setup();
    const first = await create();
    const again = await create({ body: 'ignored' });
    expect(again.status).toBe('existing');
    expect(again.status === 'existing' && again.reply.body).toBe('Hi');
    expect(first.status).toBe('created');
    expect(repo.replies).toHaveLength(1);
    expect(repo.attempts).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    expect(signals.replies).toHaveLength(1);
  });

  it('refuses the 31st send with the time the oldest leaves the window (AC-12b)', async () => {
    const { create, clock, repo } = setup();
    for (let i = 0; i < 30; i++) {
      clock.set(at(100 + i));
      expect((await create({ clientKey: `k${i}` })).status).toBe('created');
    }
    clock.set(at(130));
    const r = await create({ clientKey: 'k31' });
    expect(r).toEqual({ status: 'limited', retryAt: at(160) });
    expect(repo.replies).toHaveLength(30);
  });

  it('does not count a send older than the window', async () => {
    const { create, clock } = setup();
    for (let i = 0; i < 30; i++) await create({ clientKey: `k${i}` });
    clock.advance(60_001);
    expect((await create({ clientKey: 'later' })).status).toBe('created');
  });

  it('refuses when a teammate replied after the last seen reply, unless confirmed (AC-16)', async () => {
    const { create, repo } = setup();
    await create({ authorId: MATE, clientKey: 'm1' });
    const refused = await create({ clientKey: 'k1', lastSeenReplyId: null });
    expect(refused.status).toBe('teammate');
    expect(refused.status === 'teammate' && refused.reply.authorAccountId).toBe(MATE);
    expect(repo.replies).toHaveLength(1);
    expect((await create({ clientKey: 'k1', confirmTeammate: true })).status).toBe('created');
  });

  it('lets a send through when the teammate reply was already seen, and treats an unknown id as none', async () => {
    const { create, repo, clock } = setup();
    const m = await create({ authorId: MATE, clientKey: 'm1' });
    if (m.status !== 'created') throw new Error('setup');
    clock.advance(1000);
    expect((await create({ clientKey: 'k1', lastSeenReplyId: m.reply.id })).status).toBe('created');
    expect((await create({ clientKey: 'k2', lastSeenReplyId: 'nope' })).status).toBe('teammate');
    expect(repo.replies).toHaveLength(2);
  });

  it('answers not_found for a conversation outside the workspace', async () => {
    const { create, enqueued } = setup();
    expect((await create({ conversationId: 'other' })).status).toBe('not_found');
    expect(enqueued).toEqual([]);
  });
});

describe('requeueReply', () => {
  async function failed(state: 'not_delivered' | 'not_confirmed') {
    const s = setup();
    const r = await s.create();
    if (r.status !== 'created') throw new Error('setup');
    s.repo.replies[0]!.state = state;
    s.enqueued.length = 0;
    s.signals.replies.length = 0;
    s.clock.advance(5000);
    return { ...s, id: r.reply.id };
  }

  it('re-queues a not_delivered reply as try_again at a new position with job and state signal', async () => {
    const { requeue, id, repo, enqueued, signals, clock, tx } = await failed('not_delivered');
    const r = await requeue({ replyId: id });
    expect(r.status).toBe('requeued');
    expect(repo.replies[0]).toMatchObject({ state: 'sending', positionAt: clock.now() });
    expect(repo.attempts.at(-1)).toMatchObject({ kind: 'try_again', initiatedByAccountId: ME });
    expect(enqueued).toEqual([[tx, W, C]]);
    expect(signals.replies).toMatchObject([{ replyId: id, change: 'state' }]);
  });

  it('needs confirmation for not_confirmed, then records send_again (AC-11)', async () => {
    const { requeue, id, repo, enqueued } = await failed('not_confirmed');
    expect((await requeue({ replyId: id })).status).toBe('confirmation_required');
    expect(enqueued).toEqual([]);
    expect((await requeue({ replyId: id, confirmDuplicate: true })).status).toBe('requeued');
    expect(repo.attempts.at(-1)?.kind).toBe('send_again');
  });

  it('refuses a sending or sent reply as not resendable, before the limit and confirmation', async () => {
    const { create, requeue } = setup();
    const r = await create();
    if (r.status !== 'created') throw new Error('setup');
    const out = await requeue({ replyId: r.reply.id, limit: 0 });
    expect(out.status).toBe('not_resendable');
  });

  it('checks the limit before the confirmation (flow order)', async () => {
    const { requeue, id } = await failed('not_confirmed');
    expect((await requeue({ replyId: id, limit: 1 })).status).toBe('limited');
  });

  it('answers not_found for an unknown reply', async () => {
    const { requeue } = setup();
    expect((await requeue({ replyId: 'nope' })).status).toBe('not_found');
  });
});
