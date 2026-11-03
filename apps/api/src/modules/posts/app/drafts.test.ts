import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { createPostDrafts } from './drafts.js';
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
const OWNER = newId();
const DEST = newId();
const FOREIGN_DEST = newId();

function setup() {
  const store = fakeStore();
  store.destinations.push(
    basePostDestination({ id: DEST, workspaceId: WS }),
    basePostDestination({ id: FOREIGN_DEST, workspaceId: OTHER_WS }),
  );
  const drafts = createPostDrafts({
    transaction: fakeTransaction(),
    posts: fakePostRepo(store),
    destinations: fakeDestinationRepo(store),
    signals: {
      async postChanged(_tx, ws, postId) {
        store.signals.push(`post:${ws}:${postId}`);
      },
    },
    views: { postView: async (_ws, id) => ({ id }) as never },
    clock: fixedClock(T0),
  });
  const seed = (o: Parameters<typeof basePost>[0] extends infer P ? Partial<P> : never = {}) => {
    const p = basePost({ id: newId(), workspaceId: WS, authorAccountId: OPERATOR, ...o });
    store.posts.push(p);
    return p;
  };
  return { store, drafts, seed };
}

describe('createPost (AC-05)', () => {
  it('starts a draft at version 1 by the member, with destination and silent, and signals', async () => {
    const h = setup();
    await h.drafts.createPost(WS, OPERATOR, {
      text: '  Hello \n',
      destination_id: DEST,
      silent: true,
    });
    expect(h.store.posts).toHaveLength(1);
    expect(h.store.posts[0]).toMatchObject({
      workspaceId: WS,
      state: 'draft',
      version: 1,
      text: 'Hello',
      silent: true,
      destinationId: DEST,
      authorAccountId: OPERATOR,
      lastChangedByAccountId: OPERATOR,
      createdAt: T0,
    });
    expect(h.store.signals).toEqual([`post:${WS}:${h.store.posts[0]!.id}`]);
  });

  it('may start empty with no destination', async () => {
    const h = setup();
    await h.drafts.createPost(WS, OPERATOR, {});
    expect(h.store.posts[0]).toMatchObject({ text: '', destinationId: null, silent: false });
  });

  it("refuses another workspace's destination as not found (AC-04), writing nothing", async () => {
    const h = setup();
    await expect(
      h.drafts.createPost(WS, OPERATOR, { destination_id: FOREIGN_DEST }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.store.posts).toEqual([]);
  });

  it('refuses a text over 4096 UTF-16 units: POST_TEXT_INVALID (AC-06)', async () => {
    const h = setup();
    await expect(
      h.drafts.createPost(WS, OPERATOR, { text: 'x'.repeat(4097) }),
    ).rejects.toMatchObject({ code: 'POST_TEXT_INVALID', statusCode: 400 });
    expect(h.store.posts).toEqual([]);
  });
});

describe('savePost (AC-05, AC-06)', () => {
  it('saves against the shown version, raising it and naming the last changer', async () => {
    const h = setup();
    const p = h.seed();
    await h.drafts.savePost(WS, TEAMMATE, p.id, { expected_version: 1, text: 'New', silent: true });
    expect(h.store.posts[0]).toMatchObject({
      text: 'New',
      silent: true,
      version: 2,
      lastChangedByAccountId: TEAMMATE,
      lastChangedAt: T0,
    });
    expect(h.store.signals).toEqual([`post:${WS}:${p.id}`]);
  });

  it('refuses a stale version with POST_DRAFT_CHANGED, never overwriting', async () => {
    const h = setup();
    const p = h.seed({ version: 3, text: 'Teammate text' });
    await expect(
      h.drafts.savePost(WS, OPERATOR, p.id, { expected_version: 2, text: 'Mine' }),
    ).rejects.toMatchObject({ code: 'POST_DRAFT_CHANGED', statusCode: 409 });
    expect(h.store.posts[0]).toMatchObject({ text: 'Teammate text', version: 3 });
    expect(h.store.signals).toEqual([]);
  });

  it('refuses a post that is not a draft: POST_NOT_A_DRAFT', async () => {
    const h = setup();
    const p = h.seed({ state: 'scheduled' });
    await expect(
      h.drafts.savePost(WS, OPERATOR, p.id, { expected_version: 1, text: 'x' }),
    ).rejects.toMatchObject({ code: 'POST_NOT_A_DRAFT', statusCode: 409 });
  });

  it('refuses a text over the limit and a foreign destination, changing nothing', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.drafts.savePost(WS, OPERATOR, p.id, { expected_version: 1, text: 'x'.repeat(4097) }),
    ).rejects.toMatchObject({ code: 'POST_TEXT_INVALID' });
    await expect(
      h.drafts.savePost(WS, OPERATOR, p.id, { expected_version: 1, destination_id: FOREIGN_DEST }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.store.posts[0]).toMatchObject({ version: 1, destinationId: null });
  });

  it("answers another workspace's post as not found (AC-04)", async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.drafts.savePost(OTHER_WS, OPERATOR, p.id, { expected_version: 1, text: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('duplicatePost', () => {
  it('copies text, destination and sound into a new draft authored by the duplicator', async () => {
    const h = setup();
    const p = h.seed({ text: 'Hi', destinationId: DEST, silent: true, state: 'published' });
    await h.drafts.duplicatePost(WS, TEAMMATE, p.id);
    expect(h.store.posts).toHaveLength(2);
    expect(h.store.posts[1]).toMatchObject({
      state: 'draft',
      version: 1,
      text: 'Hi',
      destinationId: DEST,
      silent: true,
      authorAccountId: TEAMMATE,
    });
    expect(h.store.posts[1]!.id).not.toBe(p.id);
  });

  it('not found for a foreign post', async () => {
    const h = setup();
    const p = h.seed();
    await expect(h.drafts.duplicatePost(OTHER_WS, OPERATOR, p.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('deletePostDraft (AC-18)', () => {
  it('lets the author delete their draft', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.drafts.deletePostDraft(WS, { accountId: OPERATOR, role: 'operator' }, p.id),
    ).resolves.toEqual({ outcome: 'deleted' });
    expect(h.store.posts).toEqual([]);
    expect(h.store.signals).toEqual([`post:${WS}:${p.id}`]);
  });

  it('lets an owner delete another member’s draft', async () => {
    const h = setup();
    const p = h.seed();
    await h.drafts.deletePostDraft(WS, { accountId: OWNER, role: 'owner' }, p.id);
    expect(h.store.posts).toEqual([]);
  });

  it('refuses another operator: FORBIDDEN, kept', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.drafts.deletePostDraft(WS, { accountId: TEAMMATE, role: 'operator' }, p.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(h.store.posts).toHaveLength(1);
  });

  it.each(['scheduled', 'published', 'failed', 'missed'] as const)(
    'refuses a %s post: POST_NOT_A_DRAFT, kept as a record',
    async (state) => {
      const h = setup();
      const p = h.seed({ state });
      await expect(
        h.drafts.deletePostDraft(WS, { accountId: OPERATOR, role: 'operator' }, p.id),
      ).rejects.toMatchObject({ code: 'POST_NOT_A_DRAFT', statusCode: 409 });
      expect(h.store.posts).toHaveLength(1);
    },
  );
});

describe('movePostBackToDraft (AC-11)', () => {
  it('returns a scheduled post to a draft for any member, raising the version, keeping the author', async () => {
    const h = setup();
    const p = h.seed({
      state: 'scheduled',
      scheduledFor: new Date('2026-11-05T09:00:00Z'),
      scheduledByAccountId: OWNER,
      scheduleKind: 'time',
    });
    await h.drafts.movePostBackToDraft(WS, TEAMMATE, p.id, 1);
    expect(h.store.posts[0]).toMatchObject({
      state: 'draft',
      version: 2,
      scheduledFor: null,
      scheduledByAccountId: null,
      authorAccountId: OPERATOR,
      lastChangedByAccountId: TEAMMATE,
    });
    expect(h.store.signals).toEqual([`post:${WS}:${p.id}`]);
  });

  it.each(['sending', 'published'] as const)(
    'refuses a %s post: POST_NOT_SCHEDULED',
    async (state) => {
      const h = setup();
      const p = h.seed({ state });
      await expect(h.drafts.movePostBackToDraft(WS, OPERATOR, p.id, 1)).rejects.toMatchObject({
        code: 'POST_NOT_SCHEDULED',
        statusCode: 409,
      });
    },
  );
});

describe('movePostBackToDraft idempotence and version (AC-11)', () => {
  it('answers unchanged for a post that is already a draft, without a signal', async () => {
    const h = setup();
    const p = h.seed();
    const res = await h.drafts.movePostBackToDraft(WS, OPERATOR, p.id, p.version);
    expect(res.outcome).toBe('unchanged');
    expect(h.store.signals).toEqual([]);
  });

  it('answers changed for a scheduled post', async () => {
    const h = setup();
    const p = h.seed({
      state: 'scheduled',
      scheduledFor: new Date('2026-11-05T09:00:00Z'),
      scheduledByAccountId: OWNER,
      scheduleKind: 'time',
    });
    const res = await h.drafts.movePostBackToDraft(WS, OPERATOR, p.id, p.version);
    expect(res.outcome).toBe('changed');
  });

  it('refuses a stale expected_version: POST_DRAFT_CHANGED', async () => {
    const h = setup();
    const p = h.seed({
      state: 'scheduled',
      version: 3,
      scheduledFor: new Date('2026-11-05T09:00:00Z'),
      scheduledByAccountId: OWNER,
      scheduleKind: 'time',
    });
    await expect(h.drafts.movePostBackToDraft(WS, OPERATOR, p.id, 2)).rejects.toMatchObject({
      code: 'POST_DRAFT_CHANGED',
    });
    expect(h.store.posts[0]?.state).toBe('scheduled');
  });
});
