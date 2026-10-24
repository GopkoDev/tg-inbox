import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import {
  endBroadcastFixture,
  insertAudienceTag,
  insertBroadcast,
  insertGroupContact,
  launchBroadcastFixture,
  twoWorkspacesWithBroadcasts,
} from '../../../test/fixtures/broadcasts.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createAudienceTagRepo } from './audience-tag-repo.js';
import { createBroadcastRepo } from './broadcast-repo.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const HOUR = 3_600_000;

describe('broadcast repository (ADR-0005)', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createBroadcastRepo>;
  let tags: ReturnType<typeof createAudienceTagRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    repo = createBroadcastRepo(db);
    tags = createAudienceTagRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  it('inserts a draft and finds it only in its workspace', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const id = newId();
    const draft = await repo.insertDraft(a.workspaceId, {
      id,
      name: 'Spring prices',
      text: '',
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: a.operatorAccountId,
      createdAt: at(1),
    });
    expect(draft).toMatchObject({
      id,
      workspaceId: a.workspaceId,
      name: 'Spring prices',
      text: '',
      status: 'draft',
      version: 1,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: a.operatorAccountId,
      lastChangedByAccountId: a.operatorAccountId,
      lastChangedAt: at(1),
      createdAt: at(1),
      launchedAt: null,
      launchTelegramBotId: null,
    });
    expect(await repo.find(a.workspaceId, id)).toEqual(draft);
    expect(await repo.find(b.workspaceId, id)).toBeNull();
  });

  it('locks the row FOR NO KEY UPDATE until the transaction ends; a foreign id locks nothing', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    expect(await inTx((tx) => repo.lockForUpdate(b.workspaceId, a.draftId, tx))).toBeNull();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const first = inTx(async (tx) => {
      expect(await repo.lockForUpdate(a.workspaceId, a.draftId, tx)).toMatchObject({
        id: a.draftId,
        status: 'draft',
      });
      locked();
      await held;
    });
    await isLocked;
    let secondDone = false;
    const second = inTx(async (tx) => {
      await repo.lockForUpdate(a.workspaceId, a.draftId, tx);
      secondDone = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(secondDone).toBe(false);
    release();
    await first;
    await second;
    expect(secondDone).toBe(true);
  });

  it('saves fields only at the expected version of a draft, raising it and the last change', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const saved = await repo.saveFields(
      a.workspaceId,
      a.draftId,
      1,
      { name: 'Renamed', text: 'New text' },
      a.ownerAccountId,
      at(50),
    );
    expect(saved).toMatchObject({
      name: 'Renamed',
      text: 'New text',
      version: 2,
      lastChangedByAccountId: a.ownerAccountId,
      lastChangedAt: at(50),
    });
    // Stale: written against version 1 again.
    expect(
      await repo.saveFields(
        a.workspaceId,
        a.draftId,
        1,
        { name: 'Stale' },
        a.operatorAccountId,
        at(60),
      ),
    ).toBeNull();
    // Another workspace, or a launched broadcast.
    expect(
      await repo.saveFields(
        b.workspaceId,
        a.draftId,
        2,
        { name: 'Foreign' },
        b.ownerAccountId,
        at(60),
      ),
    ).toBeNull();
    expect(
      await repo.saveFields(
        a.workspaceId,
        a.launchedId,
        1,
        { name: 'Late' },
        a.ownerAccountId,
        at(60),
      ),
    ).toBeNull();
    expect(await repo.find(a.workspaceId, a.draftId)).toMatchObject({
      name: 'Renamed',
      version: 2,
    });
    // Switching to a group clears the tag mode.
    expect(
      await repo.saveFields(
        a.workspaceId,
        a.draftId,
        2,
        { audienceKind: 'group', tagMode: null },
        a.ownerAccountId,
        at(70),
      ),
    ).toMatchObject({ audienceKind: 'group', tagMode: null, version: 3 });
  });

  it('touch moves the last change only, keeping the version (group writes, ADR-0005)', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    expect(await repo.touch(a.workspaceId, a.draftId, a.ownerAccountId, at(90))).toBe(true);
    expect(await repo.touch(b.workspaceId, a.draftId, b.ownerAccountId, at(91))).toBe(false);
    expect(await repo.find(a.workspaceId, a.draftId)).toMatchObject({
      version: 1,
      lastChangedByAccountId: a.ownerAccountId,
      lastChangedAt: at(90),
    });
  });

  it('lists the workspace by last change, newest first, then id', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const older = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.operatorAccountId,
      lastChangedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newest = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.operatorAccountId,
      lastChangedAt: new Date('2027-01-01T00:00:00Z'),
    });
    const ids = (await repo.list(a.workspaceId)).map((r) => r.id);
    // The fixture's draft and launched broadcast share one time: id descending.
    const tie = [a.draftId, a.launchedId].sort().reverse();
    expect(ids).toEqual([newest, ...tie, older]);
    expect(ids).not.toContain(b.draftId);
  });

  it('counts launches since a time and finds the 10th newest, stopped and aborted ones included', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const now = new Date('2026-10-20T12:00:00Z');
    const launchAt = async (hoursAgo: number, end?: 'stopped' | 'aborted') => {
      const id = await insertBroadcast(db, {
        workspaceId: a.workspaceId,
        authorAccountId: a.ownerAccountId,
      });
      const launchedAt = new Date(now.getTime() - hoursAgo * HOUR);
      await launchBroadcastFixture(db, {
        broadcast: id,
        launchedByAccountId: a.ownerAccountId,
        telegramBotId: a.telegramBotId,
        recipients: [{ contactId: a.taggedContactId }],
        launchedAt,
      });
      if (end === 'stopped') {
        await endBroadcastFixture(db, {
          broadcast: id,
          status: 'stopped',
          stoppedByAccountId: a.ownerAccountId,
          endedAt: launchedAt,
        });
      }
      if (end === 'aborted') {
        await endBroadcastFixture(db, {
          broadcast: id,
          status: 'sent',
          endReason: 'text_refused',
          endedAt: launchedAt,
        });
      }
      return launchedAt;
    };
    const since = new Date(now.getTime() - 24 * HOUR);
    // The fixture launched one broadcast at 2026-10-11 (outside the window).
    const times: Date[] = [];
    times.push(await launchAt(30));
    for (let i = 0; i < 9; i++)
      times.push(await launchAt(20 - i, i === 0 ? 'stopped' : i === 1 ? 'aborted' : undefined));
    expect(await repo.launchesSince(a.workspaceId, since)).toBe(9);
    // 11 launched in total (fixture + 10): the 10th newest is the one 30 h ago.
    expect(await repo.tenthNewestLaunchedAt(a.workspaceId)).toEqual(times[0]);
    expect(await repo.launchesSince(b.workspaceId, since)).toBe(0);
    // Workspace B has its fixture launch only: fewer than 10, no 10th newest.
    expect(await repo.tenthNewestLaunchedAt(b.workspaceId)).toBeNull();
  });

  it('lists the sending broadcasts oldest launch first', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const later = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.ownerAccountId,
    });
    await launchBroadcastFixture(db, {
      broadcast: later,
      launchedByAccountId: a.ownerAccountId,
      telegramBotId: a.telegramBotId,
      recipients: [{ contactId: a.taggedContactId }],
      launchedAt: new Date('2026-10-12T00:00:00Z'),
    });
    const ended = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.ownerAccountId,
    });
    await launchBroadcastFixture(db, {
      broadcast: ended,
      launchedByAccountId: a.ownerAccountId,
      telegramBotId: a.telegramBotId,
      recipients: [{ contactId: a.taggedContactId, state: 'delivered' }],
      launchedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await endBroadcastFixture(db, { broadcast: ended, status: 'sent' });
    expect((await repo.sendingBroadcasts(a.workspaceId)).map((r) => r.id)).toEqual([
      a.launchedId,
      later,
    ]);
    expect((await repo.sendingBroadcasts(b.workspaceId)).map((r) => r.id)).toEqual([b.launchedId]);
  });

  it('ends only a sending broadcast: stopped by an owner, or sent with its end reason; never a foreign one', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    // A foreign id ends nothing.
    expect(
      await inTx((tx) =>
        repo.markStopped(a.workspaceId, b.launchedId, a.ownerAccountId, at(5), tx),
      ),
    ).toBe(false);
    expect(
      await inTx((tx) => repo.markSent(a.workspaceId, b.launchedId, 'completed', at(5), tx)),
    ).toBe(false);
    expect((await repo.find(b.workspaceId, b.launchedId))!.status).toBe('sending');
    // A draft is never ended.
    expect(
      await inTx((tx) => repo.markSent(a.workspaceId, a.draftId, 'completed', at(5), tx)),
    ).toBe(false);

    expect(
      await inTx((tx) =>
        repo.markStopped(a.workspaceId, a.launchedId, a.ownerAccountId, at(6), tx),
      ),
    ).toBe(true);
    expect(await repo.find(a.workspaceId, a.launchedId)).toMatchObject({
      status: 'stopped',
      stoppedAt: at(6),
      stoppedByAccountId: a.ownerAccountId,
      endedAt: at(6),
      endReason: 'stopped',
      lastChangedByAccountId: a.ownerAccountId,
      lastChangedAt: at(6),
    });
    // A stopped broadcast is never stopped again, finished or aborted.
    expect(
      await inTx((tx) =>
        repo.markStopped(a.workspaceId, a.launchedId, a.operatorAccountId, at(7), tx),
      ),
    ).toBe(false);
    expect(
      await inTx((tx) => repo.markSent(a.workspaceId, a.launchedId, 'text_refused', at(7), tx)),
    ).toBe(false);

    expect(
      await inTx((tx) => repo.markSent(b.workspaceId, b.launchedId, 'bot_stopped', at(8), tx)),
    ).toBe(true);
    expect(await repo.find(b.workspaceId, b.launchedId)).toMatchObject({
      status: 'sent',
      endedAt: at(8),
      endReason: 'bot_stopped',
      stoppedAt: null,
      stoppedByAccountId: null,
    });
  });

  it('deletes a draft with its tag and group rows; never a launched or foreign one', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    await insertGroupContact(db, {
      workspaceId: a.workspaceId,
      broadcastId: a.draftId,
      contactId: a.otherContactId,
      addedByAccountId: a.operatorAccountId,
    });
    expect(await inTx((tx) => repo.deleteDraft(b.workspaceId, a.draftId, tx))).toBe(false);
    expect(await inTx((tx) => repo.deleteDraft(a.workspaceId, a.launchedId, tx))).toBe(false);
    expect(await inTx((tx) => repo.deleteDraft(a.workspaceId, a.draftId, tx))).toBe(true);
    expect(await repo.find(a.workspaceId, a.draftId)).toBeNull();
    const left = async (
      table: 'broadcast_audience_tags' | 'broadcast_group_contacts',
      id: string,
    ) =>
      (await db.selectFrom(table).select('broadcast_id').where('broadcast_id', '=', id).execute())
        .length;
    expect(await left('broadcast_audience_tags', a.draftId)).toBe(0);
    expect(await left('broadcast_group_contacts', a.draftId)).toBe(0);
    expect(await left('broadcast_audience_tags', b.draftId)).toBe(1);
    expect(await repo.find(b.workspaceId, b.draftId)).not.toBeNull();
  });

  describe('audience tags', () => {
    it('lists, replaces and copies a broadcast tag audience within its workspace', async () => {
      const { a, b } = await twoWorkspacesWithBroadcasts(db);
      expect(await tags.list(a.workspaceId, a.draftId)).toEqual([
        { tagId: a.tagId, name: 'VIP', kind: 'include' },
      ]);
      expect(await tags.list(b.workspaceId, a.draftId)).toEqual([]);

      const gone = newId();
      await inTx((tx) =>
        tags.replace(
          a.workspaceId,
          a.draftId,
          [
            { tagId: gone, name: 'Wholesale', kind: 'include' },
            { tagId: a.tagId, name: 'VIP', kind: 'exclude' },
          ],
          tx,
        ),
      );
      const listed = await tags.list(a.workspaceId, a.draftId);
      expect(listed).toHaveLength(2);
      expect(listed).toEqual(
        expect.arrayContaining([
          { tagId: gone, name: 'Wholesale', kind: 'include' },
          { tagId: a.tagId, name: 'VIP', kind: 'exclude' },
        ]),
      );
      // B's rows are untouched by A's replace.
      expect(await tags.list(b.workspaceId, b.draftId)).toEqual([
        { tagId: b.tagId, name: 'VIP', kind: 'include' },
      ]);

      const copy = await insertBroadcast(db, {
        workspaceId: a.workspaceId,
        authorAccountId: a.ownerAccountId,
      });
      await inTx((tx) => tags.copy(a.workspaceId, a.draftId, copy, tx));
      expect(await tags.list(a.workspaceId, copy)).toEqual(listed);
      // Copying from a foreign broadcast copies nothing.
      const empty = await insertBroadcast(db, {
        workspaceId: a.workspaceId,
        authorAccountId: a.ownerAccountId,
      });
      await inTx((tx) => tags.copy(a.workspaceId, b.draftId, empty, tx));
      expect(await tags.list(a.workspaceId, empty)).toEqual([]);
      await insertAudienceTag(db, {
        workspaceId: a.workspaceId,
        broadcastId: empty,
        tagId: a.tagId,
      });
      expect(await tags.list(a.workspaceId, empty)).toHaveLength(1);
    });
  });
});
