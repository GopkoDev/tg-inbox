import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { createDestinationRepo } from '../infra/destination-repo.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

describe('owner re-check under the membership lock, real workspace access (AC-03)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url));
    db = createDb(database.url);
  }, 120_000);
  afterAll(async () => {
    await deps?.destroy();
    await db?.destroy();
    await database?.stop();
  });

  /** The guard saw an owner; the membership is an operator by the time the lock is taken. */
  async function demoted() {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const { accountId } = await insertMembership(db, ws, { role: 'owner' });
    await insertBot(db, { workspaceId: ws });
    const draft = await deps.posts.drafts.createPost(ws, accountId, { text: 'Spring sale' });
    await sql`UPDATE memberships SET role = 'operator' WHERE account_id = ${accountId}`.execute(db);
    const stale = { accountId, role: 'owner' as const };
    return { ws, stale, draft };
  }

  const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'OWNER_ONLY' });

  it('refuses publish and schedule', async () => {
    const { ws, stale, draft } = await demoted();
    await refused(
      deps.posts.publishing.publishPost(ws, stale, draft.id, { expected_version: draft.version }),
    );
    await refused(
      deps.posts.publishing.schedulePost(ws, stale, draft.id, {
        expected_version: draft.version,
        local_time: '2099-01-01T09:00',
        time_zone: 'Europe/Kyiv',
      }),
    );
  });

  it('refuses delete-from-Telegram', async () => {
    const { ws, stale, draft } = await demoted();
    await refused(deps.posts.deletion.deletePostFromTelegram(ws, stale, draft.id));
  });

  it('refuses removing a destination, setting the time zone and creating a code', async () => {
    const { ws, stale } = await demoted();
    const dest = await createDestinationRepo(db).insert(ws, {
      id: newId(),
      telegramBotId: 4242n,
      chatId: -1001234567890n,
      kind: 'channel',
      title: 'Acme news',
      username: 'acme_news',
      connectedByAccountId: stale.accountId,
      connectedAt: new Date('2026-11-01T00:00:00Z'),
      membershipChangedAt: new Date('2026-11-01T00:00:00Z'),
    });
    await refused(deps.posts.destinations.removeDestination(ws, stale, dest.id));
    await refused(deps.posts.timeZone.setTimeZone(ws, stale, 'Europe/Kyiv'));
    await refused(deps.posts.destinations.createCode(ws, stale));
  });
});
