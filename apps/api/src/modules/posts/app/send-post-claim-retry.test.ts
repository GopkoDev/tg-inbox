import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import { createPostSender } from './send-post.js';
import {
  basePost,
  basePostDestination,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const WS = newId();
const DEST = newId();
const T0 = new Date('2026-11-03T09:00:00Z');

describe('a send job that throws after its claim (AC-08)', () => {
  it('re-queues itself for when the claim goes stale, and a later run settles the post as not confirmed', async () => {
    let now = T0;
    const store = fakeStore();
    const dest = basePostDestination({
      id: DEST,
      workspaceId: WS,
      telegramBotId: 1n,
      chatId: -100n,
    });
    store.destinations.push(dest);
    const base = fakePostRepo(store);
    const get = (id: string) => store.posts.find((p) => p.id === id)!;
    const queued: { startAfter: Date }[] = [];
    const deps = {
      transaction: fakeTransaction(),
      clock: { now: () => now },
      posts: {
        ...base,
        async claim(_w: string, id: string, at: Date) {
          const p = get(id);
          Object.assign(p, { state: 'sending', sendingStartedAt: at });
          return { ...p };
        },
        async markNotConfirmed(_w: string, id: string) {
          const p = get(id);
          if (p.state !== 'sending') return null;
          Object.assign(p, { state: 'not_confirmed' });
          return { ...p };
        },
        async earlierDueInChat() {
          return [];
        },
        async sentTimesSince() {
          return [];
        },
        async markPublished() {
          throw new Error('db blip while recording');
        },
      },
      destinations: {
        async lock() {
          return { ...dest };
        },
        async setNextSendAt() {
          return true;
        },
        async setPausedUntil() {
          return true;
        },
        async setAvailability() {
          return true;
        },
      },
      workspaces: {
        async lockActiveOwners(_t: unknown, _w: string, ids: string[]) {
          return ids;
        },
      },
      lockPosts: async () => undefined,
      bots: {
        postReadiness: async () => ({
          state: 'connected',
          telegramBotId: 1n,
          sendPausedUntil: null,
        }),
        async sendPost() {
          return { outcome: 'sent', messageId: 1n, at: now };
        },
      },
      jobs: {
        async enqueueSend(_tx: unknown, _job: unknown, startAfter: Date) {
          queued.push({ startAfter });
        },
      },
      signals: { async postChanged() {}, async destinationsChanged() {} },
    };
    const sender = createPostSender(deps as never);
    const p = basePost({
      id: newId(),
      workspaceId: WS,
      destinationId: DEST,
      text: 'x',
      state: 'scheduled',
      scheduledFor: T0,
      scheduledByAccountId: null,
      scheduleKind: 'time',
    });
    store.posts.push(p);
    const job = { postId: p.id, workspaceId: WS, moment: T0.toISOString() };

    await expect(sender.sendPost(job)).rejects.toThrow('db blip');
    expect(get(p.id).state).toBe('sending');

    // pg-boss retry 2 s later finds a live claim: it must queue a later run, not drop the job
    now = new Date(T0.getTime() + 2_000);
    await expect(sender.sendPost(job)).resolves.toBeUndefined();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.startAfter.getTime()).toBeGreaterThanOrEqual(T0.getTime() + 30_000);

    // the queued run, once the claim is stale
    now = queued[0]!.startAfter;
    now = new Date(now.getTime() + 1);
    await expect(sender.sendPost(job)).resolves.toBeUndefined();
    expect(get(p.id).state).toBe('not_confirmed');
  });
});
