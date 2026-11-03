import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { DestinationRecord } from '../infra/destination-repo.js';
import type { PostRecord } from '../infra/post-repo.js';
import { createPostSender } from './send-post.js';
import { createDeadLetterSettler } from './settle-dead-letter.js';
import {
  basePost,
  basePostDestination,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const WS = newId();
const OWNER = newId();
const DEST = newId();
const BOT = 1n;
const MIN = 60_000;
const T0 = new Date('2026-11-03T09:00:00Z'); // the scheduled moment

type SendOutcome =
  | { outcome: 'sent'; messageId: bigint; at: Date }
  | { outcome: 'paused'; until: Date }
  | { outcome: 'bot_unavailable' }
  | { outcome: 'bot_changed' }
  | { outcome: 'rate_limited'; retryAfterMs?: number }
  | { outcome: 'no_post_right' }
  | { outcome: 'chat_gone' }
  | { outcome: 'text_refused' }
  | { outcome: 'telegram_error' }
  | { outcome: 'no_answer' };

interface Opts {
  now?: Date;
  ownerIsOwner?: boolean;
  bot?: { state: string; telegramBotId: bigint; sendPausedUntil: Date | null } | null;
  send?: (req: { chatId: string; text: string; silent: boolean }) => Promise<SendOutcome>;
  dest?: Partial<DestinationRecord>;
}

function setup(opts: Opts = {}) {
  const clock = fixedClock(opts.now ?? T0);
  const store = fakeStore();
  const dest = basePostDestination({
    id: DEST,
    workspaceId: WS,
    telegramBotId: BOT,
    chatId: -1001234567890n,
    ...opts.dest,
  });
  store.destinations.push(dest);
  const jobs: { postId: string; moment: string; startAfter: Date }[] = [];
  const sends: { chatId: string; text: string; silent: boolean; botId: bigint }[] = [];
  const events: string[] = [];
  const base = fakePostRepo(store);
  const get = (id: string) => store.posts.find((p) => p.id === id)!;
  const posts = {
    ...base,
    async lock(ws: string, id: string) {
      events.push('post-lock');
      return base.lock(ws, id);
    },
    async claim(_ws: string, id: string, at: Date) {
      const p = get(id);
      if (!p || p.state !== 'scheduled') return null;
      Object.assign(p, { state: 'sending', sendingStartedAt: at, lastChangedAt: at });
      events.push('claim');
      return { ...p };
    },
    async markPublished(_ws: string, id: string, v: { telegramMessageId: bigint }, at: Date) {
      events.push('post-write');
      const p = get(id);
      if (p.state !== 'sending') return null;
      Object.assign(p, {
        state: 'published',
        telegramMessageId: v.telegramMessageId,
        publishedAt: at,
        outcomeAt: at,
      });
      return { ...p };
    },
    async markMissed(_ws: string, id: string, reason: string, at: Date) {
      const p = get(id);
      if (p.state !== 'scheduled') return null;
      Object.assign(p, {
        state: 'missed',
        outcomeReason: reason,
        outcomeAt: at,
        needsAttention: true,
      });
      return { ...p };
    },
    /** New repo method: sending/scheduled -> failed with a reason, needs attention. */
    async markFailed(_ws: string, id: string, reason: string, at: Date) {
      events.push('post-write');
      const p = get(id);
      if (p.state !== 'sending' && p.state !== 'scheduled') return null;
      Object.assign(p, {
        state: 'failed',
        outcomeReason: reason,
        outcomeAt: at,
        needsAttention: true,
      });
      return { ...p };
    },
    /** New repo method: sending -> not_confirmed, needs attention. */
    async markNotConfirmed(_ws: string, id: string, at: Date) {
      const p = get(id);
      if (p.state !== 'sending') return null;
      Object.assign(p, { state: 'not_confirmed', outcomeAt: at, needsAttention: true });
      return { ...p };
    },
    /** New repo method: sending -> scheduled again (a 429 or a pause; nothing reached the chat). */
    async returnToScheduled(_ws: string, id: string, at: Date) {
      const p = get(id);
      if (p.state !== 'sending') return null;
      Object.assign(p, { state: 'scheduled', sendingStartedAt: null, lastChangedAt: at });
      return { ...p };
    },
    async earlierDueInChat(_ws: string, destId: string, before: Date, excludeId: string) {
      return store.posts
        .filter(
          (p) =>
            p.destinationId === destId &&
            p.state === 'scheduled' &&
            p.scheduledFor! < before &&
            p.id !== excludeId,
        )
        .map((p) => ({ ...p }));
    },
    async sentTimesSince(_ws: string, since: Date) {
      return store.posts
        .filter((p) => p.sendingStartedAt && p.sendingStartedAt >= since)
        .map((p) => p.sendingStartedAt as Date);
    },
  };
  const destinations = {
    async find() {
      return { ...dest };
    },
    async lock() {
      events.push('dest-lock');
      return { ...dest };
    },
    async setPausedUntil(_ws: string, _id: string, until: Date | null) {
      events.push('dest-write');
      dest.pausedUntil = until;
      return true;
    },
    async setNextSendAt(_ws: string, _id: string, at: Date | null) {
      events.push('dest-write');
      dest.nextSendAt = at;
      return true;
    },
    async setAvailability(
      _ws: string,
      _id: string,
      v: Pick<DestinationRecord, 'availability' | 'problem' | 'membershipChangedAt'>,
    ) {
      events.push('dest-write');
      Object.assign(dest, v);
      return true;
    },
  };
  const deps = {
    transaction: fakeTransaction(),
    clock,
    posts,
    destinations,
    workspaces: {
      /** Active members of `ids` that are business owners (the scheduling owner's re-check). */
      async lockActiveOwners(_tx: unknown, _ws: string, ids: string[]) {
        events.push('owners');
        return opts.ownerIsOwner === false ? [] : ids;
      },
    },
    lockPosts: async () => {
      events.push('posts-lock');
    },
    bots: {
      postReadiness: async () =>
        opts.bot === undefined
          ? { state: 'connected', telegramBotId: BOT, sendPausedUntil: null }
          : opts.bot,
      async sendPost(req: {
        workspaceId: string;
        telegramBotId: bigint;
        chatId: string;
        text: string;
        silent: boolean;
      }) {
        events.push('send');
        sends.push({ ...req, botId: req.telegramBotId });
        // The claim is committed before Telegram is called.
        expect(store.posts.some((p) => p.state === 'sending')).toBe(true);
        return opts.send
          ? opts.send(req)
          : ({ outcome: 'sent', messageId: 777n, at: clock.now() } as SendOutcome);
      },
    },
    jobs: {
      async enqueueSend(
        _tx: unknown,
        p: { postId: string; workspaceId: string; moment: string },
        startAfter: Date,
      ) {
        jobs.push({ postId: p.postId, moment: p.moment, startAfter });
      },
    },
    signals: {
      async postChanged(_tx: unknown, ws: string, id: string) {
        store.signals.push(`post:${ws}:${id}`);
      },
      async destinationsChanged(_tx: unknown, ws: string) {
        store.signals.push(`dest:${ws}`);
      },
    },
  };
  const sender = createPostSender(deps as never);
  const settler = createDeadLetterSettler(deps as never);
  const seed = (o: Partial<PostRecord> = {}) => {
    const p = basePost({
      id: newId(),
      workspaceId: WS,
      destinationId: DEST,
      text: 'Spring sale',
      version: 3,
      state: 'scheduled',
      scheduledFor: T0,
      scheduledByAccountId: OWNER,
      scheduleKind: 'time',
      ...o,
    });
    store.posts.push(p);
    return p;
  };
  const run = (p: PostRecord, moment = p.scheduledFor!) =>
    sender.sendPost({ postId: p.id, workspaceId: WS, moment: moment.toISOString() });
  return { clock, store, dest, jobs, sends, events, seed, run, sender, settler, get };
}

describe('sendPost: the happy path (AC-08)', () => {
  it('claims before the send, sends the exact text once and records published', async () => {
    const h = setup();
    const p = h.seed({ text: 'Exact text', silent: true });
    await h.run(p);
    expect(h.sends).toEqual([
      expect.objectContaining({ chatId: '-1001234567890', text: 'Exact text', silent: true }),
    ]);
    expect(h.events.indexOf('claim')).toBeLessThan(h.events.indexOf('send'));
    expect(h.get(p.id)).toMatchObject({
      state: 'published',
      telegramMessageId: 777n,
      needsAttention: false,
    });
    expect(h.store.signals).toContain(`post:${WS}:${p.id}`);
    // per-chat pace: the next post to this chat waits 3 s
    expect(h.dest.nextSendAt).toEqual(new Date(T0.getTime() + 3000));
  });

  it('exits without sending for a job of an old moment (time changed)', async () => {
    const h = setup();
    const p = h.seed();
    await h.run(p, new Date(T0.getTime() - 5 * MIN));
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id).state).toBe('scheduled');
  });

  it('exits for a post that is no longer scheduled (back to draft, published)', async () => {
    const h = setup();
    const draft = h.seed({ state: 'draft', scheduledFor: null });
    const done = h.seed({ state: 'published' });
    await h.sender.sendPost({ postId: draft.id, workspaceId: WS, moment: T0.toISOString() });
    await h.run(done);
    expect(h.sends).toHaveLength(0);
    expect(h.get(done.id).state).toBe('published');
  });

  it('settles a claim found without an outcome as not confirmed and never sends again', async () => {
    const h = setup();
    const p = h.seed({ state: 'sending', sendingStartedAt: T0 });
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'not_confirmed', needsAttention: true });
  });

  it('a send with no answer ends not confirmed, needing attention, and is not queued again', async () => {
    const h = setup({ send: async () => ({ outcome: 'no_answer' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'not_confirmed', needsAttention: true });
    expect(h.jobs).toHaveLength(0);
    await h.run(p); // a retry of the job
    expect(h.sends).toHaveLength(1);
  });
});

