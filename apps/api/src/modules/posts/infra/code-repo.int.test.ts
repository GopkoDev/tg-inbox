import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { hashCode, newCode } from '../domain/connect-code.js';
import { createCodeRepo } from './code-repo.js';
import { createDestinationRepo } from './destination-repo.js';

const T0 = new Date('2026-11-03T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('destination code repository (AC-04)', () => {
  let database: TestDatabase;
  let db: Db;
  let codes: ReturnType<typeof createCodeRepo>;
  let dests: ReturnType<typeof createDestinationRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    codes = createCodeRepo(db);
    dests = createDestinationRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const draft = (accountId: string, hash: Buffer, s = 0) => ({
    id: newId(),
    accountId,
    codeHash: hash,
    createdAt: at(s),
    expiresAt: at(s + 600),
  });

  it('finds a code by hash only in the workspace it was made in; the same hash may live in two', async () => {
    const { a, b } = await twoWorkspacesWithTags(db);
    const { hash } = newCode();
    const inA = await codes.insert(a.workspaceId, draft(a.ownerAccountId, hash));
    expect(await codes.findByHash(a.workspaceId, hash)).toEqual(inA);
    expect(await codes.findByHash(b.workspaceId, hash)).toBeNull();
    const inB = await codes.insert(b.workspaceId, draft(b.ownerAccountId, hash));
    expect(inB.id).not.toBe(inA.id);
    expect((await codes.findByHash(b.workspaceId, hash))?.id).toBe(inB.id);
    expect(await codes.findByHash(a.workspaceId, hashCode('tgp_nope'))).toBeNull();
  });

  it("replaces the owner's previous live code, not other owners' or another workspace's", async () => {
    const { a, b } = await twoWorkspacesWithTags(db);
    const first = await codes.insert(a.workspaceId, draft(a.ownerAccountId, newCode().hash, 0));
    const otherMember = await codes.insert(
      a.workspaceId,
      draft(a.operatorAccountId, newCode().hash, 0),
    );
    const foreign = await codes.insert(b.workspaceId, draft(b.ownerAccountId, newCode().hash, 0));
    expect(await codes.replacePrevious(b.workspaceId, a.ownerAccountId, at(29))).toBe(0);
    expect(await codes.replacePrevious(a.workspaceId, a.ownerAccountId, at(30))).toBe(1);
    expect((await codes.findByHash(a.workspaceId, first.codeHash))?.replacedAt).toEqual(at(30));
    expect((await codes.findByHash(a.workspaceId, otherMember.codeHash))?.replacedAt).toBeNull();
    expect((await codes.findByHash(b.workspaceId, foreign.codeHash))?.replacedAt).toBeNull();
  });

  it('marks a code used (once) or with a no-right result, only inside its workspace', async () => {
    const { a, b } = await twoWorkspacesWithTags(db);
    const dest = await dests.insert(a.workspaceId, {
      id: newId(),
      telegramBotId: 1n,
      chatId: -1009999999999n,
      kind: 'group',
      title: 'Acme chat',
      username: null,
      connectedByAccountId: a.ownerAccountId,
      connectedAt: at(0),
      membershipChangedAt: at(0),
    });
    const c1 = await codes.insert(a.workspaceId, draft(a.ownerAccountId, newCode().hash));
    const c2 = await codes.insert(a.workspaceId, draft(a.ownerAccountId, newCode().hash));

    expect(await codes.markResult(b.workspaceId, c2.id, 'no_post_right', at(5))).toBe(false);
    expect(await codes.markResult(a.workspaceId, c2.id, 'no_post_right', at(5))).toBe(true);
    expect(await codes.find(a.workspaceId, c2.id)).toMatchObject({
      result: 'no_post_right',
      resultAt: at(5),
      usedAt: null,
    });

    expect(await codes.markUsed(b.workspaceId, c1.id, dest.id, at(6))).toBe(false);
    expect(await codes.markUsed(a.workspaceId, c1.id, dest.id, at(6))).toBe(true);
    expect(await codes.markUsed(a.workspaceId, c1.id, dest.id, at(7))).toBe(false);
    expect(await codes.find(a.workspaceId, c1.id)).toMatchObject({
      usedAt: at(6),
      destinationId: dest.id,
      result: 'connected',
      resultAt: at(6),
    });
    expect(await codes.find(b.workspaceId, c1.id)).toBeNull();
  });
});
