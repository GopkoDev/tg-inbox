import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ContactPage,
  ContactProfile,
  ContactTagAdded,
  ContactTagLimitReachedError,
  ContactTagRemoved,
  ErrorEnvelope,
  TagChangeLimitReachedError,
  TagCountChangedError,
  TagDeleted,
  TagHistoryPage,
  TagLimitReachedError,
  TagList,
  TagMergeTargetChangedError,
  TagNameInvalidError,
  TagNameTakenError,
  TagNotFoundError,
  TagRenameResult,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertContactTag,
  insertTag,
  insertTagHistory,
  twoWorkspacesWithTags,
} from '../../../test/fixtures/tags.js';
import { insertMembership } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('contacts routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; cookies: { session: string } };
  const signIn = async (accountId: string): Promise<Who> => {
    const session = await insertSession(db, accountId, { createdAt: ago(3600) });
    return { accountId, cookies: { session: session.token } };
  };
  const stranger = async (workspaceId: string, role: 'owner' | 'operator' = 'operator') => {
    const account = await insertAccount(db);
    await insertMembership(db, workspaceId, { accountId: account.id, role });
    return signIn(account.id);
  };

  /** Two workspaces with an owner and an operator each, the first's contacts and VIP. */
  async function world() {
    const { a, b } = await twoWorkspacesWithTags(db);
    return {
      a,
      b,
      owner: await signIn(a.ownerAccountId),
      operator: await signIn(a.operatorAccountId),
    };
  }
  const base = (ws: string) => `/api/workspaces/${ws}`;
  const get = (who: Who | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const post = (who: Who | null, url: string, payload: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const tagNames = async (ws: string) =>
    (await db.selectFrom('tags').select('name').where('workspace_id', '=', ws).execute())
      .map((t) => t.name)
      .sort();

  describe('reads', () => {
    it('lists contacts with the tag filter and answers the contract shape for either role', async () => {
      const { a, owner, operator } = await world();
      for (const who of [owner, operator]) {
        const res = await get(who, `${base(a.workspaceId)}/contacts`);
        expect(res.statusCode).toBe(200);
        const page = ContactPage.parse(res.json());
        expect(page.total_count).toBe(2);
        const filtered = await get(who, `${base(a.workspaceId)}/contacts?mode=any&tag=${a.tagId}`);
        expect(ContactPage.parse(filtered.json()).items.map((i) => i.id)).toEqual([
          a.taggedContactId,
        ]);
      }
      const gone = newId();
      const missing = ContactPage.parse(
        (await get(owner, `${base(a.workspaceId)}/contacts?tag=${gone}&tag=${a.tagId}`)).json(),
      );
      expect(missing.missing_tag_ids).toEqual([gone]);
    });

    it('refuses none with tags, a bad tag id, a bad cursor and an unknown parameter with VALIDATION_ERROR', async () => {
      const { a, owner } = await world();
      const none = await get(owner, `${base(a.workspaceId)}/contacts?mode=none&tag=${a.tagId}`);
      expect(none.statusCode).toBe(400);
      expect(errorOf(none)).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'tag' } });
      const bad = await get(owner, `${base(a.workspaceId)}/contacts?tag=nope`);
      expect(bad.statusCode).toBe(400);
      expect(errorOf(bad)).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'tag' } });
      const cursor = await get(owner, `${base(a.workspaceId)}/contacts?after=not-a-cursor`);
      expect(cursor.statusCode).toBe(400);
      expect(errorOf(cursor).code).toBe('VALIDATION_ERROR');
      expect((await get(owner, `${base(a.workspaceId)}/contacts?bogus=1`)).statusCode).toBe(400);
    });

    it('reads a profile with the adders named, its tag history, and 404s a foreign contact', async () => {
      const { a, b, operator } = await world();
      const profile = await get(operator, `${base(a.workspaceId)}/contacts/${a.taggedContactId}`);
      expect(profile.statusCode, profile.body).toBe(200);
      const dto = ContactProfile.parse(profile.json());
      expect(dto.tags).toHaveLength(1);
      expect(dto.tags[0]?.added_by.account_id).toBe(a.operatorAccountId);
      const history = await get(
        operator,
        `${base(a.workspaceId)}/contacts/${a.taggedContactId}/tag-history`,
      );
      expect(history.statusCode).toBe(200);
      expect(TagHistoryPage.parse(history.json()).items).toHaveLength(1);
      for (const url of [
        `${base(a.workspaceId)}/contacts/${b.taggedContactId}`,
        `${base(a.workspaceId)}/contacts/${b.taggedContactId}/tag-history`,
        `${base(a.workspaceId)}/contacts/${newId()}`,
      ]) {
        const res = await get(operator, url);
        expect(res.statusCode, url).toBe(404);
        expect(errorOf(res).code).toBe('NOT_FOUND');
      }
      const badCursor = await get(
        operator,
        `${base(a.workspaceId)}/contacts/${a.taggedContactId}/tag-history?after=zzz`,
      );
      expect(badCursor.statusCode).toBe(400);
    });

    it('lists tags with counts for an operator too (a member read, AC-11)', async () => {
      const { a, operator } = await world();
      const res = await get(operator, `${base(a.workspaceId)}/tags`);
      expect(res.statusCode).toBe(200);
      expect(TagList.parse(res.json()).items).toEqual([
        { id: a.tagId, name: 'VIP', contact_count: 1 },
      ]);
    });
  });

  describe('addContactTag', () => {
    const url = (ws: string, contact: string) => `${base(ws)}/contacts/${contact}/tags`;

    it('adds by name (creating) and by id for an operator, then answers unchanged', async () => {
      const { a, operator } = await world();
      const created = await post(operator, url(a.workspaceId, a.otherContactId), {
        name: ' Kyiv ',
        source: 'inbox',
      });
      expect(created.statusCode).toBe(200);
      const body = ContactTagAdded.parse(created.json());
      expect(body).toMatchObject({ outcome: 'recorded', tag_created: true, tag: { name: 'Kyiv' } });
      expect(body.tags[0]?.added_by.account_id).toBe(operator.accountId);
      const byId = await post(operator, url(a.workspaceId, a.otherContactId), {
        tag_id: a.tagId,
        source: 'profile',
      });
      expect(ContactTagAdded.parse(byId.json())).toMatchObject({
        outcome: 'recorded',
        tag_created: false,
        tags: [{ name: 'Kyiv' }, { name: 'VIP' }],
      });
      const again = await post(operator, url(a.workspaceId, a.otherContactId), {
        name: 'kyiv',
        source: 'inbox',
      });
      expect(ContactTagAdded.parse(again.json()).outcome).toBe('unchanged');
    });

    it('answers every refusal of the contract', async () => {
      const { a, b, owner, operator } = await world();
      const u = url(a.workspaceId, a.otherContactId);
      const invalid = await post(operator, u, { name: '   ', source: 'inbox' });
      expect(invalid.statusCode).toBe(400);
      expect(TagNameInvalidError.parse(invalid.json()).error.details).toEqual({
        field: 'name',
        min_length: 1,
        max_length: 32,
      });
      const contact404 = await post(operator, url(a.workspaceId, b.otherContactId), {
        name: 'Zed',
        source: 'inbox',
      });
      expect(contact404.statusCode).toBe(404);
      expect(errorOf(contact404).code).toBe('NOT_FOUND');
      const tag404 = await post(operator, u, { tag_id: b.tagId, source: 'inbox' });
      expect(tag404.statusCode).toBe(404);
      expect(TagNotFoundError.parse(tag404.json()).error.details.tag_id).toBe(b.tagId);
      expect(await tagNames(a.workspaceId)).toEqual(['VIP']);

      const badSource = await post(operator, u, { name: 'Zed', source: 'settings' });
      expect(badSource.statusCode).toBe(400);
      expect(errorOf(badSource)).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { field: 'source' },
      });
      const both = await post(operator, u, { name: 'Zed', tag_id: a.tagId, source: 'inbox' });
      expect(both.statusCode).toBe(400);
      expect(errorOf(both).code).toBe('VALIDATION_ERROR');
      const neither = await post(operator, u, { source: 'inbox' });
      expect(neither.statusCode).toBe(400);

      // 21st tag on a contact
      const full = await insertContact(db, { workspaceId: a.workspaceId });
      for (let i = 0; i < 20; i++) {
        await insertContactTag(db, {
          workspaceId: a.workspaceId,
          contactId: full,
          tagId: await insertTag(db, {
            workspaceId: a.workspaceId,
            createdByAccountId: owner.accountId,
          }),
          addedByAccountId: owner.accountId,
          addedAt: ago(7200),
        });
      }
      const contactFull = await post(operator, url(a.workspaceId, full), {
        name: 'One more',
        source: 'inbox',
      });
      expect(contactFull.statusCode).toBe(409);
      expect(ContactTagLimitReachedError.parse(contactFull.json()).error.details.limit).toBe(20);

      // 101st tag
      while ((await tagNames(a.workspaceId)).length < 100) {
        await insertTag(db, { workspaceId: a.workspaceId, createdByAccountId: owner.accountId });
      }
      const wsFull = await post(operator, u, { name: 'The 101st', source: 'inbox' });
      expect(wsFull.statusCode).toBe(409);
      expect(TagLimitReachedError.parse(wsFull.json()).error.details.limit).toBe(100);
    });

    it('answers 429 TAG_CHANGE_LIMIT_REACHED with Retry-After after 60 changes in a minute', async () => {
      const { a, operator } = await world();
      for (let i = 0; i < 60; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: a.tagId,
          tagName: 'VIP',
          kind: 'added',
          actorAccountId: a.operatorAccountId,
          createdAt: ago(i === 0 ? 45 : 5),
        });
      }
      const res = await post(operator, url(a.workspaceId, a.otherContactId), {
        tag_id: a.tagId,
        source: 'inbox',
      });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('15');
      expect(TagChangeLimitReachedError.parse(res.json()).error.details).toEqual({
        limit: 60,
        window_seconds: 60,
        retry_at: ago(45 - 60).toISOString(),
      });
    });
  });

  describe('removeContactTag', () => {
    const url = (ws: string, contact: string, tag: string) =>
      `${base(ws)}/contacts/${contact}/tags/${tag}/remove`;

    it('removes, answers unchanged for a tag not carried or foreign, and 404s a foreign contact', async () => {
      const { a, b, operator } = await world();
      const res = await post(operator, url(a.workspaceId, a.taggedContactId, a.tagId), {
        source: 'profile',
      });
      expect(res.statusCode).toBe(200);
      expect(ContactTagRemoved.parse(res.json())).toMatchObject({ outcome: 'recorded', tags: [] });
      for (const tag of [a.tagId, b.tagId, newId()]) {
        const again = await post(operator, url(a.workspaceId, a.taggedContactId, tag), {
          source: 'inbox',
        });
        expect(ContactTagRemoved.parse(again.json()).outcome).toBe('unchanged');
      }
      const foreign = await post(operator, url(a.workspaceId, b.taggedContactId, b.tagId), {
        source: 'inbox',
      });
      expect(foreign.statusCode).toBe(404);
      expect(errorOf(foreign).code).toBe('NOT_FOUND');
      const bad = await post(operator, url(a.workspaceId, a.taggedContactId, a.tagId), {
        source: 'settings',
      });
      expect(bad.statusCode).toBe(400);
    });

    it('answers 429 with Retry-After at the shared limit', async () => {
      const { a, operator } = await world();
      for (let i = 0; i < 60; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: a.tagId,
          tagName: 'VIP',
          kind: 'removed',
          actorAccountId: a.operatorAccountId,
          createdAt: ago(20),
        });
      }
      const res = await post(operator, url(a.workspaceId, a.taggedContactId, a.tagId), {
        source: 'inbox',
      });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('40');
      expect(
        await db
          .selectFrom('contact_tags')
          .select('tag_id')
          .where('contact_id', '=', a.taggedContactId)
          .execute(),
      ).toHaveLength(1);
    });
  });

  describe('rename and delete (owner only, AC-11)', () => {
    it('refuses an operator with OWNER_ONLY and changes nothing', async () => {
      const { a, operator } = await world();
      const rename = await post(operator, `${base(a.workspaceId)}/tags/${a.tagId}/rename`, {
        name: 'Renamed',
      });
      expect(rename.statusCode).toBe(403);
      expect(errorOf(rename)).toMatchObject({
        code: 'OWNER_ONLY',
        message: "Only a business owner manages the workspace's tags",
      });
      const del = await post(operator, `${base(a.workspaceId)}/tags/${a.tagId}/delete`, {
        expected_count: 1,
      });
      expect(del.statusCode).toBe(403);
      expect(errorOf(del).code).toBe('OWNER_ONLY');
      expect(await tagNames(a.workspaceId)).toEqual(['VIP']);
    });

    it('renames, merges on confirmation and answers each refusal', async () => {
      const { a, b, owner } = await world();
      const loyal = await insertTag(db, {
        workspaceId: a.workspaceId,
        createdByAccountId: a.ownerAccountId,
        name: 'Loyal',
      });
      await insertContactTag(db, {
        workspaceId: a.workspaceId,
        contactId: a.otherContactId,
        tagId: loyal,
        addedByAccountId: a.operatorAccountId,
      });
      const u = (id: string) => `${base(a.workspaceId)}/tags/${id}/rename`;
      expect(
        TagNameInvalidError.parse((await post(owner, u(loyal), { name: ' ' })).json()),
      ).toBeDefined();
      const taken = await post(owner, u(loyal), { name: 'vip' });
      expect(taken.statusCode).toBe(409);
      expect(TagNameTakenError.parse(taken.json()).error.details.tag).toEqual({
        id: a.tagId,
        name: 'VIP',
        contact_count: 1,
      });
      const self = await post(owner, u(loyal), { name: 'x', merge_into_tag_id: loyal });
      expect(self.statusCode).toBe(400);
      expect(errorOf(self)).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { field: 'merge_into_tag_id' },
      });
      const changed = await post(owner, u(loyal), {
        name: 'Brand new',
        merge_into_tag_id: a.tagId,
      });
      expect(changed.statusCode).toBe(409);
      expect(TagMergeTargetChangedError.parse(changed.json()).error.details.name_holder).toBeNull();
      const foreign = await post(owner, u(b.tagId), { name: 'Other' });
      expect(foreign.statusCode).toBe(404);
      expect(errorOf(foreign).code).toBe('TAG_NOT_FOUND');

      const renamed = await post(owner, u(loyal), { name: 'Regular' });
      expect(TagRenameResult.parse(renamed.json())).toMatchObject({
        outcome: 'renamed',
        tag: { id: loyal, name: 'Regular', contact_count: 1 },
        merged_tag_id: null,
      });
      const same = await post(owner, u(loyal), { name: 'Regular' });
      expect(TagRenameResult.parse(same.json()).outcome).toBe('unchanged');
      const merged = await post(owner, u(loyal), { name: 'VIP', merge_into_tag_id: a.tagId });
      expect(TagRenameResult.parse(merged.json())).toMatchObject({
        outcome: 'merged',
        tag: { id: a.tagId, name: 'VIP', contact_count: 2 },
        merged_tag_id: loyal,
      });
      expect(await tagNames(a.workspaceId)).toEqual(['VIP']);
    });

    it('deletes against the confirmed count and refuses a changed count with the current one', async () => {
      const { a, owner } = await world();
      const u = (id: string) => `${base(a.workspaceId)}/tags/${id}/delete`;
      const changed = await post(owner, u(a.tagId), { expected_count: 5 });
      expect(changed.statusCode).toBe(409);
      expect(TagCountChangedError.parse(changed.json()).error.details.tag).toEqual({
        id: a.tagId,
        name: 'VIP',
        contact_count: 1,
      });
      const bad = await post(owner, u(a.tagId), { expected_count: -1 });
      expect(bad.statusCode).toBe(400);
      const ok = await post(owner, u(a.tagId), { expected_count: 1 });
      expect(ok.statusCode).toBe(200);
      expect(TagDeleted.parse(ok.json())).toEqual({
        workspace_id: a.workspaceId,
        tag_id: a.tagId,
        removed_from_count: 1,
      });
      const again = await post(owner, u(a.tagId), { expected_count: 1 });
      expect(again.statusCode).toBe(404);
      expect(TagNotFoundError.parse(again.json()).error.details.tag_id).toBe(a.tagId);
    });

    it('never limits an owner with 60 changes of their own in the last minute (AC-15)', async () => {
      const { a, owner } = await world();
      for (let i = 0; i < 70; i++) {
        await insertTagHistory(db, {
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: a.tagId,
          tagName: 'VIP',
          kind: 'added',
          actorAccountId: a.ownerAccountId,
          createdAt: ago(5),
        });
      }
      const res = await post(owner, `${base(a.workspaceId)}/tags/${a.tagId}/rename`, {
        name: 'Renamed',
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('the workspace guard on every route (AC-12)', () => {
    it('answers 401 signed out, 404 for another workspace account, 403 ACCESS_REMOVED when deactivated', async () => {
      const { a } = await world();
      const outsider = await stranger((await twoWorkspacesWithTags(db)).a.workspaceId);
      const removedAccount = await insertAccount(db);
      await insertMembership(db, a.workspaceId, {
        accountId: removedAccount.id,
        state: 'deactivated',
      });
      const removed = await signIn(removedAccount.id);
      const w = base(a.workspaceId);
      const routes: [string, string, object?][] = [
        ['GET', `${w}/contacts`],
        ['GET', `${w}/contacts/${a.taggedContactId}`],
        ['GET', `${w}/contacts/${a.taggedContactId}/tag-history`],
        ['POST', `${w}/contacts/${a.taggedContactId}/tags`, { name: 'Z', source: 'inbox' }],
        ['POST', `${w}/contacts/${a.taggedContactId}/tags/${a.tagId}/remove`, { source: 'inbox' }],
        ['GET', `${w}/tags`],
        ['POST', `${w}/tags/${a.tagId}/rename`, { name: 'Z' }],
        ['POST', `${w}/tags/${a.tagId}/delete`, { expected_count: 1 }],
      ];
      for (const [method, url, payload] of routes) {
        const send = (who: Who | null) =>
          app.inject({ method: method as 'GET', url, cookies: who?.cookies, payload });
        const signedOut = await send(null);
        expect(signedOut.statusCode, url).toBe(401);
        expect(errorOf(signedOut).code).toBe('UNAUTHENTICATED');
        const other = await send(outsider);
        expect(other.statusCode, url).toBe(404);
        expect(errorOf(other).code).toBe('NOT_FOUND');
        const gone = await send(removed);
        expect(gone.statusCode, url).toBe(403);
        expect(errorOf(gone).code).toBe('ACCESS_REMOVED');
      }
      expect(await tagNames(a.workspaceId)).toEqual(['VIP']);
    });
  });
});