describe('sendPost: owner and limits re-checked (AC-11, AC-16, AC-14)', () => {
  it('sends a demoted owner back to a draft with a notice, nothing sent', async () => {
    const h = setup({ ownerIsOwner: false });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({
      state: 'draft',
      draftNotice: 'owner_role_changed',
      version: 4,
    });
  });

  it('share-locks the owner before the posts lock', async () => {
    const h = setup();
    await h.run(h.seed());
    expect(h.events.indexOf('owners')).toBeLessThan(h.events.indexOf('posts-lock'));
    expect(h.events.indexOf('posts-lock')).toBeLessThan(h.events.indexOf('claim'));
  });

  it('fails with daily_limit when 30 posts were sent in the last 24 hours', async () => {
    const h = setup();
    for (let i = 0; i < 30; i++) {
      h.seed({
        state: 'published',
        scheduledFor: null,
        sendingStartedAt: new Date(T0.getTime() - (i + 1) * 20 * MIN),
      });
    }
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({
      state: 'failed',
      outcomeReason: 'daily_limit',
      needsAttention: true,
    });
  });

  it('fails with bot_not_working when the bot is not working', async () => {
    const h = setup({ bot: { state: 'disconnected', telegramBotId: BOT, sendPausedUntil: null } });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'bot_not_working' });
  });

  it('fails with not_current_bot when a different bot is connected', async () => {
    const h = setup({ bot: { state: 'connected', telegramBotId: 2n, sendPausedUntil: null } });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'not_current_bot' });
  });

  it('fails with destination_unavailable when the destination is unavailable', async () => {
    const h = setup({ dest: { availability: 'unavailable', problem: 'no_post_right' } });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({
      state: 'failed',
      outcomeReason: 'destination_unavailable',
    });
  });
});

