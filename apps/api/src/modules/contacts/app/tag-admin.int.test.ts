import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactRepo } from '../infra/contact-repo.js';
import { createContactTagRepo } from '../infra/contact-tag-repo.js';
import { createTagHistoryRepo } from '../infra/tag-history-repo.js';
import { createTagRepo } from '../infra/tag-repo.js';
import type { TagSignals } from './ports.js';
import { createTagAdmin } from './tag-admin.js';
import { createTagWrites } from './tags.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('owner tag management (postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let admin: ReturnType<typeof createTagAdmin>;
  let writes: ReturnType<typeof createTagWrites>;
  let signalLog: string[];
  let logs: { obj: Record<string, unknown>; msg: string }[];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    signalLog = [];
    logs = [];
    const signals: TagSignals = {
      async contactChanged(_tx, ws, contactId) {
        signalLog.push(`contact.changed:${ws}:${contactId}`);
      },
      async tagsChanged(_tx, ws) {
        signalLog.push(`tags.changed:${ws}`);
      },
    };
    const transaction = <T>(fn: (tx: Db) => Promise<T>) =>
      db.transaction().execute((tx) => fn(tx as unknown as Db));
    const tags = createTagRepo(db);
    const contactTags = createContactTagRepo(db);
    const tagHistory = createTagHistoryRepo(db);
    const clock = fixedClock(NOW);
    admin = createTagAdmin({
      transaction,
      tags,
      contactTags,
      tagHistory,
      signals,
      clock,
      logger: { info: (obj, msg) => logs.push({ obj: obj as Record<string, unknown>, msg }) },
    });
    writes = createTagWrites({
      transaction,
      contacts: createContactRepo(db),
      tags,
      contactTags,
      tagHistory,
      signals,
      workspaces: { displayNames: async (_ws, ids) => new Map(ids.map((id) => [id, 'Member'])) },
      clock,
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  type Ws = Awaited<ReturnType<typeof twoWorkspacesWithTags>>['a'];
  const names = async (workspaceId: string) =>
    (await db.selectFrom('tags').select('name').where('workspace_id', '=', workspaceId).execute())
      .map((r) => r.name)
      .sort();
  const links = (workspaceId: string, tagId: string) =>
    db
      .selectFrom('contact_tags')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('tag_id', '=', tagId)
      .execute();
  const history = (workspaceId: string, kind?: string) => {
    let q = db
      .selectFrom('contact_tag_history')
      .selectAll()
      .where('workspace_id', '=', workspaceId);
    if (kind) q = q.where('kind', '=', kind as 'merged');
    return q.execute();
  };
  const contacts = (ws: Ws, n: number) =>
    Promise.all(
      Array.from({ length: n }, () => insertContact(db, { workspaceId: ws.workspaceId })),
    );
  const carry = async (ws: Ws, contactIds: string[], tagId: string, by: string, when: Date) => {
    for (const contactId of contactIds) {
      await insertContactTag(db, {
        workspaceId: ws.workspaceId,
        contactId,
        tagId,
        addedByAccountId: by,
        addedAt: when,
      });
    }
  };

  describe('listTags and rename (AC-09, AC-04, AC-12)', () => {
    it('lists the workspace tags with counts, zero counts included, none of another workspace', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const empty = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Zero',
      });
      const list = await admin.listTags(a.workspaceId);
      expect(list.items).toEqual([
        { id: a.tagId, name: 'VIP', contact_count: 1 },
        { id: empty, name: 'Zero', contact_count: 0 },
      ]);
    });

    it('renames keeping the id and the history, case-only and same-text included; no signal for a no-op', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      signalLog.length = 0;
      const first = await admin.renameTag(a.workspaceId, a.ownerAccountId, a.tagId, {
        name: 'vip',
      });
      expect(first).toMatchObject({ outcome: 'renamed', tag: { id: a.tagId, name: 'vip' } });
      const same = await admin.renameTag(a.workspaceId, a.ownerAccountId, a.tagId, {
        name: ' vip ',
      });
      expect(same.outcome).toBe('unchanged');
      expect(signalLog).toEqual([`tags.changed:${a.workspaceId}`]);
      const old = await history(a.workspaceId);
      expect(old.map((e) => e.tag_name)).toEqual(['VIP']); // written before the rename, still the old name
      expect(await links(a.workspaceId, a.tagId)).toHaveLength(1);
    });

    it('refuses a held name with the holder and its count, an invalid name, and a foreign tag', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const loyal = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Loyal',
      });
      await expect(
        admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, { name: 'vip' }),
      ).rejects.toMatchObject({
        code: 'TAG_NAME_TAKEN',
        details: { tag: { id: a.tagId, name: 'VIP', contact_count: 1 } },
      });
      await expect(
        admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, { name: ' ' }),
      ).rejects.toMatchObject({ code: 'TAG_NAME_INVALID' });
      await expect(
        admin.renameTag(a.workspaceId, a.ownerAccountId, b.tagId, { name: 'Other' }),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
      expect(await names(b.workspaceId)).toEqual(['VIP']);
    });
  });

  describe('the confirmed merge (AC-09)', () => {
    /** VIP on 8 contacts, Loyal on 8 with 2 shared: 14 carry VIP afterwards, 8 get a merged entry. */
    async function seed() {
      const { a } = await twoWorkspacesWithTags(db);
      const vip = a.tagId;
      await db
        .deleteFrom('contact_tag_history')
        .where('workspace_id', '=', a.workspaceId)
        .execute();
      await db.deleteFrom('contact_tags').where('workspace_id', '=', a.workspaceId).execute();
      const loyal = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Loyal',
      });
      const pool = await contacts(a, 14);
      const onVip = pool.slice(0, 8);
      const onLoyal = pool.slice(6, 14); // 6 and 7 carry both
      await carry(a, onVip, vip, a.operatorAccountId, ago(1000));
      await carry(a, onLoyal.slice(0, 2), loyal, a.ownerAccountId, ago(2000)); // earlier than VIP's
      await carry(a, onLoyal.slice(2), loyal, a.ownerAccountId, ago(500));
      return { a, vip, loyal, pool, onVip, onLoyal };
    }

    it('merges set-based: 14 on VIP, adders kept, earlier link wins, one merged entry per carrier', async () => {
      const { a, vip, loyal, onLoyal } = await seed();
      signalLog.length = 0;
      logs.length = 0;
      const res = await admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, {
        name: 'VIP',
        mergeIntoTagId: vip,
      });
      expect(res).toMatchObject({
        outcome: 'merged',
        tag: { id: vip, name: 'VIP', contact_count: 14 },
        merged_tag_id: loyal,
      });
      const rows = await links(a.workspaceId, vip);
      expect(rows).toHaveLength(14);
      const byContact = new Map(rows.map((r) => [r.contact_id, r]));
      // shared contacts keep the earlier of the two links (Loyal's, by the owner)
      for (const c of onLoyal.slice(0, 2)) {
        expect(byContact.get(c)).toMatchObject({
          added_by_account_id: a.ownerAccountId,
          added_at: ago(2000),
        });
      }
      // re-pointed links keep adder and time
      expect(byContact.get(onLoyal[5]!)).toMatchObject({
        added_by_account_id: a.ownerAccountId,
        added_at: ago(500),
      });
      expect(await names(a.workspaceId)).toEqual(['VIP']);
      const merged = await history(a.workspaceId, 'merged');
      expect(merged).toHaveLength(8);
      expect(merged[0]).toMatchObject({
        tag_id: loyal,
        tag_name: 'Loyal',
        merged_into_tag_id: vip,
        merged_into_name: 'VIP',
        actor_account_id: a.ownerAccountId,
        source: 'settings',
      });
      expect(signalLog).toEqual([`tags.changed:${a.workspaceId}`]);
      const line = logs.find((l) => l.msg === 'tag.merged');
      expect(line?.obj).toMatchObject({
        workspaceId: a.workspaceId,
        fromTagId: loyal,
        toTagId: vip,
      });
      expect(JSON.stringify(logs)).not.toMatch(/Loyal/);
    });

    it('answers TAG_MERGE_TARGET_CHANGED when the target was renamed meanwhile and changes nothing', async () => {
      const { a, vip, loyal } = await seed();
      await db
        .updateTable('tags')
        .set({ name: 'Very important', name_key: 'very important' })
        .where('id', '=', vip)
        .execute();
      signalLog.length = 0;
      await expect(
        admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, {
          name: 'VIP',
          mergeIntoTagId: vip,
        }),
      ).rejects.toMatchObject({ code: 'TAG_MERGE_TARGET_CHANGED', details: { name_holder: null } });
      expect(await names(a.workspaceId)).toEqual(['Loyal', 'Very important']);
      expect(await history(a.workspaceId, 'merged')).toHaveLength(0);
      expect(signalLog).toEqual([]);
    });

    it('never deadlocks with a member add of the merged tag or of the target: it lands and is re-pointed, or is TAG_NOT_FOUND', async () => {
      for (let round = 0; round < 6; round++) {
        const { a, vip, loyal, pool } = await seed();
        const fresh = await insertContact(db, { workspaceId: a.workspaceId });
        const target = round % 2 === 0 ? loyal : vip;
        const [merge, add] = await Promise.allSettled([
          admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, {
            name: 'VIP',
            mergeIntoTagId: vip,
          }),
          writes.addContactTag(
            a.workspaceId,
            a.operatorAccountId,
            fresh,
            { tagId: target },
            'inbox',
          ),
          // a second add of the target onto a contact that already carries the merged tag
          writes.addContactTag(
            a.workspaceId,
            a.operatorAccountId,
            pool[10]!,
            { tagId: vip },
            'inbox',
          ),
        ]);
        expect(merge.status).toBe('fulfilled');
        if (add.status === 'rejected') {
          expect(add.reason).toMatchObject({ code: 'TAG_NOT_FOUND' });
          expect(
            await links(a.workspaceId, vip).then((r) => r.some((x) => x.contact_id === fresh)),
          ).toBe(false);
        } else {
          // landed: after the merge the contact carries VIP, with a history trail
          const carried = (await links(a.workspaceId, vip)).some((x) => x.contact_id === fresh);
          expect(carried).toBe(true);
          if (target === loyal) {
            const trail = (await history(a.workspaceId)).filter((e) => e.contact_id === fresh);
            expect(trail.map((e) => e.kind).sort()).toEqual(['added', 'merged']);
          }
        }
        // no link of the merged tag survives
        expect(await links(a.workspaceId, loyal)).toHaveLength(0);
      }
    });

    it('an owner who merged many contacts is not limited afterwards, and a rename never answers 429 (AC-15)', async () => {
      const { a, vip, loyal } = await seed();
      await admin.renameTag(a.workspaceId, a.ownerAccountId, loyal, {
        name: 'VIP',
        mergeIntoTagId: vip,
      });
      const c = await insertContact(db, { workspaceId: a.workspaceId });
      const t = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
      });
      expect(
        (await writes.addContactTag(a.workspaceId, a.ownerAccountId, c, { tagId: t }, 'inbox'))
          .outcome,
      ).toBe('recorded');
      const res = await admin.renameTag(a.workspaceId, a.ownerAccountId, t, { name: 'Renamed' });
      expect(res.outcome).toBe('renamed');
    });
  });

  describe('deleteTag against the confirmed count (AC-09)', () => {
    async function tagOn(n: number) {
      const { a } = await twoWorkspacesWithTags(db);
      const tagId = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Old promo',
      });
      const cs = await contacts(a, n);
      await carry(a, cs, tagId, a.operatorAccountId, ago(100));
      return { a, tagId, cs };
    }

    it('40 confirmed and 40 carried: the tag and links go, one deleted entry each, one tags.changed', async () => {
      const { a, tagId, cs } = await tagOn(40);
      signalLog.length = 0;
      const res = await admin.deleteTag(a.workspaceId, a.ownerAccountId, tagId, 40);
      expect(res).toEqual({ workspace_id: a.workspaceId, tag_id: tagId, removed_from_count: 40 });
      expect(await links(a.workspaceId, tagId)).toHaveLength(0);
      expect(await names(a.workspaceId)).toEqual(['VIP']);
      const deleted = await history(a.workspaceId, 'deleted');
      expect(deleted).toHaveLength(40);
      expect(new Set(deleted.map((e) => e.contact_id))).toEqual(new Set(cs));
      expect(deleted[0]).toMatchObject({
        tag_name: 'Old promo',
        source: 'settings',
        actor_account_id: a.ownerAccountId,
      });
      expect(signalLog).toEqual([`tags.changed:${a.workspaceId}`]);
      // a repeated delete is TAG_NOT_FOUND
      await expect(
        admin.deleteTag(a.workspaceId, a.ownerAccountId, tagId, 40),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
    });

    it('a member add committed after the dialog answers TAG_COUNT_CHANGED with 41 and deletes nothing', async () => {
      const { a, tagId } = await tagOn(40);
      const extra = await insertContact(db, { workspaceId: a.workspaceId });
      await writes.addContactTag(a.workspaceId, a.operatorAccountId, extra, { tagId }, 'inbox');
      signalLog.length = 0;
      await expect(
        admin.deleteTag(a.workspaceId, a.ownerAccountId, tagId, 40),
      ).rejects.toMatchObject({
        code: 'TAG_COUNT_CHANGED',
        details: { tag: { id: tagId, name: 'Old promo', contact_count: 41 } },
      });
      expect(await links(a.workspaceId, tagId)).toHaveLength(41);
      expect(await history(a.workspaceId, 'deleted')).toHaveLength(0);
      expect(await names(a.workspaceId)).toContain('Old promo');
      expect(signalLog).toEqual([]);
    });

    it('a member add racing the delete is refused TAG_NOT_FOUND or counted (then 409): never a link to a gone tag', async () => {
      for (let round = 0; round < 6; round++) {
        const { a, tagId } = await tagOn(3);
        const extra = await insertContact(db, { workspaceId: a.workspaceId });
        const [del, add] = await Promise.allSettled([
          admin.deleteTag(a.workspaceId, a.ownerAccountId, tagId, 3),
          writes.addContactTag(a.workspaceId, a.operatorAccountId, extra, { tagId }, 'inbox'),
        ]);
        if (del.status === 'fulfilled') {
          expect(add.status).toBe('rejected');
          expect((add as PromiseRejectedResult).reason).toMatchObject({ code: 'TAG_NOT_FOUND' });
        } else {
          expect(del.reason).toMatchObject({
            code: 'TAG_COUNT_CHANGED',
            details: { tag: { contact_count: 4 } },
          });
          expect(add.status).toBe('fulfilled');
        }
        const orphan = await db
          .selectFrom('contact_tags')
          .select('tag_id')
          .where('workspace_id', '=', a.workspaceId)
          .where(
            'tag_id',
            'not in',
            db.selectFrom('tags').select('id').where('workspace_id', '=', a.workspaceId),
          )
          .execute();
        expect(orphan).toHaveLength(0);
      }
    });

    it('does not delete a tag of another workspace (AC-12)', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await expect(
        admin.deleteTag(a.workspaceId, a.ownerAccountId, b.tagId, 1),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
      expect(await links(b.workspaceId, b.tagId)).toHaveLength(1);
    });
  });
});
