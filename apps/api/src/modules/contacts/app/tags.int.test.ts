import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertContactTag,
  insertTag,
  insertTagHistory,
  twoWorkspacesWithTags,
} from '../../../test/fixtures/tags.js';
import { insertMembership } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactRepo } from '../infra/contact-repo.js';
import { createContactTagRepo } from '../infra/contact-tag-repo.js';
import { createTagHistoryRepo } from '../infra/tag-history-repo.js';
import { createTagRepo } from '../infra/tag-repo.js';
import type { TagSignals } from './ports.js';
import { createTagWrites } from './tags.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('member tag writes (postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let writes: ReturnType<typeof createTagWrites>;
  let signalLog: string[];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    signalLog = [];
    const signals: TagSignals = {
      async contactChanged(_tx, ws, contactId) {
        signalLog.push(`contact.changed:${ws}:${contactId}`);
      },
      async tagsChanged(_tx, ws) {
        signalLog.push(`tags.changed:${ws}`);
      },
    };
    writes = createTagWrites({
      transaction: (fn) => db.transaction().execute((tx) => fn(tx as unknown as Db)),
      contacts: createContactRepo(db),
      tags: createTagRepo(db),
      contactTags: createContactTagRepo(db),
      tagHistory: createTagHistoryRepo(db),
      signals,
      workspaces: { displayNames: async (_ws, ids) => new Map(ids.map((id) => [id, 'Member'])) },
      clock: fixedClock(NOW),
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const world = async () => {
    const all = await twoWorkspacesWithTags(db);
    return all;
  };
  const tagCount = async (workspaceId: string) =>
    Number(
      (
        await db
          .selectFrom('tags')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const entries = (workspaceId: string, contactId: string) =>
    db
      .selectFrom('contact_tag_history')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('contact_id', '=', contactId)
      .orderBy('created_at')
      .execute();
  const linkCount = async (workspaceId: string, contactId: string) =>
    Number(
      (
        await db
          .selectFrom('contact_tags')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .where('contact_id', '=', contactId)
          .executeTakeFirstOrThrow()
      ).n,
    );

  describe('addContactTag (AC-06 .. AC-08, AC-14, AC-15)', () => {
    it('two members creating "Kyiv" / " kyiv " at once end with one tag on both contacts (AC-08)', async () => {
      const { a } = await world();
      const [c1, c2] = a.contactIds as [string, string];
      const results = await Promise.all([
        writes.addContactTag(a.workspaceId, a.ownerAccountId, c1, { name: 'Kyiv' }, 'inbox'),
        writes.addContactTag(a.workspaceId, a.operatorAccountId, c2, { name: ' kyiv ' }, 'profile'),
      ]);
      expect(await tagCount(a.workspaceId)).toBe(2); // VIP + one Kyiv
      expect(results[0].tag.id).toBe(results[1].tag.id);
      expect(results.filter((r) => r.tag_created)).toHaveLength(1);
      expect(await linkCount(a.workspaceId, c1)).toBeGreaterThanOrEqual(1);
    });

    it('concurrent creates at 99 tags end at exactly 100 (AC-08)', async () => {
      const { a } = await world();
      for (let i = 0; i < 98; i++) {
        await insertTag(db, { workspaceId: a.workspaceId, createdByAccountId: a.ownerAccountId });
      }
      expect(await tagCount(a.workspaceId)).toBe(99);
      const cs = [
        a.contactIds[0]!,
        a.contactIds[1]!,
        await insertContact(db, { workspaceId: a.workspaceId }),
      ];
      const settled = await Promise.allSettled(
        cs.map((c, i) =>
          writes.addContactTag(a.workspaceId, a.ownerAccountId, c, { name: `fresh ${i}` }, 'inbox'),
        ),
      );
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(
        settled.filter(
          (s) =>
            s.status === 'rejected' && (s.reason as { code: string }).code === 'TAG_LIMIT_REACHED',
        ),
      ).toHaveLength(2);
      expect(await tagCount(a.workspaceId)).toBe(100);
    });

    it('concurrent adds at 19 carried end at exactly 20, and a 21st with a new name creates no tag (AC-08)', async () => {
      const { a } = await world();
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      for (let i = 0; i < 19; i++) {
        const tagId = await insertTag(db, {
          workspaceId: a.workspaceId,
          createdByAccountId: a.ownerAccountId,
        });
        await insertContactTag(db, {
          workspaceId: a.workspaceId,
          contactId,
          tagId,
          addedByAccountId: a.operatorAccountId,
          addedAt: ago(3600),
        });
      }
      const x = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
      });
      const y = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
      });
      const settled = await Promise.allSettled([
        writes.addContactTag(a.workspaceId, a.ownerAccountId, contactId, { tagId: x }, 'inbox'),
        writes.addContactTag(a.workspaceId, a.operatorAccountId, contactId, { tagId: y }, 'inbox'),
      ]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(
        settled.find(
          (s) => s.status === 'rejected' && s.reason.code === 'CONTACT_TAG_LIMIT_REACHED',
        ),
      ).toBeDefined();
      expect(await linkCount(a.workspaceId, contactId)).toBe(20);

      const before = await tagCount(a.workspaceId);
      await expect(
        writes.addContactTag(
          a.workspaceId,
          a.ownerAccountId,
          contactId,
          { name: 'Brand new' },
          'inbox',
        ),
      ).rejects.toMatchObject({ code: 'CONTACT_TAG_LIMIT_REACHED' });
      expect(await tagCount(a.workspaceId)).toBe(before);
    });

    it('a tag deleted in a committed transaction answers TAG_NOT_FOUND; a foreign tag too (AC-12, AC-14)', async () => {
      const { a, b } = await world();
      const tagId = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
      });
      await db.deleteFrom('tags').where('id', '=', tagId).execute();
      const c = a.otherContactId;
      await expect(
        writes.addContactTag(a.workspaceId, a.ownerAccountId, c, { tagId }, 'inbox'),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
      await expect(
        writes.addContactTag(a.workspaceId, a.ownerAccountId, c, { tagId: b.tagId }, 'inbox'),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
      expect(await entries(a.workspaceId, c)).toHaveLength(0);
    });

    it('a contact of another workspace is NOT_FOUND and creates no tag (AC-12)', async () => {
      const { a, b } = await world();
      const before = await tagCount(a.workspaceId);
      await expect(
        writes.addContactTag(
          a.workspaceId,
          a.ownerAccountId,
          b.otherContactId,
          { name: 'Zed' },
          'inbox',
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await tagCount(a.workspaceId)).toBe(before);
    });

    it('adds a tag renamed after the pick under its new name and creates no tag of the old name (AC-14)', async () => {
      const { a } = await world();
      const tagId = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Old promo',
      });
      await db
        .updateTable('tags')
        .set({ name: 'New promo', name_key: 'new promo' })
        .where('id', '=', tagId)
        .execute();
      const before = await tagCount(a.workspaceId);
      const res = await writes.addContactTag(
        a.workspaceId,
        a.ownerAccountId,
        a.otherContactId,
        { tagId },
        'inbox',
      );
      expect(res.tag).toEqual({ id: tagId, name: 'New promo' });
      expect(await tagCount(a.workspaceId)).toBe(before);
      const last = (await entries(a.workspaceId, a.otherContactId)).at(-1);
      expect(last).toMatchObject({
        kind: 'added',
        tag_name: 'New promo',
        actor_account_id: a.ownerAccountId,
      });
    });

    it('writes one added entry and publishes contact.changed, plus tags.changed for a created tag', async () => {
      const { a } = await world();
      const c = await insertContact(db, { workspaceId: a.workspaceId });
      signalLog.length = 0;
      await writes.addContactTag(
        a.workspaceId,
        a.operatorAccountId,
        c,
        { name: 'Signal' },
        'profile',
      );
      expect(signalLog).toEqual([
        `contact.changed:${a.workspaceId}:${c}`,
        `tags.changed:${a.workspaceId}`,
      ]);
      expect(await entries(a.workspaceId, c)).toHaveLength(1);
      // a no-op and a refusal publish nothing
      signalLog.length = 0;
      await writes.addContactTag(
        a.workspaceId,
        a.operatorAccountId,
        c,
        { name: 'signal' },
        'profile',
      );
      await expect(
        writes.addContactTag(a.workspaceId, a.operatorAccountId, c, { name: '' }, 'profile'),
      ).rejects.toBeDefined();
      expect(signalLog).toEqual([]);
      expect(await entries(a.workspaceId, c)).toHaveLength(1);
    });

    it('refuses the 61st change; an unchanged add does not count; create + add counts one; another workspace does not count (AC-15)', async () => {
      const { a, b } = await world();
      const member = a.operatorAccountId;
      const c = await insertContact(db, { workspaceId: a.workspaceId });
      const other = await insertContact(db, { workspaceId: b.workspaceId });
      // the same account is also a member of workspace B, where it has made many changes
      await insertMembership(db, b.workspaceId, { accountId: member, role: 'operator' });
      // 57 recorded entries in the window (the oldest 50 s ago), more in the other workspace.
      const filler = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: member,
      });
      for (let i = 0; i < 57; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: filler,
          tagName: 'x',
          kind: i % 2 ? 'removed' : 'added',
          actorAccountId: member,
          createdAt: ago(i === 0 ? 50 : 5),
        });
      }
      for (let i = 0; i < 70; i++) {
        await insertTagHistory(db, {
          workspaceId: b.workspaceId,
          contactId: other,
          tagId: b.tagId,
          tagName: 'VIP',
          kind: 'added',
          actorAccountId: member,
          createdAt: ago(5),
        });
      }
      for (let i = 0; i < 30; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: filler,
          tagName: 'x',
          kind: 'merged',
          mergedInto: { tagId: a.tagId, name: 'VIP' },
          actorAccountId: member,
          createdAt: ago(5),
        });
      }
      // create + add = 1 (58th)
      await writes.addContactTag(a.workspaceId, member, c, { name: 'Fresh' }, 'inbox');
      // unchanged: allowed, not counted
      expect(
        (await writes.addContactTag(a.workspaceId, member, c, { name: 'fresh' }, 'inbox')).outcome,
      ).toBe('unchanged');
      // 59th, 60th recorded
      const t1 = await insertTag(db, { workspaceId: a.workspaceId, createdByAccountId: member });
      const t2 = await insertTag(db, { workspaceId: a.workspaceId, createdByAccountId: member });
      const t3 = await insertTag(db, { workspaceId: a.workspaceId, createdByAccountId: member });
      await writes.addContactTag(a.workspaceId, member, c, { tagId: t1 }, 'inbox');
      await writes.addContactTag(a.workspaceId, member, c, { tagId: t2 }, 'inbox');
      // 61st refused with the time the oldest leaves the window
      await expect(
        writes.addContactTag(a.workspaceId, member, c, { tagId: t3 }, 'inbox'),
      ).rejects.toMatchObject({
        code: 'TAG_CHANGE_LIMIT_REACHED',
        statusCode: 429,
        headers: { 'Retry-After': '10' },
        details: { retry_at: new Date(ago(50).getTime() + 60_000).toISOString() },
      });
      expect(await linkCount(a.workspaceId, c)).toBe(3);
      // another member of the same workspace is not limited
      await writes.addContactTag(a.workspaceId, a.ownerAccountId, c, { tagId: t3 }, 'inbox');
    });
  });

  describe('removeContactTag (AC-06, AC-12, AC-15)', () => {
    it('two members removing at once leave one removed entry and one answer unchanged', async () => {
      const { a } = await world();
      const c = a.taggedContactId;
      const results = await Promise.all([
        writes.removeContactTag(a.workspaceId, a.ownerAccountId, c, a.tagId, 'inbox'),
        writes.removeContactTag(a.workspaceId, a.operatorAccountId, c, a.tagId, 'profile'),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual(['recorded', 'unchanged']);
      const removed = (await entries(a.workspaceId, c)).filter((e) => e.kind === 'removed');
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({ tag_name: 'VIP' });
      expect(await linkCount(a.workspaceId, c)).toBe(0);
    });

    it('a foreign tag id answers unchanged and records nothing (AC-12)', async () => {
      const { a, b } = await world();
      signalLog.length = 0;
      const res = await writes.removeContactTag(
        a.workspaceId,
        a.ownerAccountId,
        a.taggedContactId,
        b.tagId,
        'inbox',
      );
      expect(res.outcome).toBe('unchanged');
      expect(res.tags.map((t) => t.id)).toEqual([a.tagId]);
      expect(await linkCount(b.workspaceId, b.taggedContactId)).toBe(1);
      expect(signalLog).toEqual([]);
    });

    it('a recorded removal publishes contact.changed, and removals share the 60 with adds (AC-15)', async () => {
      const { a } = await world();
      const member = a.operatorAccountId;
      const filler = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: member,
      });
      for (let i = 0; i < 60; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: filler,
          tagName: 'x',
          kind: i % 2 ? 'removed' : 'added',
          actorAccountId: member,
          createdAt: ago(20),
        });
      }
      await expect(
        writes.removeContactTag(a.workspaceId, member, a.taggedContactId, a.tagId, 'inbox'),
      ).rejects.toMatchObject({
        code: 'TAG_CHANGE_LIMIT_REACHED',
        headers: { 'Retry-After': '40' },
      });
      expect(await linkCount(a.workspaceId, a.taggedContactId)).toBe(1);
      signalLog.length = 0;
      await writes.removeContactTag(
        a.workspaceId,
        a.ownerAccountId,
        a.taggedContactId,
        a.tagId,
        'inbox',
      );
      expect(signalLog).toEqual([`contact.changed:${a.workspaceId}:${a.taggedContactId}`]);
    });
  });
});
