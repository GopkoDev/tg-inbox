import type { Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import type { DB } from '../../../platform/db.types.gen.js';
import { insertConnectLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createWorkspaceAccess } from '../../workspaces/app/access.js';
import { createTeam } from '../../workspaces/app/team.js';
import { KyselyUnitOfWork } from '../../workspaces/infra/unit-of-work.js';
import { createConnectLinkRepo } from '../infra/connect-link-repo.js';
import { createTelegramLinkRepo } from '../infra/telegram-link-repo.js';
import type { BotMessage } from './ports.js';
import { createRedeem, type RedeemOutcome } from './redeem.js';

const NOW = new Date('2026-10-11T10:05:00Z');
const BOT = 7001n;

describe('redeem (Postgres): uniqueness races and deactivation lock order', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 20 });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  function build() {
    const links = createTelegramLinkRepo(db);
    const connectLinks = createConnectLinkRepo(db);
    const clock = fixedClock(NOW);
    const uow = new KyselyUnitOfWork(db);
    const access = createWorkspaceAccess({
      uow,
      clock,
      auth: { getAccount: async () => undefined, getAccountsByIds: async () => [] },
    });
    const signals: { workspaceId: string; accountId: string }[] = [];
    const jobs: { workspaceId: string; message: BotMessage }[] = [];
    const redeem = createRedeem({
      transaction: (fn) => db.transaction().execute((tx) => fn(tx)),
      membership: {
        lockActiveMembers: (tx, workspaceId, accountIds) =>
          access.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
      },
      links,
      connectLinks,
      signals: {
        telegramLinkChanged: async (_tx, workspaceId, accountId) => {
          signals.push({ workspaceId, accountId });
        },
      },
      enqueue: async (_tx, workspaceId, message) => {
        jobs.push({ workspaceId, message });
      },
      clock,
    });
    // What the notifications part of the deactivation transaction does (T20): after the membership
    // update, replace the member's unused connect links and remove their live link.
    const team = createTeam({
      uow,
      clock,
      accounts: { findAccountIdByEmail: async () => undefined, getAccountsByIds: async () => [] },
      publish: async () => {},
      onMembershipDeactivated: async (tx, { workspaceId, accountId, at }) => {
        await connectLinks.markUnusedReplaced(workspaceId, accountId, at, tx);
        const link = await links.findLiveByAccount(workspaceId, accountId, { lock: true }, tx);
        if (link) await links.remove(workspaceId, link.id, 'deactivated', at, tx);
      },
      publicWebUrl: 'https://inbox.example.test',
    });
    const go = (
      workspaceId: string,
      token: string,
      telegramUserId: bigint,
    ): Promise<RedeemOutcome> =>
      redeem.redeem({
        workspaceId,
        telegramBotId: BOT,
        from: { id: telegramUserId, displayName: 'Test User' },
        token,
        at: NOW,
      });
    return { links, connectLinks, signals, jobs, team, go };
  }

  const member = async (workspaceId: string) => {
    const m = await insertMembership(db, workspaceId);
    const link = await insertConnectLink(db, { workspaceId, accountId: m.accountId });
    return { ...m, token: link.token, connectLinkId: link.id };
  };
  const liveLinks = (workspaceId: string) =>
    db
      .selectFrom('telegram_links')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('removed_at', 'is', null)
      .execute();

  it('links the issued membership with the bot id and uses the link up', async () => {
    const { go, signals } = build();
    const ws = await insertWorkspace(db);
    const a = await member(ws);
    expect(await go(ws, a.token, 4001n)).toEqual({ outcome: 'linked' });
    const [row] = await liveLinks(ws);
    expect(row).toMatchObject({
      account_id: a.accountId,
      telegram_user_id: '4001',
      display_name: 'Test User',
    });
    expect(row!.telegram_bot_id).toBe(String(BOT));
    const used = await db
      .selectFrom('connect_links')
      .select('used_at')
      .where('id', '=', a.connectLinkId)
      .executeTakeFirstOrThrow();
    expect(used.used_at).toEqual(NOW);
    expect(signals).toEqual([{ workspaceId: ws, accountId: a.accountId }]);
    expect(await go(ws, a.token, 4001n)).toEqual({ outcome: 'link_expired' });
  });

  it('two members redeem from the same Telegram account at once: one links, one is told why', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { go } = build();
      const ws = await insertWorkspace(db);
      const [a, b] = [await member(ws), await member(ws)];
      const outcomes = await Promise.all([go(ws, a.token, 4100n), go(ws, b.token, 4100n)]);
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(['cannot_connect', 'linked']);
      expect(outcomes.find((o) => o.outcome === 'cannot_connect')).toEqual({
        outcome: 'cannot_connect',
        reason: 'telegram_linked_to_teammate',
      });
      expect(await liveLinks(ws)).toHaveLength(1);
    }
  });

  it('two Telegram accounts redeem two links of one member at once: one links, one is told why', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { go } = build();
      const ws = await insertWorkspace(db);
      const a = await member(ws);
      const second = await insertConnectLink(db, { workspaceId: ws, accountId: a.accountId });
      const outcomes = await Promise.all([go(ws, a.token, 4201n), go(ws, second.token, 4202n)]);
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(['cannot_connect', 'linked']);
      expect(outcomes.find((o) => o.outcome === 'cannot_connect')).toEqual({
        outcome: 'cannot_connect',
        reason: 'member_linked_elsewhere',
      });
      expect(await liveLinks(ws)).toHaveLength(1);
    }
  });

  it('the same link redeemed twice at once links once', async () => {
    const { go } = build();
    const ws = await insertWorkspace(db);
    const a = await member(ws);
    const outcomes = await Promise.all([go(ws, a.token, 4301n), go(ws, a.token, 4301n)]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['link_expired', 'linked']);
    expect(await liveLinks(ws)).toHaveLength(1);
  });

  it('a concurrent deactivation never deadlocks and leaves no live link, whichever commits first', async () => {
    for (let i = 0; i < 12; i += 1) {
      const { go, team } = build();
      const ws = await insertWorkspace(db);
      const owner = await insertMembership(db, ws, { role: 'owner' });
      void owner;
      const a = await member(ws);
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const stagger = (i % 4) * 3;
      // Even rounds start the redeem first, odd rounds the deactivation first.
      const redeemFirst = i % 2 === 0;
      const redeemed = (redeemFirst ? Promise.resolve() : delay(stagger)).then(() =>
        go(ws, a.token, 4400n + BigInt(i)),
      );
      const deactivated = (redeemFirst ? delay(stagger) : Promise.resolve()).then(() =>
        team.deactivateMembership(ws, a.id),
      );
      const [outcome] = await Promise.all([redeemed, deactivated]);
      expect(['linked', 'link_expired']).toContain(outcome.outcome);
      // Either order: the deactivated member holds no live link and no usable connect link.
      expect(await liveLinks(ws)).toEqual([]);
      const m = await db
        .selectFrom('memberships')
        .select('state')
        .where('id', '=', a.id)
        .executeTakeFirstOrThrow();
      expect(m.state).toBe('deactivated');
    }
  });
});