describe('sendPost: the 15-minute window (AC-12)', () => {
  it('sends at exactly 15 minutes past the moment', async () => {
    const h = setup({ now: new Date(T0.getTime() + 15 * MIN) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id).state).toBe('published');
  });

  it('marks a post missed (service_down) past 15 minutes, never sent', async () => {
    const h = setup({ now: new Date(T0.getTime() + 15 * MIN + 1000) });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({
      state: 'missed',
      outcomeReason: 'service_down',
      needsAttention: true,
    });
  });

  it('gives bot_paused as the reason when the bot send pause is running', async () => {
    const now = new Date(T0.getTime() + 20 * MIN);
    const h = setup({
      now,
      bot: {
        state: 'connected',
        telegramBotId: BOT,
        sendPausedUntil: new Date(now.getTime() + 5 * MIN),
      },
    });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'missed', outcomeReason: 'bot_paused' });
  });

  it('gives chat_rate_limited as the reason when the chat pause is running', async () => {
    const now = new Date(T0.getTime() + 20 * MIN);
    const h = setup({ now, dest: { pausedUntil: new Date(now.getTime() + 5 * MIN) } });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'missed', outcomeReason: 'chat_rate_limited' });
  });

  it('after an outage, posts inside the window go out in scheduled-time order, the rest are missed', async () => {
    const now = new Date(T0.getTime() + 10 * MIN);
    const h = setup({ now });
    const stale = h.seed({ scheduledFor: new Date(T0.getTime() - 10 * MIN) }); // 20 min late
    const first = h.seed({ scheduledFor: new Date(T0.getTime() - 2 * MIN) });
    const second = h.seed({ scheduledFor: new Date(T0.getTime() + 1 * MIN) });
    await h.run(second); // arrives first but an earlier post is due
    expect(h.get(second.id).state).toBe('scheduled');
    expect(h.sends).toHaveLength(0);
    await h.run(stale);
    expect(h.get(stale.id).state).toBe('missed');
    await h.run(first);
    expect(h.get(first.id).state).toBe('published');
    h.clock.advance(3000);
    await h.run(second);
    expect(h.get(second.id).state).toBe('published');
    expect(h.sends.map((s) => s.text)).toHaveLength(2);
  });
});

