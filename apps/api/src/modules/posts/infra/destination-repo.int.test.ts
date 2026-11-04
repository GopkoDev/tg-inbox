import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createDestinationRepo } from './destination-repo.js';

const T0 = new Date('2026-11-03T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('destination repository (AC-04)', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createDestinationRepo>;
  let n = 0;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    repo = createDestinationRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  async function setup() {
    const { a, b } = await twoWorkspacesWithTags(db);
    const chatId = BigInt(-1000000000000 - ++n);
    const dest = await repo.insert(a.workspaceId, {
      id: newId(),
      telegramBotId: 4242n,
      chatId,
      kind: 'channel',
      title: 'Acme news',
      username: 'acme_news',
      connectedByAccountId: a.ownerAccountId,
      connectedAt: at(0),
      membershipChangedAt: at(0),
    });
    return { a, b, dest, chatId };
  }

  it('inserts and finds a destination only in its workspace, by id and by chat', async () => {
    const { a, b, dest, chatId } = await setup();
    expect(dest).toMatchObject({
      workspaceId: a.workspaceId,
      chatId,
      kind: 'channel',
      title: 'Acme news',
      username: 'acme_news',
      availability: 'available',
      problem: null,
      removedAt: null,
      pausedUntil: null,
      nextSendAt: null,
    });
    expect(await repo.find(a.workspaceId, dest.id)).toEqual(dest);
    expect(await repo.findByChat(a.workspaceId, chatId)).toEqual(dest);
    expect(await repo.find(b.workspaceId, dest.id)).toBeNull();
    expect(await repo.findByChat(b.workspaceId, chatId)).toBeNull();
  });

  it('lists and counts only live destinations of the workspace', async () => {
    const { a, b, dest } = await setup();
    const other = await repo.insert(a.workspaceId, {
      id: newId(),
      telegramBotId: 4242n,
      chatId: BigInt(-2000000000000 - ++n),
      kind: 'group',
      title: 'Acme chat',
      username: null,
      connectedByAccountId: a.ownerAccountId,
      connectedAt: at(10),
      membershipChangedAt: at(10),
    });
    expect(await repo.remove(a.workspaceId, other.id, a.ownerAccountId, at(20))).toBe(true);
    const live = await repo.listLive(a.workspaceId);
    expect(live.map((d) => d.id)).toContain(dest.id);
    expect(live.map((d) => d.id)).not.toContain(other.id);
    expect(await repo.countLive(a.workspaceId)).toBe(live.length);
    expect(await repo.listLive(b.workspaceId)).toEqual([]);
    expect(await repo.countLive(b.workspaceId)).toBe(0);
  });

  it('locks the row; a foreign id locks nothing', async () => {
    const { a, b, dest } = await setup();
    expect(await inTx((tx) => repo.lock(b.workspaceId, dest.id, tx))).toBeNull();
    expect(await inTx((tx) => repo.lock(a.workspaceId, dest.id, tx))).toMatchObject({
      id: dest.id,
    });
  });

  it('writes to its own workspace only: availability, chat id, rename, pause, pace, remove, revive', async () => {
    const { a, b, dest } = await setup();
    expect(
      await repo.setAvailability(b.workspaceId, dest.id, {
        availability: 'unavailable',
        problem: 'not_member',
        membershipChangedAt: at(5),
      }),
    ).toBe(false);
    expect(await repo.rename(b.workspaceId, dest.id, { title: 'X', username: null })).toBe(false);
    expect(await repo.remove(b.workspaceId, dest.id, b.ownerAccountId, at(5))).toBe(false);
    expect(await repo.setPausedUntil(b.workspaceId, dest.id, at(60))).toBe(false);
    expect(await repo.setNextSendAt(b.workspaceId, dest.id, at(3))).toBe(false);
    expect(await repo.find(a.workspaceId, dest.id)).toEqual(dest);

    expect(
      await repo.setAvailability(a.workspaceId, dest.id, {
        availability: 'unavailable',
        problem: 'no_post_right',
        membershipChangedAt: at(5),
      }),
    ).toBe(true);
    // An older membership fact is ignored.
    expect(
      await repo.setAvailability(a.workspaceId, dest.id, {
        availability: 'available',
        problem: null,
        membershipChangedAt: at(1),
      }),
    ).toBe(false);
    expect(await repo.rename(a.workspaceId, dest.id, { title: 'Acme daily', username: null })).toBe(
      true,
    );
    const newChat = BigInt(-3000000000000 - ++n);
    expect(await repo.migrateChatId(a.workspaceId, dest.id, newChat)).toBe(true);
    expect(await repo.setPausedUntil(a.workspaceId, dest.id, at(60))).toBe(true);
    expect(await repo.setNextSendAt(a.workspaceId, dest.id, at(3))).toBe(true);
    expect(await repo.find(a.workspaceId, dest.id)).toMatchObject({
      availability: 'unavailable',
      problem: 'no_post_right',
      membershipChangedAt: at(5),
      title: 'Acme daily',
      username: null,
      chatId: newChat,
      pausedUntil: at(60),
      nextSendAt: at(3),
    });

    expect(await repo.remove(a.workspaceId, dest.id, a.ownerAccountId, at(70))).toBe(true);
    expect(await repo.find(a.workspaceId, dest.id)).toMatchObject({
      removedAt: at(70),
      removedByAccountId: a.ownerAccountId,
    });
    const revive = {
      telegramBotId: 4343n,
      kind: 'group' as const,
      title: 'Acme revived',
      username: null,
      availability: 'available' as const,
      problem: null,
      membershipChangedAt: at(80),
      connectedByAccountId: a.operatorAccountId,
      connectedAt: at(80),
    };
    expect(await repo.revive(b.workspaceId, dest.id, revive)).toBeNull();
    expect(await repo.revive(a.workspaceId, dest.id, revive)).toMatchObject({
      id: dest.id,
      removedAt: null,
      removedByAccountId: null,
      telegramBotId: 4343n,
      title: 'Acme revived',
      availability: 'available',
      connectedAt: at(80),
    });
  });
});
