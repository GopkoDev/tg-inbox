import type { Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import type { DB } from '../../../platform/db.types.gen.js';
import { newId } from '../../../platform/ids.js';
import { createContactAudiences } from '../../contacts/app/audiences.js';
import { createAudienceQuery } from '../../contacts/infra/audience-query.js';
import { createTagRepo } from '../../contacts/infra/tag-repo.js';
import {
  insertBroadcast,
  launchBroadcastFixture,
  twoWorkspacesWithBroadcasts,
  type FixtureRecipient,
} from '../../../test/fixtures/broadcasts.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createRecipientRepo } from '../infra/recipient-repo.js';
import { createBroadcastSignals } from '../infra/signals.js';
import { createBroadcastReads } from './reads.js';
import { createSettle, type Settle } from './settle.js';
import { createStopBroadcast, type StopBroadcast } from './stop.js';

const NOW = new Date('2026-10-23T09:10:00Z');
let nextTelegramUserId = 7_000_000_000;

describe('stop and settle (Postgres; AC-11, AC-12, AC-18)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let settle: Settle;
  let stop: StopBroadcast;
  let recipients: ReturnType<typeof createRecipientRepo>;
  let broadcasts: ReturnType<typeof createBroadcastRepo>;
  const jobs: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), { clock: fixedClock(NOW) });
    const { db } = deps;
    broadcasts = createBroadcastRepo(db);
    recipients = createRecipientRepo(db);
    const audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    const transaction = <T>(fn: (tx: typeof db) => Promise<T>) => db.transaction().execute(fn);
    settle = createSettle({
      transaction,
      broadcasts,
      recipients,
      signals: createBroadcastSignals(),
      jobs: {
        // The pg-boss queue is wired by T24; this records each enqueue made in the transaction.
        async enqueueBlockedShare(_tx, workspaceId, broadcastId, startAfter) {
          jobs.push(`${workspaceId}:${broadcastId}@${startAfter.toISOString()}`);
        },
      },
      clock: deps.clock,
    });
    const reads = createBroadcastReads({
      broadcasts,
      audienceTags: createAudienceTagRepo(db),
      groups: createGroupRepo(db),
      recipients,
      contacts: {
        resolveTags: async () => [],
        audienceBreakdown: audiences.audienceBreakdown,
        contactCards: audiences.contactCards,
      },
      bots: { launchReadiness: async () => null },
      workspaces: { displayNames: deps.workspaceAccess.displayNames },
    });
    stop = createStopBroadcast({
      transaction,
      broadcasts,
      workspaces: {
        lockActiveMembers: (tx, workspaceId, accountIds) =>
          deps.workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
      },
      settle,
      views: { broadcastView: reads.getBroadcast },
    });
  }, 120_000);

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  /** A sending broadcast of `a` with `n` new contacts as recipients in the given states. */
  async function sendingWith(
    a: { workspaceId: string; ownerAccountId: string; telegramBotId: bigint },
    states: Array<FixtureRecipient['state']>,
  ) {
    const rows = states.map(() => ({
      id: newId(),
      workspace_id: a.workspaceId,
      telegram_user_id: String(nextTelegramUserId++),
      first_name: 'Bulk',
      last_name: null,
      username: null,
      language_code: 'en',
      profile_seen_at: NOW,
      created_at: NOW,
    }));
    for (let i = 0; i < rows.length; i += 2000) {
      await deps.db
        .insertInto('contacts')
        .values(rows.slice(i, i + 2000))
        .execute();
    }
    const id = await insertBroadcast(deps.db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.ownerAccountId,
    });
    const inserted = await launchBroadcastFixture(deps.db, {
      broadcast: id,
      launchedByAccountId: a.ownerAccountId,
      telegramBotId: a.telegramBotId,
      recipients: rows.map((r, i) => ({ contactId: r.id, state: states[i] })),
    });
    return { id, recipients: inserted };
  }

  const owner = (a: { ownerAccountId: string }) => ({
    accountId: a.ownerAccountId,
    role: 'owner' as const,
  });

  it('AC-18: 1 200 with an outcome, the rest waiting — the stop settles every waiting one as stopped', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const states = [
      ...Array<FixtureRecipient['state']>(1_200).fill('delivered'),
      'sending' as const,
      ...Array<FixtureRecipient['state']>(299).fill('waiting'),
    ];
    const { id } = await sendingWith(a, states);
    const got = await stop.stopBroadcast(a.workspaceId, owner(a), id);
    expect(got.outcome).toBe('stopped');
    expect(got.broadcast).toMatchObject({
      status: 'stopped',
      stopped_by: { account_id: a.ownerAccountId },
      stopped_at: NOW.toISOString(),
      ended_at: NOW.toISOString(),
      end_reason: 'stopped',
    });
    expect(await recipients.totals(a.workspaceId, id)).toMatchObject({
      delivered: 1_200,
      sending: 1,
      stopped: 299,
      waiting: 0,
    });
    // The in-flight send still records its outcome after the stop.
    const [inFlight] = (await recipients.page(a.workspaceId, id, { state: 'sending' }, 1)).rows;
    expect(
      await recipients.recordOutcome(
        a.workspaceId,
        inFlight!.id,
        { state: 'delivered', telegramMessageId: 5n },
        new Date(NOW.getTime() + 1000),
      ),
    ).toBe(true);
    // A second stop is unchanged; the stopped broadcast is never finished or aborted.
    expect((await stop.stopBroadcast(a.workspaceId, owner(a), id)).outcome).toBe('unchanged');
    expect(await settle.finishIfDone(a.workspaceId, id)).toBe(false);
    expect(await settle.abort(a.workspaceId, id, 'text_refused')).toBe(false);
    expect(jobs.filter((j) => j.startsWith(`${a.workspaceId}:${id}@`))).toEqual([
      `${a.workspaceId}:${id}@${new Date(NOW.getTime() + 48 * 3_600_000).toISOString()}`,
    ]);
  }, 60_000);

  it('a claim racing the stop: either the claim or the settle wins, never both', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    for (let round = 0; round < 5; round += 1) {
      const { id, recipients: rs } = await sendingWith(a, ['waiting', 'waiting']);
      const target = rs[0]!.id;
      const [claimed] = await Promise.all([
        recipients.claim(a.workspaceId, target, NOW),
        stop.stopBroadcast(a.workspaceId, owner(a), id),
      ]);
      const [row] = (await recipients.page(a.workspaceId, id, {}, 1)).rows;
      expect(row!.state).toBe(claimed ? 'sending' : 'stopped');
      expect((await broadcasts.find(a.workspaceId, id))!.status).toBe('stopped');
    }
  });

  it('a stop after the last outcome answers unchanged and the broadcast is sent', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const { id } = await sendingWith(a, ['delivered', 'blocked']);
    const got = await stop.stopBroadcast(a.workspaceId, owner(a), id);
    expect(got).toMatchObject({
      outcome: 'unchanged',
      broadcast: { status: 'sent', end_reason: 'completed', stopped_by: null },
    });
  });

  it('AC-12: an abort fails every waiting recipient with the reason and ends the broadcast sent', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const { id } = await sendingWith(a, ['delivered', 'sending', 'waiting', 'waiting']);
    expect(await settle.abort(a.workspaceId, id, 'text_refused')).toBe(true);
    expect(await recipients.totals(a.workspaceId, id)).toMatchObject({
      delivered: 1,
      sending: 1,
      failed: 2,
      waiting: 0,
    });
    expect(await broadcasts.find(a.workspaceId, id)).toMatchObject({
      status: 'sent',
      endReason: 'text_refused',
      endedAt: NOW,
    });
    // An operator cannot stop; a foreign workspace cannot see it.
    await expect(
      stop.stopBroadcast(a.workspaceId, { accountId: a.operatorAccountId, role: 'operator' }, id),
    ).rejects.toMatchObject({ code: 'OWNER_ONLY' });
  });

  it('a deactivated owner cannot stop; a broadcast of another workspace is not found', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(deps.db);
    await expect(stop.stopBroadcast(a.workspaceId, owner(a), b.launchedId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await broadcasts.find(b.workspaceId, b.launchedId))!.status).toBe('sending');
    await deps.db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: NOW })
      .where('workspace_id', '=', a.workspaceId)
      .where('account_id', '=', a.ownerAccountId)
      .execute();
    await expect(stop.stopBroadcast(a.workspaceId, owner(a), a.launchedId)).rejects.toMatchObject({
      code: 'ACCESS_REMOVED',
    });
    expect((await recipients.totals(a.workspaceId, a.launchedId)).waiting).toBe(2);
  });
});