describe('sendPost: per-chat order and pauses (AC-17)', () => {
  it('queues again in 3 s while an earlier post to the chat is still scheduled', async () => {
    const h = setup();
    h.seed({ scheduledFor: new Date(T0.getTime() - 1000) });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id).state).toBe('scheduled');
    expect(h.jobs).toEqual([
      { postId: p.id, moment: T0.toISOString(), startAfter: new Date(T0.getTime() + 3000) },
    ]);
  });

  it('three posts due together in one chat go out one at a time, 3 s apart', async () => {
    const h = setup();
    const a = h.seed({ scheduledFor: T0 });
    const b = h.seed({ scheduledFor: new Date(T0.getTime() + 1) });
    const c = h.seed({ scheduledFor: new Date(T0.getTime() + 2) });
    h.clock.advance(1000);
    await h.run(c);
    await h.run(b);
    expect(h.sends).toHaveLength(0);
    await h.run(a);
    expect(h.get(a.id).state).toBe('published');
    await h.run(b); // the chat's pace: next_send_at is a + 3 s
    expect(h.get(b.id).state).toBe('scheduled');
    expect(h.jobs.at(-1)).toMatchObject({ postId: b.id, startAfter: h.dest.nextSendAt });
    h.clock.advance(3000);
    await h.run(b);
    await h.run(c);
    expect(h.get(b.id).state).toBe('published');
    expect(h.get(c.id).state).toBe('scheduled');
    h.clock.advance(3000);
    await h.run(c);
    expect(h.get(c.id).state).toBe('published');
    expect(h.sends).toHaveLength(3);
  });

  it('queues again after the chat pause without calling Telegram', async () => {
    const until = new Date(T0.getTime() + 2 * MIN);
    const h = setup({ dest: { pausedUntil: until } });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id).state).toBe('scheduled');
    expect(h.jobs).toEqual([{ postId: p.id, moment: T0.toISOString(), startAfter: until }]);
  });

  it('queues again after the bot send pause without calling Telegram', async () => {
    const until = new Date(T0.getTime() + 30_000);
    const h = setup({ bot: { state: 'connected', telegramBotId: BOT, sendPausedUntil: until } });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id).state).toBe('scheduled');
    expect(h.jobs).toEqual([{ postId: p.id, moment: T0.toISOString(), startAfter: until }]);
  });

  it('a 429 pauses only the destination, returns the post to scheduled and queues it again', async () => {
    const h = setup({ send: async () => ({ outcome: 'rate_limited', retryAfterMs: 20_000 }) });
    const p = h.seed();
    await h.run(p);
    const until = new Date(T0.getTime() + 20_000);
    expect(h.dest.pausedUntil).toEqual(until);
    expect(h.get(p.id)).toMatchObject({ state: 'scheduled', needsAttention: false });
    expect(h.jobs).toEqual([{ postId: p.id, moment: T0.toISOString(), startAfter: until }]);
    expect(h.store.signals).toContain(`dest:${WS}`);
  });

  it('a send pause that appears at the send returns the post to scheduled and queues it', async () => {
    const until = new Date(T0.getTime() + 10_000);
    const h = setup({ send: async () => ({ outcome: 'paused', until }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id).state).toBe('scheduled');
    expect(h.jobs).toEqual([{ postId: p.id, moment: T0.toISOString(), startAfter: until }]);
    expect(h.dest.pausedUntil).toBeNull();
  });
});

