import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace, T0 } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

describe('contact reads through buildDeps (contacts -> workspaces edge)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), {
      clock: fixedClock(new Date('2026-10-19T10:00:00Z')),
    });
  });
  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  it('names a deactivated adder in the profile and the history, and refuses a foreign contact', async () => {
    const { db } = deps;
    const ws = await insertWorkspace(db);
    const other = await insertWorkspace(db);
    const owner = await insertMembership(db, ws, { role: 'owner' });
    const gone = await insertMembership(db, ws, { state: 'deactivated' });
    const { contactId } = await db.transaction().execute((tx) =>
      deps.contacts.upsertFromProfile(
        ws,
        {
          telegramUserId: 777001n,
          firstName: 'Test User',
          lastName: null,
          username: null,
          languageCode: 'en',
        },
        T0,
        9001n,
        tx,
      ),
    );
    const foreign = await db.transaction().execute((tx) =>
      deps.contacts.upsertFromProfile(
        other,
        {
          telegramUserId: 777001n,
          firstName: 'Test User',
          lastName: null,
          username: null,
          languageCode: 'en',
        },
        T0,
        9001n,
        tx,
      ),
    );
    const tagId = await insertTag(db, {
      workspaceId: ws,
      createdByAccountId: owner.accountId,
      name: 'VIP',
    });
    await insertContactTag(db, {
      workspaceId: ws,
      contactId,
      tagId,
      addedByAccountId: gone.accountId,
    });

    const profile = await deps.contactReads.getContact(ws, contactId);
    expect(profile.tags).toEqual([
      {
        id: tagId,
        name: 'VIP',
        added_by: { account_id: gone.accountId, display_name: 'Test' },
        added_at: T0.toISOString(),
      },
    ]);
    const history = await deps.contactReads.listTagHistory(ws, contactId);
    expect(history.items.map((e) => [e.kind, e.actor.display_name])).toEqual([['added', 'Test']]);
    const list = await deps.contactReads.listContacts(ws, { mode: 'any', tagIds: [tagId] });
    expect(list.items.map((i) => i.id)).toEqual([contactId]);
    expect(list.items[0]!.tags).toEqual([{ id: tagId, name: 'VIP' }]);
    expect(list.matching_count).toBe(1);
    await expect(deps.contactReads.getContact(ws, foreign.contactId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
