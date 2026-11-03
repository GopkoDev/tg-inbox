import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { createPostReads } from './post-reads.js';
import type { PostRecord } from '../infra/post-repo.js';
import {
  basePost,
  basePostDestination,
  fakeDestinationRepo,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const T0 = new Date('2026-11-03T09:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const OPERATOR = newId();
const TEAMMATE = newId();
const DEST = newId();
const OLD_BOT_DEST = newId();
const CURRENT_BOT = 1n;

function setup() {
  const store = fakeStore();
  const signalled: string[] = [];
  store.destinations.push(
    basePostDestination({ id: DEST, workspaceId: WS, username: 'acmenews', telegramBotId: 1n }),
    basePostDestination({ id: OLD_BOT_DEST, workspaceId: WS, telegramBotId: 2n }),
  );
  const reads = createPostReads({
    posts: {
      ...fakePostRepo(store),
      // SQL-side filters and a row limit, as the real repo does
      async list(
        ws: string,
        filter: { states?: PostRecord['state'][]; needsAttention?: boolean; limit?: number },
      ) {
        return store.posts
          .filter(
            (p) =>
              p.workspaceId === ws &&
              (!filter.states || filter.states.includes(p.state)) &&
              (!filter.needsAttention || p.needsAttention),
          )
          .sort((a, b) => b.lastChangedAt.getTime() - a.lastChangedAt.getTime())
          .slice(0, filter.limit ?? 200);
      },
    },
    transaction: fakeTransaction(),
    signals: {
      async postChanged(_tx: unknown, ws: string, id: string) {
        signalled.push(`post:${ws}:${id}`);
      },
    },
    destinations: fakeDestinationRepo(store),
    workspaces: {
      async displayNames(_ws, ids) {
        return new Map(ids.map((i) => [i, i === OPERATOR ? 'Olga' : 'Taras']));
      },
    },
    workspaceSettings: { timeZone: async () => 'Europe/Kyiv' },
    currentBotId: async () => CURRENT_BOT,
    clock: fixedClock(T0),
  });
  const seed = (o: Partial<ReturnType<typeof basePost>> = {}) => {
    const p = basePost({ id: newId(), workspaceId: WS, authorAccountId: OPERATOR, ...o });
    store.posts.push(p);
    return p;
  };
  return { store, reads, seed, signalled };
}

describe('listPosts (AC-05, AC-13)', () => {
  it('lists every member’s posts with destination, state and the last changer’s name', async () => {
    const h = setup();
    const p = h.seed({ text: 'Hello', destinationId: DEST, lastChangedByAccountId: TEAMMATE });
    const list = await h.reads.listPosts(WS, {});
    expect(list).toMatchObject({ workspace_id: WS, time_zone: 'Europe/Kyiv', truncated: false });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: p.id,
      text_start: 'Hello',
      state: 'draft',
      destination: { id: DEST, title: 'Acme Flowers News', availability: 'available' },
      last_changed_by: { account_id: TEAMMATE, display_name: 'Taras' },
    });
  });

  it('filters by state and never shows another workspace', async () => {
    const h = setup();
    h.seed({ state: 'failed', needsAttention: true });
    h.seed();
    h.store.posts.push(basePost({ id: newId(), workspaceId: OTHER_WS, state: 'failed' }));
    const failed = await h.reads.listPosts(WS, { states: ['failed'] });
    expect(failed.items.map((i) => i.state)).toEqual(['failed']);
    expect((await h.reads.listPosts(WS, {})).items).toHaveLength(2);
  });
});

