import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { hashToken } from '../../../platform/tokens.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  insertInvitation,
  insertWorkspace,
  T0,
  twoWorkspaces,
  WEEK,
} from '../../../test/fixtures/workspaces.js';
import { KyselyInvitationRepo } from './invitation-repo.js';

const NOW = new Date(T0.getTime() + 1000);

describe('KyselyInvitationRepo', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: KyselyInvitationRepo;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = new KyselyInvitationRepo(db);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('insert writes under the given workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const id = newId();
    const tokenHash = hashToken('t-insert');
    await repo.insert(a, {
      id,
      email: 'x@y.com',
      role: 'owner',
      tokenHash,
      state: 'pending',
      expiresAt: new Date(T0.getTime() + WEEK),
      createdAt: T0,
      closedAt: null,
    });
    expect((await repo.findLatest(a))?.id).toBe(id);
    expect(await repo.findLatest(b)).toBeNull();
  });

  it('isolation: consume succeeds only in the invitation workspace and only once', async () => {
    const { a, b } = await twoWorkspaces(db);
    const inv = await insertInvitation(db, a);
    expect(await repo.consume(b, inv.tokenHash, NOW)).toBe(false);
    expect((await repo.findByTokenHash(inv.tokenHash))?.state).toBe('pending');
    expect(await repo.consume(a, inv.tokenHash, NOW)).toBe(true);
    expect(await repo.findByTokenHash(inv.tokenHash)).toMatchObject({
      state: 'accepted',
      closedAt: NOW,
    });
    expect(await repo.consume(a, inv.tokenHash, NOW)).toBe(false);
  });

  it('consume changes nothing for an expired, revoked or superseded invitation', async () => {
    const w = await insertWorkspace(db);
    const expired = await insertInvitation(db, w, { expiresAt: new Date(T0.getTime() + 500) });
    const revoked = await insertInvitation(db, w, { state: 'revoked' });
    const superseded = await insertInvitation(db, w, { state: 'superseded' });
    for (const inv of [expired, revoked, superseded]) {
      const before = await repo.findByTokenHash(inv.tokenHash);
      expect(await repo.consume(w, inv.tokenHash, NOW)).toBe(false);
      expect(await repo.findByTokenHash(inv.tokenHash)).toEqual(before);
    }
  });

  it('isolation: supersedePending only touches the given workspace and email', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ia = await insertInvitation(db, a, { email: 'same@x.com' });
    const ib = await insertInvitation(db, b, { email: 'same@x.com' });
    const ia2 = await insertInvitation(db, a, { email: 'diff@x.com' });
    expect(await repo.supersedePending(a, 'same@x.com', NOW)).toBe(1);
    expect((await repo.findByTokenHash(ia.tokenHash))?.state).toBe('superseded');
    expect((await repo.findByTokenHash(ib.tokenHash))?.state).toBe('pending');
    expect((await repo.findByTokenHash(ia2.tokenHash))?.state).toBe('pending');
    expect(await repo.supersedePending(a, 'same@x.com', NOW)).toBe(0);
  });

  it('isolation: listPending lists unexpired pending of the workspace only, with paging', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await insertInvitation(db, a)).id);
    ids.sort();
    await insertInvitation(db, a, { state: 'revoked' });
    await insertInvitation(db, a, { expiresAt: new Date(T0.getTime() + 500) });
    const ib = await insertInvitation(db, b);
    expect((await repo.listPending(a, NOW, { limit: 50 })).map((i) => i.id)).toEqual(ids);
    expect((await repo.listPending(b, NOW, { limit: 50 })).map((i) => i.id)).toEqual([ib.id]);
    expect((await repo.listPending(a, NOW, { limit: 1, after: ids[0]! })).map((i) => i.id)).toEqual(
      [ids[1]],
    );
    expect(
      (await repo.listPending(a, NOW, { limit: 1, before: ids[2]! })).map((i) => i.id),
    ).toEqual([ids[1]]);
  });

  it('isolation: findLatest returns the latest of the workspace in any state', async () => {
    const { a, b } = await twoWorkspaces(db);
    await insertInvitation(db, a);
    const last = await insertInvitation(db, a, { state: 'accepted' });
    await insertInvitation(db, b);
    expect((await repo.findLatest(a))?.id).toBe(last.id);
    expect(await repo.findLatest(await insertWorkspace(db))).toBeNull();
  });

  it('isolation: revoke of workspace A invitation through workspace B changes 0 rows', async () => {
    const { a, b } = await twoWorkspaces(db);
    const inv = await insertInvitation(db, a);
    expect(await repo.revoke(b, inv.id, NOW)).toBe(false);
    expect((await repo.findByTokenHash(inv.tokenHash))?.state).toBe('pending');
    expect(await repo.revoke(a, inv.id, NOW)).toBe(true);
    expect(await repo.findByTokenHash(inv.tokenHash)).toMatchObject({
      state: 'revoked',
      closedAt: NOW,
    });
    expect(await repo.revoke(a, inv.id, NOW)).toBe(false);
  });

  describe('controlled exception: findByTokenHash', () => {
    it('returns the one invitation with its workspace name; an unknown hash returns none', async () => {
      const { a, b } = await twoWorkspaces(db);
      const ia = await insertInvitation(db, a);
      const ib = await insertInvitation(db, b);
      expect(await repo.findByTokenHash(ia.tokenHash)).toMatchObject({
        id: ia.id,
        workspaceId: a,
        workspaceName: 'A',
      });
      expect(await repo.findByTokenHash(ib.tokenHash)).toMatchObject({
        id: ib.id,
        workspaceName: 'B',
      });
      expect(await repo.findByTokenHash(hashToken('unknown'))).toBeNull();
    });
  });
});
