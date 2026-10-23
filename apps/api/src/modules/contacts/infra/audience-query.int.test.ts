import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactAudiences, type ContactAudiences } from '../app/audiences.js';
import { createAudienceQuery } from './audience-query.js';
import { createContactListQuery } from './contact-list-query.js';
import { createTagRepo } from './tag-repo.js';

const BOT = 9001n;
const OTHER_BOT = 9002n;
const wrote = new Date('2026-09-01T10:00:00Z');
const blockedAt = new Date('2026-10-20T11:00:00Z');

/**
 * The AC-01 seed: 142 contacts; "VIP" on c0–c39, "Kyiv" on c20–c139, "Staff" on c0, c1 (both VIP)
 * and c140; c2 and c3 (VIP, not Staff) blocked bot 9001; c141 carries no tag and never wrote.
 * Everyone else wrote to bot 9001.
 */
async function seed(db: Db, telegramUserBase: bigint) {
  const workspaceId = await insertWorkspace(db);
  const { accountId } = await insertMembership(db, workspaceId, { role: 'owner' });
  const tag = (name: string) => insertTag(db, { workspaceId, createdByAccountId: accountId, name });
  const vip = await tag('VIP');
  const kyiv = await tag('Kyiv');
  const staff = await tag('Staff');
  const c: string[] = [];
  for (let i = 0; i < 142; i++) {
    c.push(
      await insertContact(db, {
        workspaceId,
        telegramUserId: telegramUserBase + BigInt(i),
        firstName: i === 5 ? 'Olena' : 'Test User',
        ...(i < 141 && { reachForBot: BOT, firstWroteAt: wrote, lastWroteAt: wrote }),
      }),
    );
  }
  const link = (contactId: string, tagId: string) =>
    insertContactTag(db, {
      workspaceId,
      contactId,
      tagId,
      addedByAccountId: accountId,
      history: false,
    });
  for (let i = 0; i < 40; i++) await link(c[i]!, vip);
  for (let i = 20; i < 140; i++) await link(c[i]!, kyiv);
  for (const i of [0, 1, 140]) await link(c[i]!, staff);
  for (const i of [2, 3]) {
    await db
      .updateTable('contact_bot_reach')
      .set({ blocked_at: blockedAt, changed_at: blockedAt })
      .where('workspace_id', '=', workspaceId)
      .where('contact_id', '=', c[i]!)
      .execute();
  }
  return { workspaceId, accountId, vip, kyiv, staff, c };
}