describe('getPost (AC-04, AC-05)', () => {
  it('answers a foreign post as not found', async () => {
    const h = setup();
    const p = h.seed();
    await expect(h.reads.getPost(OTHER_WS, p.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks the destination not_current_bot when another bot connected it', async () => {
    const h = setup();
    const p = h.seed({ destinationId: OLD_BOT_DEST });
    const post = await h.reads.getPost(WS, p.id);
    expect(post.destination).toMatchObject({
      id: OLD_BOT_DEST,
      availability: 'unavailable',
      problem: 'not_current_bot',
    });
  });

  it('gives a published post its Telegram link and a 48 h delete window', async () => {
    const h = setup();
    const at = new Date('2026-11-02T09:00:00Z');
    const p = h.seed({
      state: 'published',
      destinationId: DEST,
      publishedAt: at,
      telegramMessageId: 77n,
    });
    const post = await h.reads.getPost(WS, p.id);
    expect(post).toMatchObject({
      telegram_link: 'https://t.me/acmenews/77',
      deletable_until: new Date(at.getTime() + 48 * 3_600_000).toISOString(),
      author: { account_id: OPERATOR, display_name: 'Olga' },
    });
  });

  it('a draft has no link and no delete window', async () => {
    const h = setup();
    const p = h.seed();
    expect(await h.reads.getPost(WS, p.id)).toMatchObject({
      telegram_link: null,
      deletable_until: null,
    });
  });
});

describe('attention count and mark seen (AC-13)', () => {
  it('counts the workspace’s posts needing attention for the whole team', async () => {
    const h = setup();
    h.seed({ state: 'failed', needsAttention: true });
    h.seed({ state: 'missed', needsAttention: true });
    h.seed();
    h.store.posts.push(
      basePost({ id: newId(), workspaceId: OTHER_WS, state: 'failed', needsAttention: true }),
    );
    expect(await h.reads.getPostAttention(WS)).toEqual({ count: 2 });
  });

  it('opening clears the mark for everyone once; a second time is unchanged', async () => {
    const h = setup();
    const p = h.seed({ state: 'failed', needsAttention: true });
    expect(await h.reads.markPostSeen(WS, p.id)).toEqual({ outcome: 'seen' });
    expect(await h.reads.getPostAttention(WS)).toEqual({ count: 0 });
    expect(await h.reads.markPostSeen(WS, p.id)).toEqual({ outcome: 'unchanged' });
  });

  it('a foreign post is not found', async () => {
    const h = setup();
    const p = h.seed({ state: 'failed', needsAttention: true });
    await expect(h.reads.markPostSeen(OTHER_WS, p.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('list filters in SQL before the cap (AC-13)', () => {
  it('finds an old failed post behind 200+ newer drafts, and reports truncated', async () => {
    const h = setup();
    h.seed({
      state: 'failed',
      needsAttention: true,
      lastChangedAt: new Date('2026-01-01T00:00:00Z'),
    });
    for (let i = 0; i < 205; i++) {
      h.seed({ lastChangedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)) });
    }
    const failed = await h.reads.listPosts(WS, { needsAttention: true });
    expect(failed.items.map((i) => i.state)).toEqual(['failed']);
    expect(failed.truncated).toBe(false);
    const all = await h.reads.listPosts(WS, {});
    expect(all.items).toHaveLength(200);
    expect(all.truncated).toBe(true);
  });

  it('accepts several states at once', async () => {
    const h = setup();
    h.seed({ state: 'scheduled' });
    h.seed({ state: 'sending' });
    h.seed({ state: 'draft' });
    const list = await h.reads.listPosts(WS, { states: ['scheduled', 'sending'] });
    expect(list.items.map((i) => i.state).sort()).toEqual(['scheduled', 'sending']);
  });
});

describe('mark seen publishes post.changed (AC-13)', () => {
  it('signals once when the mark was cleared, and not when unchanged', async () => {
    const h = setup();
    const p = h.seed({ state: 'failed', needsAttention: true });
    await h.reads.markPostSeen(WS, p.id);
    expect(h.signalled).toEqual([`post:${WS}:${p.id}`]);
    await h.reads.markPostSeen(WS, p.id);
    expect(h.signalled).toHaveLength(1);
  });
});
