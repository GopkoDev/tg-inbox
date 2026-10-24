import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import {
  insertGroupContact,
  twoWorkspacesWithBroadcasts,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createGroupRepo } from './group-repo.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('broadcast group repository (ADR-0005)', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createGroupRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    repo = createGroupRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  it('adds a contact once and reports whether a row was written; two concurrent adds write one row', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const add = () =>
      inTx((tx) =>
        repo.add(a.workspaceId, a.draftId, a.otherContactId, a.operatorAccountId, at(1), tx),
      );
    const results = await Promise.all([add(), add()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await add()).toBe(false);
    expect(await repo.count(a.workspaceId, a.draftId)).toBe(1);
  });

  it('adds many in one statement, skipping those already in, and counts what it wrote', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const extra: string[] = [];
    for (let i = 0; i < 3; i++) extra.push(await insertContact(db, { workspaceId: a.workspaceId }));
    await repo.add(a.workspaceId, a.draftId, a.taggedContactId, a.operatorAccountId, at(1));
    const written = await inTx((tx) =>
      repo.addMany(
        a.workspaceId,
        a.draftId,
        [a.taggedContactId, ...extra],
        a.ownerAccountId,
        at(2),
        tx,
      ),
    );
    expect(written).toBe(3);
    expect(await repo.count(a.workspaceId, a.draftId)).toBe(4);
    expect(await repo.ids(a.workspaceId, a.draftId)).toEqual([a.taggedContactId, ...extra].sort());
    expect(await repo.addMany(a.workspaceId, a.draftId, [], a.ownerAccountId, at(3))).toBe(0);
  });

  it('removes one row by key and reports an absent one as unchanged', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    await repo.add(a.workspaceId, a.draftId, a.taggedContactId, a.operatorAccountId, at(1));
    await repo.add(a.workspaceId, a.draftId, a.otherContactId, a.operatorAccountId, at(1));
    expect(await repo.remove(a.workspaceId, a.draftId, a.otherContactId)).toBe(true);
    expect(await repo.remove(a.workspaceId, a.draftId, a.otherContactId)).toBe(false);
    expect(await repo.ids(a.workspaceId, a.draftId)).toEqual([a.taggedContactId]);
  });

  it('answers membership for the asked ids only', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    // The launched broadcast's group holds both contacts; the draft's holds none.
    expect(
      (await repo.membership(a.workspaceId, a.launchedId, [a.taggedContactId])).sort(),
    ).toEqual([a.taggedContactId]);
    expect(await repo.membership(a.workspaceId, a.draftId, a.contactIds)).toEqual([]);
    expect(await repo.membership(a.workspaceId, a.launchedId, [])).toEqual([]);
  });

  it('pages the group newest added first with a keyset', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await insertContact(db, { workspaceId: a.workspaceId });
      ids.push(c);
      // Two share the same time: contact id descending breaks the tie.
      await insertGroupContact(db, {
        workspaceId: a.workspaceId,
        broadcastId: a.draftId,
        contactId: c,
        addedByAccountId: a.operatorAccountId,
        addedAt: at(i === 4 ? 3 : i),
      });
    }
    const expected = [...[ids[3]!, ids[4]!].sort().reverse(), ids[2]!, ids[1]!, ids[0]!];
    const first = await repo.page(a.workspaceId, a.draftId, undefined, 2);
    expect(first.rows.map((r) => r.contactId)).toEqual(expected.slice(0, 2));
    expect(first.rows[0]).toMatchObject({ addedByAccountId: a.operatorAccountId });
    expect(first.hasNext).toBe(true);
    const last = first.rows.at(-1)!;
    const second = await repo.page(
      a.workspaceId,
      a.draftId,
      { addedAt: last.addedAt, contactId: last.contactId },
      2,
    );
    expect(second.rows.map((r) => r.contactId)).toEqual(expected.slice(2, 4));
    const tail = second.rows.at(-1)!;
    const third = await repo.page(
      a.workspaceId,
      a.draftId,
      { addedAt: tail.addedAt, contactId: tail.contactId },
      2,
    );
    expect(third.rows.map((r) => r.contactId)).toEqual(expected.slice(4));
    expect(third.hasNext).toBe(false);
  });

  it('is scoped by workspace: foreign ids read and change nothing, a foreign contact is refused', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    // B's launched group holds B's two contacts.
    expect(await repo.count(a.workspaceId, b.launchedId)).toBe(0);
    expect(await repo.ids(a.workspaceId, b.launchedId)).toEqual([]);
    expect(await repo.membership(a.workspaceId, b.launchedId, b.contactIds)).toEqual([]);
    expect((await repo.page(a.workspaceId, b.launchedId, undefined, 50)).rows).toEqual([]);
    expect(await repo.remove(a.workspaceId, b.launchedId, b.taggedContactId)).toBe(false);
    expect(await repo.count(b.workspaceId, b.launchedId)).toBe(2);
    // A contact of B into A's draft, or A's contact into B's draft: the composite FKs refuse.
    await expect(
      repo.add(a.workspaceId, a.draftId, b.taggedContactId, a.operatorAccountId, at(1)),
    ).rejects.toThrow(/broadcast_group_contacts_contact_fkey/);
    await expect(
      repo.add(a.workspaceId, b.draftId, a.taggedContactId, a.operatorAccountId, at(1)),
    ).rejects.toThrow(/broadcast_group_contacts_broadcast_fkey/);
    await expect(
      repo.addMany(a.workspaceId, a.draftId, [b.otherContactId], a.operatorAccountId, at(1)),
    ).rejects.toThrow(/broadcast_group_contacts_contact_fkey/);
    expect(await repo.count(a.workspaceId, a.draftId)).toBe(0);
  });

  it('removes every row of one group only, never another group or workspace (isolation)', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    for (const contactId of a.contactIds) {
      await repo.add(a.workspaceId, a.draftId, contactId, a.operatorAccountId, at(1));
    }
    await repo.add(b.workspaceId, b.draftId, b.taggedContactId, b.operatorAccountId, at(1));
    // Another workspace's ids remove nothing.
    expect(await inTx((tx) => repo.removeAll(b.workspaceId, a.draftId, tx))).toBe(0);
    expect(await inTx((tx) => repo.removeAll(a.workspaceId, a.draftId, tx))).toBe(2);
    expect(await repo.count(a.workspaceId, a.draftId)).toBe(0);
    expect(await repo.count(a.workspaceId, a.launchedId)).toBe(2);
    expect(await repo.count(b.workspaceId, b.draftId)).toBe(1);
  });
});
