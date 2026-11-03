import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../platform/db.js';
import { newId } from '../platform/ids.js';
import { twoWorkspacesWithTags } from '../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../test/postgres.js';
import { createDestinationRepo } from '../modules/posts/infra/destination-repo.js';
import { createPostRepo } from '../modules/posts/infra/post-repo.js';
import { postIntegrity } from './helpers.js';

const T0 = new Date('2026-11-03T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

/** Run-book queries of sad.md §7 (T16): each finds exactly what it is meant to find, and a clean workspace has none. */
describe('postIntegrity queries (postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let n = 0;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 4 });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function seed() {
    const { a } = await twoWorkspacesWithTags(db);
    const dest = await createDestinationRepo(db).insert(a.workspaceId, {
      id: newId(),
      telegramBotId: 1n,
      chatId: BigInt(-2000000000000 - ++n),
      kind: 'channel',
      title: 'Chat',
      username: null,
      connectedByAccountId: a.ownerAccountId,
      connectedAt: at(0),
      membershipChangedAt: at(0),
    });
    const repo = createPostRepo(db);
    const draft = async () =>
      repo.insertDraft(a.workspaceId, {
        id: newId(),
        destinationId: dest.id,
        text: 'Hello channel',
        silent: false,
        authorAccountId: a.operatorAccountId,
        createdAt: at(1),
      });
    return { a, dest, draft };
  }

  it('a clean workspace has no violations', async () => {
    const { a, draft } = await seed();
    await draft();
    const p = postIntegrity;
    expect(await p.startedLate(db, a.workspaceId)).toEqual([]);
    expect(await p.twoSendsOfOnePost(db, a.workspaceId)).toEqual([]);
    expect(await p.sendingPastExpiry(db, a.workspaceId, at(3600))).toEqual([]);
    expect(await p.foreignDestination(db, a.workspaceId)).toEqual([]);
    expect(await p.overDailyCap(db, a.workspaceId)).toEqual([]);
  });

  it('finds a send that started more than 15 minutes after its time, and a stale sending', async () => {
    const { a, draft } = await seed();
    const late = await draft();
    const stale = await draft();
    for (const [id, started] of [
      [late.id, at(16 * 60 + 1)],
      [stale.id, at(5)],
    ] as const) {
      await sql`update posts set state = 'sending', schedule_kind = 'time', scheduled_for = ${at(0)},
        scheduled_by_account_id = ${a.ownerAccountId}, sending_started_at = ${started}
        where id = ${id}`.execute(db);
    }
    const lateRows = await postIntegrity.startedLate(db, a.workspaceId);
    expect(lateRows.map((r) => r.id)).toEqual([late.id]);
    const staleRows = await postIntegrity.sendingPastExpiry(db, a.workspaceId, at(3600));
    expect(staleRows.map((r) => r.id).sort()).toEqual([late.id, stale.id].sort());
  });
});