describe('contacts audience evaluation (ADR-0004)', () => {
  let database: TestDatabase;
  let db: Db;
  let audiences: ContactAudiences;
  let a: Awaited<ReturnType<typeof seed>>;
  let b: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    a = await seed(db, 700000n);
    // Workspace B: the same seed, the same Telegram bot id — never visible from A.
    b = await seed(db, 710000n);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const vipNotStaff = () =>
    ({ kind: 'tags', mode: 'any', include: [a.vip], exclude: [a.staff] }) as const;
  const audienceIds = () => a.c.slice(2, 40); // VIP minus the two Staff contacts

  describe('audienceBreakdown (AC-01, AC-10, AC-14)', () => {
    it('"any of VIP, leaving out Staff" is 38: 2 blocked, 0 never wrote, 36 reachable', async () => {
      expect(await audiences.audienceBreakdown(a.workspaceId, vipNotStaff(), BOT)).toEqual({
        audienceSize: 38,
        reach: { blocked: 2, neverWrote: 0, reachable: 36 },
      });
    });

    it('all, none and no-tag modes match the Contacts list exactly', async () => {
      const list = createContactListQuery(db);
      const cases = [
        { mode: 'all', tagIds: [a.vip, a.kyiv] },
        { mode: 'all', tagIds: [] },
        { mode: 'any', tagIds: [] },
        { mode: 'any', tagIds: [a.vip, a.staff] },
        { mode: 'none', tagIds: [] },
      ] as const;
      for (const f of cases) {
        const expected = await list.matchingCount(a.workspaceId, { q: null, ...f });
        const got = await audiences.audienceBreakdown(
          a.workspaceId,
          { kind: 'tags', mode: f.mode, include: f.tagIds, exclude: [] },
          BOT,
        );
        expect(got.audienceSize, JSON.stringify(f)).toBe(expected);
      }
      const none = await audiences.audienceBreakdown(
        a.workspaceId,
        { kind: 'tags', mode: 'none', include: [], exclude: [] },
        BOT,
      );
      expect(none).toEqual({ audienceSize: 1, reach: { blocked: 0, neverWrote: 1, reachable: 0 } });
    });

    it('a left-out tag removes the contact in every mode', async () => {
      const all = await audiences.audienceBreakdown(
        a.workspaceId,
        { kind: 'tags', mode: 'any', include: [], exclude: [a.staff] },
        BOT,
      );
      expect(all.audienceSize).toBe(142 - 3);
    });

    it("a group's ids give the same partition", async () => {
      expect(
        await audiences.audienceBreakdown(
          a.workspaceId,
          { kind: 'ids', contactIds: audienceIds() },
          BOT,
        ),
      ).toEqual({ audienceSize: 38, reach: { blocked: 2, neverWrote: 0, reachable: 36 } });
    });

    it('with no bot only the audience size is answered', async () => {
      expect(await audiences.audienceBreakdown(a.workspaceId, vipNotStaff(), null)).toEqual({
        audienceSize: 38,
        reach: null,
      });
    });

    it('marks of another Telegram bot do not apply; those of the current one do', async () => {
      expect(await audiences.audienceBreakdown(a.workspaceId, vipNotStaff(), OTHER_BOT)).toEqual({
        audienceSize: 38,
        reach: { blocked: 0, neverWrote: 38, reachable: 0 },
      });
    });

    it('a contact blocked through the bot but who never wrote through it counts as blocked', async () => {
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      await insertReach(db, {
        workspaceId: a.workspaceId,
        contactId,
        telegramBotId: BOT,
        blockedAt,
      });
      expect(
        await audiences.audienceBreakdown(
          a.workspaceId,
          { kind: 'ids', contactIds: [contactId] },
          BOT,
        ),
      ).toEqual({ audienceSize: 1, reach: { blocked: 1, neverWrote: 0, reachable: 0 } });
    });

    it("never counts another workspace's contacts given by id", async () => {
      expect(
        await audiences.audienceBreakdown(
          a.workspaceId,
          { kind: 'ids', contactIds: [...audienceIds(), ...b.c.slice(2, 40)] },
          BOT,
        ),
      ).toEqual({ audienceSize: 38, reach: { blocked: 2, neverWrote: 0, reachable: 36 } });
    });
  });

  describe('reachableContacts (AC-06, AC-05)', () => {
    it('is the reachable set sorted by contact id with Telegram user ids', async () => {
      const reachable = await audiences.reachableContacts(a.workspaceId, vipNotStaff(), BOT);
      const expectedIds = a.c.slice(4, 40).sort();
      expect(reachable.map((r) => r.id)).toEqual(expectedIds);
      const i = a.c.indexOf(expectedIds[0]!);
      expect(reachable[0]!.telegramUserId).toBe(700000n + BigInt(i));
      expect(
        await audiences.reachableContacts(
          a.workspaceId,
          { kind: 'ids', contactIds: [...audienceIds(), ...b.c] },
          BOT,
        ),
      ).toEqual(reachable);
    });

    it('stops at the limit (10 001 by default, so the caller can refuse over 10 000)', async () => {
      const three = await audiences.reachableContacts(a.workspaceId, vipNotStaff(), BOT, 3);
      expect(three.map((r) => r.id)).toEqual(a.c.slice(4, 40).sort().slice(0, 3));
    });

    it('is empty for another Telegram bot', async () => {
      expect(await audiences.reachableContacts(a.workspaceId, vipNotStaff(), OTHER_BOT)).toEqual(
        [],
      );
    });
  });

  describe('existingTags (AC-01)', () => {
    it('drops ids that are not (or no longer) tags of the workspace', async () => {
      const gone = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.accountId,
        name: 'Gone',
      });
      await db.deleteFrom('tags').where('id', '=', gone).execute();
      expect(
        (await audiences.existingTags(a.workspaceId, [a.vip, gone, b.vip, a.staff])).sort(),
      ).toEqual([a.vip, a.staff].sort());
    });
  });

  describe('matchingContactIds (AC-04)', () => {
    it('equals the Contacts list matching set for a search and a filter', async () => {
      expect(
        await audiences.matchingContactIds(a.workspaceId, {
          q: '  @olena ',
          mode: 'any',
          tagIds: [a.vip],
        }),
      ).toEqual([a.c[5]]);
      const kyiv = await audiences.matchingContactIds(a.workspaceId, {
        mode: 'any',
        tagIds: [a.kyiv],
      });
      expect(kyiv).toEqual(a.c.slice(20, 140).sort());
      expect(kyiv).not.toContain(b.c[20]);
    });
  });

  describe('contactCards and isBlocked (AC-04, AC-11, AC-14)', () => {
    it('answers cards with tags in tag-list order and the blocked mark of the given bot', async () => {
      const cards = await audiences.contactCards(a.workspaceId, [a.c[2]!, a.c[0]!, b.c[2]!], BOT);
      expect(cards).toEqual([
        {
          id: a.c[2],
          firstName: 'Test User',
          lastName: null,
          username: null,
          tags: [{ id: a.vip, name: 'VIP' }],
          blockedSince: blockedAt,
        },
        {
          id: a.c[0],
          firstName: 'Test User',
          lastName: null,
          username: null,
          tags: [
            { id: a.staff, name: 'Staff' },
            { id: a.vip, name: 'VIP' },
          ],
          blockedSince: null,
        },
      ]);
      const noBot = await audiences.contactCards(a.workspaceId, [a.c[2]!], null);
      expect(noBot[0]!.blockedSince).toBeNull();
    });

    it('isBlocked reads the mark of one contact for one bot, in its workspace only', async () => {
      expect(await audiences.isBlocked(a.workspaceId, a.c[2]!, BOT)).toBe(true);
      expect(await audiences.isBlocked(a.workspaceId, a.c[4]!, BOT)).toBe(false);
      expect(await audiences.isBlocked(a.workspaceId, a.c[2]!, OTHER_BOT)).toBe(false);
      expect(await audiences.isBlocked(a.workspaceId, b.c[2]!, BOT)).toBe(false);
    });
  });
});
