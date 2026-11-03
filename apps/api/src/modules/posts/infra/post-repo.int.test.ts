import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createDestinationRepo } from './destination-repo.js';
import { createPostRepo, lockPosts } from './post-repo.js';

const T0 = new Date('2026-11-03T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('post repository (AC-04)', () => {
  let database: TestDatabase;
  let db: Db;
  let posts: ReturnType<typeof createPostRepo>;
  let dests: ReturnType<typeof createDestinationRepo>;
  let n = 0;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    posts = createPostRepo(db);
    dests = createDestinationRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  async function setup() {
    const { a, b } = await twoWorkspacesWithTags(db);
    const mk = (w: typeof a) =>
      dests.insert(w.workspaceId, {
        id: newId(),
        telegramBotId: 1n,
        chatId: BigInt(-1000000000000 - ++n),
        kind: 'channel',
        title: 'Chat',
        username: null,
        connectedByAccountId: w.ownerAccountId,
        connectedAt: at(0),
        membershipChangedAt: at(0),
      });
    return { a, b, destA: await mk(a), destB: await mk(b) };
  }

  const draftOf = (w: { operatorAccountId: string }, destinationId: string | null, s = 1) => ({
    id: newId(),
    destinationId,
    text: 'Hello channel',
    silent: false,
    authorAccountId: w.operatorAccountId,
    createdAt: at(s),
  });

  const schedule = (ws: string, id: string, version: number, by: string, when: Date) =>
    posts.schedule(
      ws,
      id,
      version,
      { scheduledFor: when, scheduledByAccountId: by, scheduleKind: 'time' },
      at(10),
    );

  it('inserts a draft and finds it only in its workspace', async () => {
    const { a, b, destA } = await setup();
    const input = draftOf(a, destA.id);
    const post = await posts.insertDraft(a.workspaceId, input);
    expect(post).toMatchObject({
      id: input.id,
      workspaceId: a.workspaceId,
      destinationId: destA.id,
      state: 'draft',
      version: 1,
      text: 'Hello channel',
      silent: false,
      authorAccountId: a.operatorAccountId,
      lastChangedByAccountId: a.operatorAccountId,
      lastChangedAt: at(1),
      needsAttention: false,
      scheduledFor: null,
    });
    expect(await posts.find(a.workspaceId, post.id)).toEqual(post);
    expect(await posts.find(b.workspaceId, post.id)).toBeNull();
  });

  it('refuses a destination of another workspace (AC-04)', async () => {
    const { a, destB } = await setup();
    await expect(posts.insertDraft(a.workspaceId, draftOf(a, destB.id))).rejects.toThrow();
  });

  it('locks the row; a foreign id locks nothing', async () => {
    const { a, b, destA } = await setup();
    const p = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    expect(await inTx((tx) => posts.lock(b.workspaceId, p.id, tx))).toBeNull();
    expect(await inTx((tx) => posts.lock(a.workspaceId, p.id, tx))).toMatchObject({ id: p.id });
  });

  it('takes the posts:<ws> advisory lock, serialising one workspace only', async () => {
    const { a, b } = await setup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const first = inTx(async (tx) => {
      await lockPosts(tx, a.workspaceId);
      locked();
      await held;
    });
    await isLocked;
    let sameDone = false;
    let otherDone = false;
    const same = inTx(async (tx) => {
      await lockPosts(tx, a.workspaceId);
      sameDone = true;
    });
    await inTx(async (tx) => {
      await lockPosts(tx, b.workspaceId);
      otherDone = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(otherDone).toBe(true);
    expect(sameDone).toBe(false);
    release();
    await first;
    await same;
    expect(sameDone).toBe(true);
  });

  it('saves a draft only at the expected version, in its workspace', async () => {
    const { a, b, destA } = await setup();
    const p = await posts.insertDraft(a.workspaceId, draftOf(a, null));
    const saved = await posts.saveDraft(
      a.workspaceId,
      p.id,
      1,
      { text: 'Edited', silent: true, destinationId: destA.id },
      a.ownerAccountId,
      at(20),
    );
    expect(saved).toMatchObject({
      text: 'Edited',
      silent: true,
      destinationId: destA.id,
      version: 2,
      lastChangedByAccountId: a.ownerAccountId,
      lastChangedAt: at(20),
      draftNotice: null,
    });
    expect(
      await posts.saveDraft(a.workspaceId, p.id, 1, { text: 'Stale' }, a.ownerAccountId, at(21)),
    ).toBeNull();
    expect(
      await posts.saveDraft(b.workspaceId, p.id, 2, { text: 'Foreign' }, b.ownerAccountId, at(21)),
    ).toBeNull();
    expect((await posts.find(a.workspaceId, p.id))?.text).toBe('Edited');
  });

  it('schedules a draft, claims it, publishes it; a foreign workspace changes nothing', async () => {
    const { a, b, destA } = await setup();
    const p = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    expect(await schedule(b.workspaceId, p.id, 1, b.ownerAccountId, at(100))).toBeNull();
    expect(await schedule(a.workspaceId, p.id, 9, a.ownerAccountId, at(100))).toBeNull();
    expect(await schedule(a.workspaceId, p.id, 1, a.ownerAccountId, at(100))).toMatchObject({
      state: 'scheduled',
      scheduledFor: at(100),
      scheduledByAccountId: a.ownerAccountId,
      scheduleKind: 'time',
    });
    expect(await posts.claim(b.workspaceId, p.id, at(101))).toBeNull();
    expect(await posts.claim(a.workspaceId, p.id, at(101))).toMatchObject({
      state: 'sending',
      sendingStartedAt: at(101),
    });
    expect(await posts.claim(a.workspaceId, p.id, at(102))).toBeNull();
    expect(
      await posts.markPublished(b.workspaceId, p.id, { telegramMessageId: 55n }, at(103)),
    ).toBeNull();
    expect(
      await posts.markPublished(a.workspaceId, p.id, { telegramMessageId: 55n }, at(103)),
    ).toMatchObject({
      state: 'published',
      telegramMessageId: 55n,
      publishedAt: at(103),
      outcomeAt: at(103),
    });
  });

  it('marks a missed post with a reason and attention; a member clears it', async () => {
    const { a, b, destA } = await setup();
    const p = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    await schedule(a.workspaceId, p.id, 1, a.ownerAccountId, at(100));
    expect(await posts.markMissed(b.workspaceId, p.id, 'service_down', at(2000))).toBeNull();
    expect(await posts.markMissed(a.workspaceId, p.id, 'service_down', at(2000))).toMatchObject({
      state: 'missed',
      outcomeReason: 'service_down',
      needsAttention: true,
    });
    expect(await posts.countAttention(a.workspaceId)).toBe(1);
    expect(await posts.countAttention(b.workspaceId)).toBe(0);
    expect(await posts.clearAttention(b.workspaceId, p.id)).toBe(false);
    expect(await posts.clearAttention(a.workspaceId, p.id)).toBe(true);
    expect((await posts.find(a.workspaceId, p.id))?.needsAttention).toBe(false);
  });

  it('returns a scheduled post to draft with a notice, raising the version', async () => {
    const { a, b, destA } = await setup();
    const p = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    await schedule(a.workspaceId, p.id, 1, a.ownerAccountId, at(100));
    expect(
      await posts.returnToDraft(b.workspaceId, p.id, 'owner_deactivated', b.ownerAccountId, at(50)),
    ).toBeNull();
    expect(
      await posts.returnToDraft(
        a.workspaceId,
        p.id,
        'owner_deactivated',
        a.operatorAccountId,
        at(50),
      ),
    ).toMatchObject({
      state: 'draft',
      version: 2,
      draftNotice: 'owner_deactivated',
      scheduledFor: null,
      scheduledByAccountId: null,
      scheduleKind: null,
    });
  });

  it('lists the workspace newest first, filtered by state, capped at 200', async () => {
    const { a, b, destA } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 205; i++) {
      const p = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id, 1000 + i));
      ids.push(p.id);
    }
    const all = await posts.list(a.workspaceId, {});
    expect(all).toHaveLength(200);
    expect(all[0]!.id).toBe(ids[204]);
    expect(await posts.list(a.workspaceId, { state: 'scheduled' })).toEqual([]);
    expect(await posts.list(b.workspaceId, {})).toEqual([]);
  });

  it('counts sent in a window, scheduled posts, scheduled by an account, earlier-due in a chat', async () => {
    const { a, b, destA } = await setup();
    const p1 = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    const p2 = await posts.insertDraft(a.workspaceId, draftOf(a, destA.id));
    await schedule(a.workspaceId, p1.id, 1, a.ownerAccountId, at(100));
    await schedule(a.workspaceId, p2.id, 1, a.operatorAccountId, at(200));
    expect(await posts.countScheduled(a.workspaceId)).toBe(2);
    expect(await posts.countScheduled(b.workspaceId)).toBe(0);
    expect(
      (await posts.scheduledByAccount(a.workspaceId, a.ownerAccountId)).map((p) => p.id),
    ).toEqual([p1.id]);
    expect(await posts.scheduledByAccount(b.workspaceId, a.ownerAccountId)).toEqual([]);
    expect(
      (await posts.earlierDueInChat(a.workspaceId, destA.id, at(200), p2.id)).map((p) => p.id),
    ).toEqual([p1.id]);
    expect(await posts.earlierDueInChat(b.workspaceId, destA.id, at(200), p2.id)).toEqual([]);

    await posts.claim(a.workspaceId, p1.id, at(300));
    expect(await posts.countSentSince(a.workspaceId, at(0))).toBe(1);
    expect(await posts.countSentSince(a.workspaceId, at(301))).toBe(0);
    expect(await posts.countSentSince(b.workspaceId, at(0))).toBe(0);
  });

  it('orders due posts of one chat by (scheduled_for, id) and counts a sending post (T25 F1)', async () => {
    const { a, destA } = await setup();
    const ids = [newId(), newId(), newId()].sort();
    for (const id of ids) {
      await posts.insertDraft(a.workspaceId, { ...draftOf(a, destA.id), id });
      await schedule(a.workspaceId, id, 1, a.ownerAccountId, at(100));
    }
    const ahead = async (id: string) =>
      (await posts.earlierDueInChat(a.workspaceId, destA.id, at(100), id)).map((p) => p.id);
    expect(await ahead(ids[0]!)).toEqual([]);
    expect(await ahead(ids[1]!)).toEqual([ids[0]]);
    expect(await ahead(ids[2]!)).toEqual([ids[0], ids[1]]);
    await posts.claim(a.workspaceId, ids[0]!, at(101));
    expect(await ahead(ids[1]!)).toEqual([ids[0]]);
  });
});