describe('sendPost: Telegram refusals (AC-13)', () => {
  it('no_post_right fails the post and marks the destination unavailable with the problem', async () => {
    const h = setup({ send: async () => ({ outcome: 'no_post_right' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({
      state: 'failed',
      outcomeReason: 'no_post_right',
      needsAttention: true,
    });
    expect(h.dest).toMatchObject({ availability: 'unavailable', problem: 'no_post_right' });
    expect(h.jobs).toHaveLength(0);
    expect(h.store.signals).toContain(`dest:${WS}`);
  });

  it('chat_gone fails the post and marks the destination unavailable as chat_gone', async () => {
    const h = setup({ send: async () => ({ outcome: 'chat_gone' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'chat_gone' });
    expect(h.dest).toMatchObject({ availability: 'unavailable', problem: 'chat_gone' });
  });

  it('text_refused fails the post and leaves the destination available', async () => {
    const h = setup({ send: async () => ({ outcome: 'text_refused' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'text_refused' });
    expect(h.dest.availability).toBe('available');
  });

  it('telegram_error fails the post with telegram_error', async () => {
    const h = setup({ send: async () => ({ outcome: 'telegram_error' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'telegram_error' });
  });

  it('a bot that became unavailable at the send fails the post with bot_not_working', async () => {
    const h = setup({ send: async () => ({ outcome: 'bot_unavailable' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'bot_not_working' });
  });

  it('a bot replaced at the send fails the post with not_current_bot', async () => {
    const h = setup({ send: async () => ({ outcome: 'bot_changed' }) });
    const p = h.seed();
    await h.run(p);
    expect(h.get(p.id)).toMatchObject({ state: 'failed', outcomeReason: 'not_current_bot' });
  });
});

describe('dead-letter settler (AC-08, AC-12)', () => {
  it('settles a stale sending claim as not confirmed with attention', async () => {
    const h = setup();
    const p = h.seed({ state: 'sending', sendingStartedAt: T0 });
    await h.settler.settle({ postId: p.id, workspaceId: WS, moment: T0.toISOString() });
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'not_confirmed', needsAttention: true });
  });

  it('settles a scheduled post more than 15 minutes past its moment as missed (service_down)', async () => {
    const h = setup({ now: new Date(T0.getTime() + 16 * MIN) });
    const p = h.seed();
    await h.settler.settle({ postId: p.id, workspaceId: WS, moment: T0.toISOString() });
    expect(h.get(p.id)).toMatchObject({
      state: 'missed',
      outcomeReason: 'service_down',
      needsAttention: true,
    });
    expect(h.jobs).toHaveLength(0);
  });

  it('queues a fresh send for the same moment when the post is still inside its window', async () => {
    const h = setup({ now: new Date(T0.getTime() + 2 * MIN) });
    const p = h.seed();
    await h.settler.settle({ postId: p.id, workspaceId: WS, moment: T0.toISOString() });
    expect(h.get(p.id).state).toBe('scheduled');
    expect(h.jobs).toEqual([
      { postId: p.id, moment: T0.toISOString(), startAfter: new Date(T0.getTime() + 2 * MIN) },
    ]);
  });

  it('does nothing for a post that moved on (published, other moment)', async () => {
    const h = setup({ now: new Date(T0.getTime() + 20 * MIN) });
    const done = h.seed({ state: 'published' });
    const moved = h.seed({ scheduledFor: new Date(T0.getTime() + 60 * MIN) });
    await h.settler.settle({ postId: done.id, workspaceId: WS, moment: T0.toISOString() });
    await h.settler.settle({ postId: moved.id, workspaceId: WS, moment: T0.toISOString() });
    expect(h.get(done.id).state).toBe('published');
    expect(h.get(moved.id).state).toBe('scheduled');
    expect(h.jobs).toHaveLength(0);
  });
});

describe('sendPost: review follow-up T25 (F1-F4)', () => {
  it('F1: the claim commits the chat pace (next_send_at = now + 3 s) before the send', async () => {
    let paceAtSend: Date | null = null;
    const ref: { h?: ReturnType<typeof setup> } = {};
    const h = setup({
      send: async () => {
        paceAtSend = ref.h!.dest.nextSendAt;
        return { outcome: 'sent', messageId: 1n, at: T0 };
      },
    });
    ref.h = h;
    const p = h.seed();
    await h.run(p);
    expect(paceAtSend).toEqual(new Date(T0.getTime() + 3000));
  });

  it("F2: a job of an old moment leaves another moment's live sending claim alone", async () => {
    const h = setup();
    const p = h.seed({ state: 'sending', sendingStartedAt: T0 });
    await h.run(p, new Date(T0.getTime() - 5 * MIN));
    expect(h.sends).toHaveLength(0);
    expect(h.get(p.id).state).toBe('sending');
    expect(h.store.signals).not.toContain(`post:${WS}:${p.id}`);
  });

  it('F3: a bot pause that ends past moment + 15 min marks the post missed now with bot_paused', async () => {
    const h = setup({
      now: new Date(T0.getTime() + MIN),
      bot: {
        state: 'connected',
        telegramBotId: BOT,
        sendPausedUntil: new Date(T0.getTime() + 20 * MIN),
      },
    });
    const p = h.seed();
    await h.run(p);
    expect(h.sends).toHaveLength(0);
    expect(h.jobs).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({
      state: 'missed',
      outcomeReason: 'bot_paused',
      needsAttention: true,
    });
  });

  it('F3: a chat limit that ends past moment + 15 min marks the post missed now with chat_rate_limited', async () => {
    const h = setup({
      now: new Date(T0.getTime() + MIN),
      dest: { pausedUntil: new Date(T0.getTime() + 20 * MIN) },
    });
    const p = h.seed();
    await h.run(p);
    expect(h.jobs).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'missed', outcomeReason: 'chat_rate_limited' });
  });

  it('F3: a 429 whose retry-after ends past the window ends missed with chat_rate_limited, not queued', async () => {
    const h = setup({
      now: new Date(T0.getTime() + 10 * MIN),
      send: async () => ({ outcome: 'rate_limited', retryAfterMs: 10 * MIN }),
    });
    const p = h.seed();
    await h.run(p);
    expect(h.jobs).toHaveLength(0);
    expect(h.get(p.id)).toMatchObject({ state: 'missed', outcomeReason: 'chat_rate_limited' });
  });

  it('F4: prepare locks the destination before the post', async () => {
    const h = setup();
    const p = h.seed();
    await h.run(p);
    expect(h.events.indexOf('dest-lock')).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf('dest-lock')).toBeLessThan(h.events.indexOf('post-lock'));
  });

  it('F4: record writes the destination before the post', async () => {
    const h = setup();
    const p = h.seed();
    await h.run(p);
    const afterSend = h.events.slice(h.events.indexOf('send'));
    expect(afterSend.indexOf('dest-write')).toBeGreaterThanOrEqual(0);
    expect(afterSend.indexOf('dest-write')).toBeLessThan(afterSend.indexOf('post-write'));
  });
});
