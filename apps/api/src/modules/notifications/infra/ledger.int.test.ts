import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import {
  insertPing,
  insertPresence,
  insertTelegramLink,
  twoWorkspacesWithLinks,
} from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createPingRepo } from './ping-repo.js';
import { createPresenceRepo } from './presence-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const sec = (s: number) => new Date(T0.getTime() + s * 1000);
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

describe('presence and ping ledger repositories (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let presence: ReturnType<typeof createPresenceRepo>;
  let pings: ReturnType<typeof createPingRepo>;
  let nextUser = 7_000_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 10 });
    presence = createPresenceRepo(db);
    pings = createPingRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const conversation = async (workspaceId: string) =>
    insertConversation(db, {
      workspaceId,
      contactId: await insertContact(db, { workspaceId, telegramUserId: nextUser++ }),
    });
  const tx = <T>(fn: Parameters<ReturnType<Db['transaction']>['execute']>[0]) =>
    db.transaction().execute(fn) as Promise<T>;
  const lease = (id: string) =>
    db.selectFrom('tab_presences').selectAll().where('id', '=', id).executeTakeFirst();

  describe('presenceRepo', () => {
    it('open stores the lease; the first on-screen time is the open time when it opens on screen', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      const on = newId();
      const off = newId();
      await presence.open(a.workspaceId, {
        id: on,
        accountId,
        liveUntil: sec(50),
        onScreen: true,
        at: sec(0),
      });
      await presence.open(a.workspaceId, {
        id: off,
        accountId,
        liveUntil: sec(50),
        onScreen: false,
        at: sec(0),
      });
      expect(await lease(on)).toMatchObject({
        workspace_id: a.workspaceId,
        account_id: accountId,
        live_until: sec(50),
        on_screen: true,
        last_on_screen_at: sec(0),
        opened_at: sec(0),
      });
      expect(await lease(off)).toMatchObject({ on_screen: false, last_on_screen_at: null });
    });

    it('extend moves the lease forward, never back, and only inside its workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const id = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
      });
      expect(await presence.extend(b.workspaceId, id, sec(500))).toBe(false);
      expect((await lease(id))?.live_until).toEqual(sec(50));
      expect(await presence.extend(a.workspaceId, id, sec(100))).toBe(true);
      expect((await lease(id))?.live_until).toEqual(sec(100));
      await presence.extend(a.workspaceId, id, sec(60));
      expect((await lease(id))?.live_until).toEqual(sec(100));
      expect(await presence.extend(a.workspaceId, newId(), sec(100))).toBe(false);
    });

    it('setScreen records the screen state and the time it changed, only inside its workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const id = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
      });
      expect(await presence.setScreen(b.workspaceId, id, false, sec(20))).toBe(false);
      expect((await lease(id))?.on_screen).toBe(true);
      expect(await presence.setScreen(a.workspaceId, id, false, sec(20))).toBe(true);
      expect(await lease(id)).toMatchObject({ on_screen: false, last_on_screen_at: sec(20) });
      await presence.setScreen(a.workspaceId, id, true, sec(30));
      expect(await lease(id)).toMatchObject({ on_screen: true, last_on_screen_at: sec(30) });
    });

    it('an off frame stamps last_on_screen_at only when the tab really leaves the screen (D1)', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      // A tab that opened hidden and was never on screen: an off frame keeps it never-on-screen.
      const hidden = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        onScreen: false,
      });
      expect(await presence.setScreen(a.workspaceId, hidden, false, sec(20))).toBe(true);
      expect(await lease(hidden)).toMatchObject({ on_screen: false, last_on_screen_at: null });
      // A tab that already left at 20 s: a repeated off frame keeps the time it left.
      const left = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        onScreen: false,
        lastOnScreenAt: sec(20),
      });
      await presence.setScreen(a.workspaceId, left, false, sec(40));
      expect(await lease(left)).toMatchObject({ on_screen: false, last_on_screen_at: sec(20) });
    });

    it('an off frame with hidden_since stamps it only on a lease with no on-screen history (R3, D1)', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const fresh = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(100),
        onScreen: false,
      });
      expect(await presence.setScreen(b.workspaceId, fresh, false, sec(120), sec(40))).toBe(false);
      expect(await lease(fresh)).toMatchObject({ last_on_screen_at: null });
      expect(await presence.setScreen(a.workspaceId, fresh, false, sec(120), sec(40))).toBe(true);
      expect(await lease(fresh)).toMatchObject({ on_screen: false, last_on_screen_at: sec(40) });
      // History now: a later claim keeps the stamped time.
      await presence.setScreen(a.workspaceId, fresh, false, sec(130), sec(90));
      expect(await lease(fresh)).toMatchObject({ last_on_screen_at: sec(40) });
      const left = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        onScreen: false,
        lastOnScreenAt: sec(20),
      });
      await presence.setScreen(a.workspaceId, left, false, sec(120), sec(10));
      expect(await lease(left)).toMatchObject({ last_on_screen_at: sec(20) });
    });

    it('close deletes the lease, only inside its workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const id = await insertPresence(db, { workspaceId: a.workspaceId, accountId });
      expect(await presence.close(b.workspaceId, id)).toBe(false);
      expect(await lease(id)).toBeDefined();
      expect(await presence.close(a.workspaceId, id)).toBe(true);
      expect(await lease(id)).toBeUndefined();
      expect(await presence.close(a.workspaceId, id)).toBe(false);
    });

    it('deleteExpired removes expired leases of the workspace, of one member when given, and keeps live ones and other workspaces', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const { accountId: mate } = await insertMembership(db, a.workspaceId);
      const mine = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(50),
      });
      const mates = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId: mate,
        openedAt: sec(0),
        liveUntil: sec(50),
      });
      const alive = await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(500),
      });
      const foreign = await insertPresence(db, {
        workspaceId: b.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(50),
      });
      expect(await presence.deleteExpired(a.workspaceId, sec(100), accountId)).toBe(1);
      expect(await lease(mine)).toBeUndefined();
      expect(await lease(mates)).toBeDefined();
      expect(await lease(alive)).toBeDefined();
      expect(await lease(foreign)).toBeDefined();
      expect(await presence.deleteExpired(a.workspaceId, sec(100))).toBe(1);
      expect(await lease(mates)).toBeUndefined();
      expect(await lease(foreign)).toBeDefined();
    });

    it('listLive returns the live leases by member, optionally for given members, never expired ones or another workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const { accountId: mate } = await insertMembership(db, a.workspaceId);
      await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(500),
        onScreen: false,
        lastOnScreenAt: sec(10),
      });
      await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(40),
      });
      await insertPresence(db, {
        workspaceId: a.workspaceId,
        accountId: mate,
        openedAt: sec(0),
        liveUntil: sec(500),
      });
      await insertPresence(db, {
        workspaceId: b.workspaceId,
        accountId,
        openedAt: sec(0),
        liveUntil: sec(500),
      });
      const all = await presence.listLive(a.workspaceId, sec(100));
      expect([...all.keys()].sort()).toEqual([accountId, mate].sort());
      expect(all.get(accountId)).toEqual([
        { liveUntil: sec(500), onScreen: false, lastOnScreenAt: sec(10) },
      ]);
      const only = await presence.listLive(a.workspaceId, sec(100), [mate]);
      expect([...only.keys()]).toEqual([mate]);
      expect((await presence.listLive(b.workspaceId, sec(100))).get(accountId)).toHaveLength(1);
      expect((await presence.listLive(await insertWorkspace(db), sec(100))).size).toBe(0);
    });
  });

  describe('pingRepo', () => {
    it('insertWithItems stores a sending ping with its items and its ledger rows', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      const c1 = await conversation(a.workspaceId);
      const c2 = await conversation(a.workspaceId);
      const id = newId();
      const out = await tx((t) =>
        pings.insertWithItems(
          a.workspaceId,
          { id, accountId, telegramLinkId: a.linkId, createdAt: sec(0) },
          [
            { conversationId: c1, waitingSince: sec(-300) },
            { conversationId: c2, waitingSince: sec(-400) },
          ],
          t,
        ),
      );
      expect(out).toBe('inserted');
      expect(
        await db.selectFrom('pings').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
      ).toMatchObject({ outcome: 'sending', account_id: accountId, opened_at: null });
      const ledger = await pings.ledger(a.workspaceId, [
        { conversationId: c1, waitingSince: sec(-300) },
        { conversationId: c2, waitingSince: sec(-400) },
        { conversationId: c2, waitingSince: sec(-300) },
      ]);
      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(
        expect.arrayContaining([
          { conversationId: c1, waitingSince: sec(-300), accountId },
          { conversationId: c2, waitingSince: sec(-400), accountId },
        ]),
      );
    });

    it('a second ping for the same conversation, period and member is lost and leaves nothing behind', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      const c1 = await conversation(a.workspaceId);
      const c2 = await conversation(a.workspaceId);
      const winner = newId();
      await tx((t) =>
        pings.insertWithItems(
          a.workspaceId,
          { id: winner, accountId, telegramLinkId: a.linkId, createdAt: sec(0) },
          [{ conversationId: c1, waitingSince: sec(-300) }],
          t,
        ),
      );
      const loser = newId();
      const out = await tx((t) =>
        pings.insertWithItems(
          a.workspaceId,
          { id: loser, accountId, telegramLinkId: a.linkId, createdAt: sec(1) },
          [
            { conversationId: c2, waitingSince: sec(-200) },
            { conversationId: c1, waitingSince: sec(-300) },
          ],
          t,
        ),
      );
      expect(out).toBe('lost');
      expect(await db.selectFrom('pings').select('id').where('id', '=', loser).execute()).toEqual(
        [],
      );
      expect(
        await pings.ledger(a.workspaceId, [{ conversationId: c2, waitingSince: sec(-200) }]),
      ).toEqual([]);
    });

    it('two workers inserting the same period concurrently: exactly one inserts, the other is lost', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      const c = await conversation(a.workspaceId);
      const results = await Promise.all(
        [0, 1].map((i) =>
          tx<'inserted' | 'lost'>((t) =>
            pings.insertWithItems(
              a.workspaceId,
              { id: newId(), accountId, telegramLinkId: a.linkId, createdAt: sec(i) },
              [{ conversationId: c, waitingSince: sec(-300) }],
              t,
            ),
          ),
        ),
      );
      expect(results.sort()).toEqual(['inserted', 'lost']);
      expect(
        await db.selectFrom('ping_items').select('id').where('conversation_id', '=', c).execute(),
      ).toHaveLength(1);
    });

    it('the same period may be pinged to another member', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      const { accountId: mate } = await insertMembership(db, a.workspaceId);
      const mateLink = (
        await insertTelegramLink(db, { workspaceId: a.workspaceId, accountId: mate })
      ).id;
      const c = await conversation(a.workspaceId);
      const item = [{ conversationId: c, waitingSince: sec(-300) }];
      const first = await tx((t) =>
        pings.insertWithItems(
          a.workspaceId,
          { id: newId(), accountId, telegramLinkId: a.linkId, createdAt: sec(0) },
          item,
          t,
        ),
      );
      const second = await tx((t) =>
        pings.insertWithItems(
          a.workspaceId,
          { id: newId(), accountId: mate, telegramLinkId: mateLink, createdAt: sec(0) },
          item,
          t,
        ),
      );
      expect([first, second]).toEqual(['inserted', 'inserted']);
      expect(await pings.ledger(a.workspaceId, item)).toHaveLength(2);
    });

    it('ledger reads the workspace only and takes no periods gracefully', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const ca = await conversation(a.workspaceId);
      await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        items: [{ conversationId: ca, waitingSince: sec(-300) }],
      });
      const period = [{ conversationId: ca, waitingSince: sec(-300) }];
      expect(await pings.ledger(a.workspaceId, period)).toHaveLength(1);
      expect(await pings.ledger(b.workspaceId, period)).toEqual([]);
      expect(await pings.ledger(a.workspaceId, [])).toEqual([]);
    });

    it('lastPingAt is the member’s newest ping in the workspace, not another workspace’s or member’s', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      expect(await pings.lastPingAt(a.workspaceId, accountId)).toBeNull();
      await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        createdAt: min(1),
      });
      await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        createdAt: min(5),
        outcome: 'failed',
      });
      await insertPing(db, {
        workspaceId: b.workspaceId,
        accountId,
        telegramLinkId: b.linkId,
        createdAt: min(9),
      });
      expect(await pings.lastPingAt(a.workspaceId, accountId)).toEqual(min(5));
      expect(await pings.lastPingAt(b.workspaceId, accountId)).toEqual(min(9));
      expect(await pings.lastPingAt(a.workspaceId, newId())).toBeNull();
    });

    it('setOutcome writes the outcome of the ping in its workspace only', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const { id } = await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        outcome: 'sending',
      });
      expect(await pings.setOutcome(b.workspaceId, id, 'accepted')).toBe(false);
      const outcome = () =>
        db.selectFrom('pings').select('outcome').where('id', '=', id).executeTakeFirstOrThrow();
      expect((await outcome()).outcome).toBe('sending');
      expect(await pings.setOutcome(a.workspaceId, id, 'blocked')).toBe(true);
      expect((await outcome()).outcome).toBe('blocked');
    });

    it('rollOut deletes the ping with its items so the conversations are due again; only inside its workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const c = await conversation(a.workspaceId);
      const { id } = await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        outcome: 'sending',
        items: [{ conversationId: c, waitingSince: sec(-300) }],
      });
      expect(await pings.rollOut(b.workspaceId, id)).toBe(false);
      expect(
        await pings.ledger(a.workspaceId, [{ conversationId: c, waitingSince: sec(-300) }]),
      ).toHaveLength(1);
      expect(await pings.rollOut(a.workspaceId, id)).toBe(true);
      expect(
        await pings.ledger(a.workspaceId, [{ conversationId: c, waitingSince: sec(-300) }]),
      ).toEqual([]);
      expect(
        await db.selectFrom('ping_items').select('id').where('ping_id', '=', id).execute(),
      ).toEqual([]);
      expect(await db.selectFrom('pings').select('id').where('id', '=', id).execute()).toEqual([]);
    });

    it('markOpened marks the member’s newest delivered ping when it is within 15 minutes, once; not older, not failed, not another workspace', async () => {
      const { accountId, a, b } = await twoWorkspacesWithLinks(db);
      const old = await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        createdAt: min(0),
      });
      const opened = (id: string) =>
        db.selectFrom('pings').select('opened_at').where('id', '=', id).executeTakeFirstOrThrow();
      expect(await pings.markOpened(a.workspaceId, accountId, min(16))).toBe(false);
      expect((await opened(old.id)).opened_at).toBeNull();
      expect(await pings.markOpened(b.workspaceId, accountId, min(10))).toBe(false);
      expect(await pings.markOpened(a.workspaceId, accountId, min(10))).toBe(true);
      expect((await opened(old.id)).opened_at).toEqual(min(10));
      expect(await pings.markOpened(a.workspaceId, accountId, min(12))).toBe(false);
      expect((await opened(old.id)).opened_at).toEqual(min(10));
      const failed = await insertPing(db, {
        workspaceId: a.workspaceId,
        accountId,
        telegramLinkId: a.linkId,
        createdAt: min(20),
        outcome: 'failed',
      });
      expect(await pings.markOpened(a.workspaceId, accountId, min(21))).toBe(false);
      expect((await opened(failed.id)).opened_at).toBeNull();
    });
  });
});
