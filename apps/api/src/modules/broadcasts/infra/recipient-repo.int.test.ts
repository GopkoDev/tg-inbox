import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import {
  insertBroadcast,
  launchBroadcastFixture,
  twoWorkspacesWithBroadcasts,
  type FixtureRecipient,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createRecipientRepo } from './recipient-repo.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('broadcast recipient repository (ADR-0007, ADR-0009)', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createRecipientRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    repo = createRecipientRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  const rowOf = (id: string) =>
    db
      .selectFrom('broadcast_recipients')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** A launched broadcast in workspace `w` with one recipient per given state (new contacts). */
  async function launched(
    w: { workspaceId: string; ownerAccountId: string; telegramBotId: bigint },
    recipients: Omit<FixtureRecipient, 'contactId'>[],
  ) {
    const broadcastId = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
    });
    const withContacts: FixtureRecipient[] = [];
    for (const r of recipients) {
      withContacts.push({
        ...r,
        contactId: await insertContact(db, { workspaceId: w.workspaceId }),
      });
    }
    const rows = await launchBroadcastFixture(db, {
      broadcast: broadcastId,
      launchedByAccountId: w.ownerAccountId,
      telegramBotId: w.telegramBotId,
      recipients: withContacts,
    });
    const stateOf = new Map(withContacts.map((r) => [r.contactId, r]));
    return {
      broadcastId,
      rows: rows.map((r) => ({ ...r, ...stateOf.get(r.contactId)! })),
    };
  }

  it('inserts 10 000 recipients in one statement with positions 1…n', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const broadcastId = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.ownerAccountId,
    });
    // The repository writes rows only; the launch transaction (T20) moves the broadcast itself.
    const base = 5_000_000n;
    const contacts = await db
      .insertInto('contacts')
      .values(
        Array.from({ length: 10_000 }, (_, i) => ({
          id: newId(),
          workspace_id: a.workspaceId,
          telegram_user_id: String(base + BigInt(i)),
          first_name: 'Test User',
          profile_seen_at: T0,
          created_at: T0,
        })),
      )
      .returning(['id', 'telegram_user_id'])
      .execute();
    const sorted = [...contacts].sort((x, y) => (x.id < y.id ? -1 : 1));
    let statements = 0;
    const counter: KyselyPlugin = {
      transformQuery: (args) => {
        statements++;
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
    const counted = createRecipientRepo(db.withPlugin(counter));
    await inTx((tx) =>
      counted.insertAll(
        a.workspaceId,
        broadcastId,
        sorted.map((c, i) => ({
          id: newId(),
          contactId: c.id,
          position: i + 1,
          telegramUserId: BigInt(c.telegram_user_id),
        })),
        tx.withPlugin(counter),
      ),
    );
    expect(statements).toBe(1);
    const stored = await db
      .selectFrom('broadcast_recipients')
      .select(['contact_id', 'position', 'state'])
      .where('workspace_id', '=', a.workspaceId)
      .where('broadcast_id', '=', broadcastId)
      .orderBy('position')
      .execute();
    expect(stored).toHaveLength(10_000);
    expect(stored[0]).toEqual({ contact_id: sorted[0]!.id, position: 1, state: 'waiting' });
    expect(stored.at(-1)).toEqual({
      contact_id: sorted.at(-1)!.id,
      position: 10_000,
      state: 'waiting',
    });
    expect(await repo.allContactIds(a.workspaceId, broadcastId)).toEqual(sorted.map((c) => c.id));
  });

  it('claims a waiting recipient exactly once under two concurrent claimers', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const id = a.recipientIds[0]!;
    const results = await Promise.all([
      inTx((tx) => repo.claim(a.workspaceId, id, at(1), tx)),
      inTx((tx) => repo.claim(a.workspaceId, id, at(2), tx)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rowOf(id)).toMatchObject({ state: 'sending' });
    expect(await repo.claim(a.workspaceId, id, at(3))).toBe(false);
  });

  it('records outcomes from sending, and blocked straight from waiting at the turn', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const { rows } = await launched(a, [{}, {}, {}, {}, {}]);
    const [d, f, n, w, b] = rows.map((r) => r.id);
    for (const id of [d!, f!, n!]) await repo.claim(a.workspaceId, id, at(1));
    expect(
      await repo.recordOutcome(
        a.workspaceId,
        d!,
        { state: 'delivered', telegramMessageId: 77n },
        at(2),
      ),
    ).toBe(true);
    expect(await rowOf(d!)).toMatchObject({
      state: 'delivered',
      telegram_message_id: '77',
      claimed_at: at(1),
      outcome_at: at(2),
      failure_reason: null,
    });
    await repo.recordOutcome(
      a.workspaceId,
      f!,
      { state: 'failed', reason: 'chat_not_found' },
      at(2),
    );
    expect(await rowOf(f!)).toMatchObject({ state: 'failed', failure_reason: 'chat_not_found' });
    await repo.recordOutcome(a.workspaceId, n!, { state: 'not_confirmed' }, at(2));
    expect(await rowOf(n!)).toMatchObject({
      state: 'not_confirmed',
      claimed_at: at(1),
      outcome_at: at(2),
    });
    // Blocked at the turn: never claimed.
    expect(await repo.recordOutcome(a.workspaceId, b!, { state: 'blocked' }, at(3))).toBe(true);
    expect(await rowOf(b!)).toMatchObject({
      state: 'blocked',
      claimed_at: null,
      outcome_at: at(3),
    });
    // Any other outcome needs a claim; a recorded one is never recorded again.
    expect(
      await repo.recordOutcome(
        a.workspaceId,
        w!,
        { state: 'delivered', telegramMessageId: 1n },
        at(3),
      ),
    ).toBe(false);
    expect(await repo.recordOutcome(a.workspaceId, d!, { state: 'not_confirmed' }, at(4))).toBe(
      false,
    );
    expect(await rowOf(w!)).toMatchObject({ state: 'waiting' });
  });

  it('puts a rate-limited recipient back to waiting with claimed_at cleared', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const id = a.recipientIds[0]!;
    await repo.claim(a.workspaceId, id, at(1));
    expect(await repo.backToWaiting(a.workspaceId, id)).toBe(true);
    expect(await rowOf(id)).toMatchObject({ state: 'waiting', claimed_at: null, outcome_at: null });
    expect(await repo.backToWaiting(a.workspaceId, id)).toBe(false);
  });

  it('resolves stale in-flight recipients as not confirmed, keeping claimed_at', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const one = await launched(a, [
      { state: 'sending', claimedAt: at(1) },
      {},
      { state: 'delivered' },
    ]);
    const two = await launched(a, [{ state: 'sending', claimedAt: at(2) }]);
    const other = await launched(a, [{ state: 'sending', claimedAt: at(3) }]);
    const resolved = await inTx((tx) =>
      repo.resolveStaleInFlight(a.workspaceId, [one.broadcastId, two.broadcastId], at(10), tx),
    );
    expect(resolved).toHaveLength(2);
    expect(resolved).toEqual(
      expect.arrayContaining([
        {
          id: one.rows[0]!.id,
          broadcastId: one.broadcastId,
          contactId: one.rows[0]!.contactId,
          claimedAt: at(1),
        },
        {
          id: two.rows[0]!.id,
          broadcastId: two.broadcastId,
          contactId: two.rows[0]!.contactId,
          claimedAt: at(2),
        },
      ]),
    );
    expect(await rowOf(one.rows[0]!.id)).toMatchObject({
      state: 'not_confirmed',
      claimed_at: at(1),
      outcome_at: at(10),
    });
    expect(await rowOf(one.rows[1]!.id)).toMatchObject({ state: 'waiting' });
    expect(await rowOf(other.rows[0]!.id)).toMatchObject({ state: 'sending' });
  });

  it('settles only waiting recipients, as stopped or failed with the reason', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const stop = await launched(a, [{}, {}, { state: 'sending' }, { state: 'delivered' }]);
    expect(
      await inTx((tx) =>
        repo.settleWaiting(a.workspaceId, stop.broadcastId, { state: 'stopped' }, at(5), tx),
      ),
    ).toBe(2);
    const states = async (broadcastId: string) =>
      (
        await db
          .selectFrom('broadcast_recipients')
          .select(['state', 'failure_reason', 'outcome_at', 'claimed_at'])
          .where('broadcast_id', '=', broadcastId)
          .orderBy('position')
          .execute()
      ).map((r) => r.state);
    expect((await states(stop.broadcastId)).sort()).toEqual([
      'delivered',
      'sending',
      'stopped',
      'stopped',
    ]);
    const abort = await launched(a, [{}, { state: 'blocked' }]);
    expect(
      await inTx((tx) =>
        repo.settleWaiting(
          a.workspaceId,
          abort.broadcastId,
          { state: 'failed', reason: 'text_refused' },
          at(6),
          tx,
        ),
      ),
    ).toBe(1);
    expect(await rowOf(abort.rows.find((r) => r.state === undefined)!.id)).toMatchObject({
      state: 'failed',
      failure_reason: 'text_refused',
      outcome_at: at(6),
    });
  });

  it('reads totals, pages by position, the next waiting and whether any is left', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const { broadcastId, rows } = await launched(a, [
      { state: 'delivered' },
      {},
      { state: 'failed', failureReason: 'account_gone' },
      {},
      { state: 'blocked' },
    ]);
    expect(await repo.totals(a.workspaceId, broadcastId)).toEqual({
      waiting: 2,
      sending: 0,
      delivered: 1,
      blocked: 1,
      failed: 1,
      not_confirmed: 0,
      stopped: 0,
    });
    const first = await repo.page(a.workspaceId, broadcastId, {}, 2);
    expect(first.rows.map((r) => r.position)).toEqual([1, 2]);
    expect(first.hasNext).toBe(true);
    const rest = await repo.page(a.workspaceId, broadcastId, { after: 2 }, 50);
    expect(rest.rows.map((r) => r.position)).toEqual([3, 4, 5]);
    expect(rest.hasNext).toBe(false);
    const waiting = await repo.page(a.workspaceId, broadcastId, { state: 'waiting' }, 50);
    expect(waiting.rows.map((r) => r.state)).toEqual(['waiting', 'waiting']);
    expect(waiting.rows[0]).toMatchObject({
      contactId: expect.any(String),
      telegramUserId: expect.any(BigInt),
      failureReason: null,
    });
    const lowest = Math.min(...rows.filter((r) => r.state === undefined).map((r) => r.position));
    expect((await repo.nextWaiting(a.workspaceId, broadcastId))!.position).toBe(lowest);
    expect(await repo.hasWaitingOrInFlight(a.workspaceId, broadcastId)).toBe(true);
    await inTx((tx) =>
      repo.settleWaiting(a.workspaceId, broadcastId, { state: 'stopped' }, at(9), tx),
    );
    expect(await repo.nextWaiting(a.workspaceId, broadcastId)).toBeNull();
    expect(await repo.hasWaitingOrInFlight(a.workspaceId, broadcastId)).toBe(false);
  });

  it('the duplicate sets: "did not reach" is the fixable reasons plus stopped (plus not confirmed when asked)', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const { broadcastId, rows } = await launched(a, [
      { state: 'delivered' },
      { state: 'blocked' },
      { state: 'failed', failureReason: 'account_gone' },
      { state: 'failed', failureReason: 'chat_not_found' },
      { state: 'failed', failureReason: 'telegram_error' },
      { state: 'failed', failureReason: 'text_refused' },
      { state: 'failed', failureReason: 'bot_stopped' },
      { state: 'stopped' },
      { state: 'not_confirmed' },
    ]);
    const idsWhere = (pick: (r: (typeof rows)[number]) => boolean) =>
      rows
        .filter(pick)
        .map((r) => r.contactId)
        .sort();
    const fixable = (r: (typeof rows)[number]) =>
      r.state === 'stopped' ||
      (r.state === 'failed' &&
        ['telegram_error', 'text_refused', 'bot_stopped'].includes(r.failureReason!));
    expect(await repo.notReachedContactIds(a.workspaceId, broadcastId, false)).toEqual(
      idsWhere(fixable),
    );
    expect(await repo.notReachedContactIds(a.workspaceId, broadcastId, true)).toEqual(
      idsWhere((r) => fixable(r) || r.state === 'not_confirmed'),
    );
    expect(await repo.deliveredContactIds(a.workspaceId, broadcastId)).toEqual(
      idsWhere((r) => r.state === 'delivered'),
    );
    expect(await repo.allContactIds(a.workspaceId, broadcastId)).toEqual(idsWhere(() => true));
  });

  it('is scoped by workspace: a foreign id reads nothing and changes nothing', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const id = b.recipientIds[0]!;
    expect(await repo.claim(a.workspaceId, id, at(1))).toBe(false);
    expect(await repo.recordOutcome(a.workspaceId, id, { state: 'blocked' }, at(1))).toBe(false);
    expect(await repo.backToWaiting(a.workspaceId, id)).toBe(false);
    expect(
      await inTx((tx) => repo.resolveStaleInFlight(a.workspaceId, [b.launchedId], at(1), tx)),
    ).toEqual([]);
    expect(
      await inTx((tx) =>
        repo.settleWaiting(a.workspaceId, b.launchedId, { state: 'stopped' }, at(1), tx),
      ),
    ).toBe(0);
    expect(
      Object.values(await repo.totals(a.workspaceId, b.launchedId)).every((n) => n === 0),
    ).toBe(true);
    expect((await repo.page(a.workspaceId, b.launchedId, {}, 50)).rows).toEqual([]);
    expect(await repo.nextWaiting(a.workspaceId, b.launchedId)).toBeNull();
    expect(await repo.hasWaitingOrInFlight(a.workspaceId, b.launchedId)).toBe(false);
    expect(await repo.allContactIds(a.workspaceId, b.launchedId)).toEqual([]);
    expect(await repo.notReachedContactIds(a.workspaceId, b.launchedId, true)).toEqual([]);
    expect(await repo.deliveredContactIds(a.workspaceId, b.launchedId)).toEqual([]);
    expect(await repo.totals(b.workspaceId, b.launchedId)).toMatchObject({ waiting: 2 });
    // A recipient naming a contact of another workspace is refused by the composite foreign key.
    await expect(
      inTx((tx) =>
        repo.insertAll(
          a.workspaceId,
          a.launchedId,
          [{ id: newId(), contactId: b.taggedContactId, position: 99, telegramUserId: 1n }],
          tx,
        ),
      ),
    ).rejects.toThrow(/broadcast_recipients_contact_fkey/);
  });
});
