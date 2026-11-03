import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { newId } from '../../../platform/ids.js';
import { createLaunchReadiness } from '../../bots/app/launch-readiness.js';
import { createBotRepo } from '../../bots/infra/bot-repo.js';
import { createTokenCipher } from '../../bots/infra/token-cipher.js';
import { createContactAudiences } from '../../contacts/app/audiences.js';
import { createAudienceQuery } from '../../contacts/infra/audience-query.js';
import { createTagRepo } from '../../contacts/infra/tag-repo.js';
import { testBotKey } from '../../../test/fixtures/bots.js';
import { insertBroadcast, twoWorkspacesWithBroadcasts } from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createBroadcastSignals } from '../infra/signals.js';
import { createBroadcastGroup, type BroadcastGroup } from './group.js';

/** Synthetic Telegram user ids, far from the fixtures' range. */
let nextTelegramUserId = 5_000_000_000;

describe('broadcast group use cases (Postgres; AC-03, AC-04, AC-05, AC-08)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let group: BroadcastGroup;
  let groups: ReturnType<typeof createGroupRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url));
    const { db } = deps;
    const audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    const broadcasts = createBroadcastRepo(db);
    groups = createGroupRepo(db);
    group = createBroadcastGroup({
      transaction: (fn) => db.transaction().execute(fn),
      broadcasts,
      groups,
      contacts: {
        resolveTags: async (workspaceId, ids) =>
          (await deps.tagAdmin.listTags(workspaceId)).items
            .filter((t) => ids.includes(t.id))
            .map((t) => ({ id: t.id, name: t.name })),
        matchingContactIds: audiences.matchingContactIds,
        contactCards: audiences.contactCards,
      },
      bots: createLaunchReadiness({ bots: createBotRepo(db, createTokenCipher(testBotKey)) }),
      workspaces: { displayNames: deps.workspaceAccess.displayNames },
      signals: createBroadcastSignals(),
      views: {
        draftView: async (_ws, id) => ({ id }) as never,
      },
      clock: deps.clock,
    });
  }, 120_000);

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  async function groupDraft(w: { workspaceId: string; operatorAccountId: string }) {
    return insertBroadcast(deps.db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.operatorAccountId,
      name: 'Wholesale catch-up',
      audience: { kind: 'group' },
    });
  }

  /** Inserts `n` contacts in chunks; returns their ids. */
  async function manyContacts(workspaceId: string, n: number) {
    const ids: string[] = [];
    for (let start = 0; start < n; start += 2000) {
      const rows = Array.from({ length: Math.min(2000, n - start) }, () => ({
        id: newId(),
        workspace_id: workspaceId,
        telegram_user_id: String(nextTelegramUserId++),
        first_name: 'Bulk',
        last_name: null,
        username: null,
        language_code: 'en',
        profile_seen_at: new Date('2026-10-01'),
        created_at: new Date('2026-10-01'),
      }));
      await deps.db.insertInto('contacts').values(rows).execute();
      ids.push(...rows.map((r) => r.id));
    }
    return ids;
  }

  it('AC-04: one in the group, "Wholesale" + "kyiv" matches 14, 13 are added, the group holds 14', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const { db } = deps;
    const id = await groupDraft(a);
    const wholesale = await insertTag(db, {
      workspaceId: a.workspaceId,
      createdByAccountId: a.ownerAccountId,
      name: 'Wholesale',
    });
    const kyiv: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      const c = await insertContact(db, { workspaceId: a.workspaceId, firstName: `Kyiv ${i}` });
      await insertContactTag(db, {
        workspaceId: a.workspaceId,
        contactId: c,
        tagId: wholesale,
        addedByAccountId: a.operatorAccountId,
        history: false,
      });
      kyiv.push(c);
    }
    const lviv = await insertContact(db, { workspaceId: a.workspaceId, firstName: 'Lviv' });
    await insertContactTag(db, {
      workspaceId: a.workspaceId,
      contactId: lviv,
      tagId: wholesale,
      addedByAccountId: a.operatorAccountId,
      history: false,
    });
    expect(await group.addContact(a.workspaceId, a.operatorAccountId, id, kyiv[0]!)).toMatchObject({
      outcome: 'added',
      group_size: 1,
    });
    const filter = { q: 'kyiv', mode: 'any' as const, tagIds: [wholesale] };
    expect(await group.countMatching(a.workspaceId, id, filter)).toMatchObject({
      matching_count: 14,
      already_in_group_count: 1,
      to_add_count: 13,
      can_add: 9_999,
      missing_tag_ids: [],
    });
    expect(
      await group.addMatching(a.workspaceId, a.operatorAccountId, id, {
        q: 'kyiv',
        mode: 'any',
        tag_ids: [wholesale],
        expected_count: 13,
      }),
    ).toEqual({ broadcast_id: id, expected_count: 13, added_count: 13, group_size: 14 });
    const page = await group.groupPage(a.workspaceId, id);
    expect(page.size).toBe(14);
    expect(page.items[0]!.contact.tags).toEqual([{ id: wholesale, name: 'Wholesale' }]);
    expect(page.items[0]!.added_by).toEqual({
      account_id: a.operatorAccountId,
      display_name: 'Test',
    });
    const row = await db
      .selectFrom('broadcasts')
      .select('version')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
    expect(
      await group.removeContact(a.workspaceId, a.operatorAccountId, id, kyiv[3]!),
    ).toMatchObject({ outcome: 'removed', group_size: 13 });
    // Removing changes nothing on the contact.
    const tags = await db
      .selectFrom('contact_tags')
      .select('tag_id')
      .where('contact_id', '=', kyiv[3]!)
      .execute();
    expect(tags).toHaveLength(1);
  });

  it('AC-05: 9 990 in the group and 50 more matching are refused as a whole, 10 can still be added', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const id = await groupDraft(a);
    const inGroup = await manyContacts(a.workspaceId, 9_990);
    await groups.addMany(a.workspaceId, id, inGroup, a.operatorAccountId, new Date());
    const tag = await insertTag(deps.db, {
      workspaceId: a.workspaceId,
      createdByAccountId: a.ownerAccountId,
      name: 'Fifty',
    });
    for (let i = 0; i < 50; i += 1) {
      const c = await insertContact(deps.db, { workspaceId: a.workspaceId });
      await insertContactTag(deps.db, {
        workspaceId: a.workspaceId,
        contactId: c,
        tagId: tag,
        addedByAccountId: a.operatorAccountId,
        history: false,
      });
    }
    await expect(
      group.addMatching(a.workspaceId, a.operatorAccountId, id, {
        mode: 'any',
        tag_ids: [tag],
        expected_count: 50,
      }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_AUDIENCE_TOO_LARGE',
      details: { limit: 10_000, audience_size: 9_990, can_add: 10 },
    });
    expect(await groups.count(a.workspaceId, id)).toBe(9_990);
    // A contact already there is not added twice.
    expect(
      await group.addContact(a.workspaceId, a.operatorAccountId, id, inGroup[0]!),
    ).toMatchObject({ outcome: 'unchanged', group_size: 9_990 });
  }, 60_000);

  it('AC-03: two members adding and removing at once — every change stands, the version stays', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const id = await groupDraft(a);
    const [x, y, z] = await manyContacts(a.workspaceId, 3);
    await group.addContact(a.workspaceId, a.operatorAccountId, id, x!);
    await Promise.all([
      group.removeContact(a.workspaceId, a.operatorAccountId, id, x!),
      group.addContact(a.workspaceId, a.ownerAccountId, id, y!),
      group.addContact(a.workspaceId, a.operatorAccountId, id, z!),
    ]);
    expect((await groups.ids(a.workspaceId, id)).sort()).toEqual([y!, z!].sort());
    const row = await deps.db
      .selectFrom('broadcasts')
      .select('version')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
  });

  it('AC-08: a contact or a broadcast of another workspace is not found; nothing is stored', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(deps.db);
    const id = await groupDraft(a);
    const foreignDraft = await groupDraft(b);
    await expect(
      group.addContact(a.workspaceId, a.operatorAccountId, id, b.taggedContactId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      group.addContact(a.workspaceId, a.operatorAccountId, foreignDraft, a.taggedContactId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(group.groupPage(a.workspaceId, foreignDraft)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await group.removeContact(a.workspaceId, a.operatorAccountId, id, b.taggedContactId),
    ).toMatchObject({ outcome: 'unchanged', group_size: 0 });
    expect(await groups.count(a.workspaceId, id)).toBe(0);
    expect(await groups.count(b.workspaceId, foreignDraft)).toBe(0);
  });
});
