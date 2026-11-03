import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  NotFoundError,
  PostDeleteRefusedError,
  PostDeleteWindowPassedError,
  PostNotPublishedError,
  TelegramUnavailableError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { createPostDeletion } from './delete-published.js';
import {
  basePost,
  basePostDestination,
  fakeDestinationRepo,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const WS = newId();
const OWNER = newId();
const DEST = newId();
const hoursAgo = (h: number, m = 0) => new Date(NOW.getTime() - (h * 60 + m) * 60_000);

type Outcome = { outcome: 'deleted' } | { outcome: 'refused' } | { outcome: 'bot_changed' };

function setup(opts: { bot?: Outcome | 'unavailable'; ownerActive?: boolean } = {}) {
  const store = fakeStore();
  store.destinations.push(basePostDestination({ id: DEST, workspaceId: WS }));
  const calls: unknown[] = [];
  const locks: string[] = [];
  const deletion = createPostDeletion({
    transaction: fakeTransaction(),
    posts: fakePostRepo(store),
    destinations: fakeDestinationRepo(store),
    workspaces: {
      async lockActiveMembers(_tx, ws, ids) {
        locks.push(`members:${ids.join(',')}`);
        return opts.ownerActive === false ? [] : ids.filter(() => ws === WS);
      },
    },
    bots: {
      async deletePost(req) {
        calls.push(req);
        if (opts.bot === 'unavailable') throw new TelegramUnavailableError();
        return opts.bot ?? { outcome: 'deleted' };
      },
    },
    signals: {
      async postChanged(_tx, ws, id) {
        store.signals.push(`post:${ws}:${id}`);
      },
    },
    views: { postView: async (_ws, id) => ({ id }) as never },
    clock: fixedClock(NOW),
  });
  const seed = (o: Parameters<typeof basePost>[0] extends infer P ? Partial<P> : never = {}) => {
    const p = basePost({
      id: newId(),
      workspaceId: WS,
      state: 'published',
      destinationId: DEST,
      text: 'Spring sale',
      publishedAt: hoursAgo(1),
      telegramMessageId: 77n,
      ...o,
    });
    store.posts.push(p);
    return p;
  };
  return { store, deletion, seed, calls, locks };
}

describe('deletePostFromTelegram (AC-15)', () => {
  it('deletes a post published 47:59 ago: calls the bot, marks deleted by owner and time, keeps the text', async () => {
    const h = setup();
    const p = h.seed({ publishedAt: hoursAgo(47, 59) });
    await h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id);
    expect(h.calls).toEqual([
      { workspaceId: WS, telegramBotId: 1n, chatId: '-1001234567890', messageId: 77n },
    ]);
    expect(h.store.posts[0]).toMatchObject({
      state: 'deleted',
      deletedAt: NOW,
      deletedByAccountId: OWNER,
      text: 'Spring sale',
    });
    expect(h.store.signals).toEqual([`post:${WS}:${p.id}`]);
    expect(h.locks).toEqual([`members:${OWNER}`]);
  });

  it('refuses after 48 hours before calling Telegram', async () => {
    const h = setup();
    const p = h.seed({ publishedAt: hoursAgo(48, 1) });
    await expect(
      h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id),
    ).rejects.toBeInstanceOf(PostDeleteWindowPassedError);
    expect(h.calls).toEqual([]);
    expect(h.store.posts[0]!.state).toBe('published');
  });

  it.each(['draft', 'scheduled', 'failed'] as const)(
    'refuses a %s post as not published',
    async (state) => {
      const h = setup();
      const p = h.seed({ state, publishedAt: null, telegramMessageId: null });
      await expect(
        h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id),
      ).rejects.toBeInstanceOf(PostNotPublishedError);
      expect(h.calls).toEqual([]);
    },
  );

  it('leaves an already deleted post unchanged and does not call Telegram', async () => {
    const h = setup();
    const was = new Date('2026-11-03T10:00:00Z');
    const p = h.seed({ state: 'deleted', deletedAt: was, deletedByAccountId: newId() });
    await h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id);
    expect(h.calls).toEqual([]);
    expect(h.store.posts[0]!.deletedAt).toEqual(was);
    expect(h.store.signals).toEqual([]);
  });

  it.each([{ outcome: 'refused' }, { outcome: 'bot_changed' }] as const)(
    'keeps the post published when Telegram answers %o',
    async (bot) => {
      const h = setup({ bot });
      const p = h.seed();
      await expect(
        h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id),
      ).rejects.toBeInstanceOf(PostDeleteRefusedError);
      expect(h.store.posts[0]).toMatchObject({ state: 'published', deletedAt: null });
    },
  );

  it('keeps the post published when Telegram does not answer', async () => {
    const h = setup({ bot: 'unavailable' });
    const p = h.seed();
    await expect(
      h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id),
    ).rejects.toBeInstanceOf(TelegramUnavailableError);
    expect(h.store.posts[0]).toMatchObject({ state: 'published', deletedAt: null });
  });

  it('refuses a member whose access was removed, calling nothing', async () => {
    const h = setup({ ownerActive: false });
    const p = h.seed();
    await expect(
      h.deletion.deletePostFromTelegram(WS, { accountId: OWNER, role: 'owner' }, p.id),
    ).rejects.toBeInstanceOf(AccessRemovedError);
    expect(h.calls).toEqual([]);
  });

  it("does not find another workspace's post", async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.deletion.deletePostFromTelegram(newId(), { accountId: OWNER, role: 'owner' }, p.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
