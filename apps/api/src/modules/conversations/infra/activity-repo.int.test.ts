import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertActivity, twoWorkspacesWithInbox } from '../../../test/fixtures/conversations.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createActivityRepo } from './activity-repo.js';

const NOW = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000);

describe('activity repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createActivityRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createActivityRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('insert stores the entry and byId reads it back', async () => {
    const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const id = newId();
    await repo.insert(a.workspaceId, {
      id,
      conversationId: a.conversationId,
      kind: 'assigned',
      cause: 'member',
      actorAccountId: a.accountId,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: sharedAccountId,
      positionAt: at(5),
      createdAt: at(4),
    });
    expect(await repo.byId(a.workspaceId, id)).toEqual({
      id,
      conversationId: a.conversationId,
      kind: 'assigned',
      cause: 'member',
      actorAccountId: a.accountId,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: sharedAccountId,
      positionAt: at(5),
      createdAt: at(4),
    });
  });

  it('isolation: byId and insert are scoped by workspace', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    expect(await repo.byId(b.workspaceId, a.activityId)).toBeNull();
    expect(await repo.byId(a.workspaceId, a.activityId)).not.toBeNull();
    // insert stamps the workspace it is called for; the other workspace never sees the entry
    const mine = newId();
    await repo.insert(b.workspaceId, {
      id: mine,
      conversationId: b.conversationId,
      kind: 'closed',
      cause: 'member',
      actorAccountId: b.accountId,
      previousAssigneeAccountId: null,
      newAssigneeAccountId: null,
      positionAt: at(1),
      createdAt: at(1),
    });
    expect(await repo.byId(a.workspaceId, mine)).toBeNull();
    expect((await repo.byId(b.workspaceId, mine))?.conversationId).toBe(b.conversationId);
  });

  it('latestFor returns the newest by position, ties broken by id, null when none', async () => {
    const { a } = await twoWorkspacesWithInbox(db);
    const w = a.workspaceId;
    const c = a.conversationId;
    expect(await repo.latestFor(w, c)).toBeNull();
    await insertActivity(db, {
      workspaceId: w,
      conversationId: c,
      kind: 'closed',
      actorAccountId: a.accountId,
      positionAt: at(10),
    });
    const x = await insertActivity(db, {
      workspaceId: w,
      conversationId: c,
      kind: 'reopened',
      actorAccountId: a.accountId,
      positionAt: at(20),
    });
    const y = await insertActivity(db, {
      workspaceId: w,
      conversationId: c,
      kind: 'closed',
      actorAccountId: a.accountId,
      positionAt: at(20),
    });
    const winner = x > y ? x : y;
    expect((await repo.latestFor(w, c))?.id).toBe(winner);
  });

  it('isolation: latestFor is null for another workspace', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    expect(await repo.latestFor(b.workspaceId, a.assignedConversationId)).toBeNull();
    expect((await repo.latestFor(a.workspaceId, a.assignedConversationId))?.id).toBe(a.activityId);
  });

  it('countByActorSince counts the actor’s entries created after since and reports the oldest', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const w = a.workspaceId;
    const c = a.conversationId;
    const actor = a.accountId;
    const mk = (created: number, actorId = actor) =>
      insertActivity(db, {
        workspaceId: w,
        conversationId: c,
        kind: 'closed',
        actorAccountId: actorId,
        createdAt: at(created),
        positionAt: at(created),
      });
    await mk(0); // exactly 60 s old at now=60: outside
    await mk(10);
    await mk(30);
    await mk(30, b.accountId === actor ? actor : a.accountId); // same actor again
    const since = at(0); // now - 60 s
    const r = await db.transaction().execute((tx) => repo.countByActorSince(w, actor, since, tx));
    // a.activityId (actor a.accountId, created at T=NOW=at(0)) is also outside (not > since)
    expect(r).toEqual({ count: 3, oldestCreatedAt: at(10) });
    const none = await db
      .transaction()
      .execute((tx) => repo.countByActorSince(w, newId(), since, tx));
    expect(none).toEqual({ count: 0, oldestCreatedAt: null });
  });

  it('isolation: countByActorSince ignores another workspace’s entries', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    // b's fixture activity has actor b.accountId; asking in a's workspace for it counts nothing
    const r = await db
      .transaction()
      .execute((tx) => repo.countByActorSince(a.workspaceId, b.accountId, at(-60), tx));
    expect(r).toEqual({ count: 0, oldestCreatedAt: null });
    const own = await db
      .transaction()
      .execute((tx) => repo.countByActorSince(b.workspaceId, b.accountId, at(-60), tx));
    expect(own.count).toBe(1);
  });
});
