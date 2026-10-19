import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeps, type Deps } from '../../../deps.js';
import { fixedClock, type FixedClock } from '../../../platform/clock.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertPresence, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { SWEEP_EVERY_MS } from '../domain/constants.js';

/**
 * QG-1 (sad.md §10): the ping scenarios (a)-(g) with a controllable clock, against Postgres and the
 * fake Bot API. The sweep runs every 20 s of clock time, as the chain does.
 */
const NOW = new Date('2026-10-19T12:00:00Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

interface PingLog {
  workspaceId: string;
  accountId: string;
  outcome: string;
  dueToAcceptedMs: number;
  pausedMs: number;
}

describe('ping scenarios QG-1 (Postgres + fake Bot API, controllable clock)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let clock: FixedClock;
  const logs: PingLog[] = [];
  let nextUser = 41_000_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    clock = fixedClock(NOW);
    deps = buildDeps(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot },
      { clock, logger: { info: (o) => logs.push(o as PingLog) } },
    );
  });
  afterAll(async () => {
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    fake.reset();
    logs.length = 0;
    clock.set(NOW);
  });

  const db = () => deps.db;

  async function world() {
    const workspaceId = await insertWorkspace(db(), 'Acme Flowers');
    const { token, bot } = await insertBot(db(), { workspaceId, state: 'connected' });
    fake.bot(token).script({});
    const members = new Map<string, { accountId: string; telegramUserId: bigint }>();
    const w = {
      workspaceId,
      token,
      /** A member; with `linked` (default) a live Telegram link made with the workspace's bot. */
      async member(name: string, o: { linked?: boolean; blockedAt?: Date } = {}) {
        const { accountId } = await insertMembership(db(), workspaceId);
        const telegramUserId = nextUser++;
        if (o.linked !== false) {
          await insertTelegramLink(db(), {
            workspaceId,
            accountId,
            telegramBotId: bot.telegramBotId,
            telegramUserId,
            blockedAt: o.blockedAt ?? null,
          });
        }
        members.set(name, { accountId, telegramUserId });
        return accountId;
      },
      /** On the web: a live, on-screen lease until `minutes` from the start. */
      async onWeb(accountId: string, untilMinutes = 24 * 60) {
        await insertPresence(db(), {
          workspaceId,
          accountId,
          openedAt: NOW,
          liveUntil: at(untilMinutes),
          onScreen: true,
          lastOnScreenAt: NOW,
        });
      },
      async waiting(o: { since?: number; assignee?: string | null } = {}) {
        return insertConversation(db(), {
          workspaceId,
          contactId: await insertContact(db(), { workspaceId, telegramUserId: nextUser++ }),
          assigneeAccountId: o.assignee ?? null,
          waitingSince: at(o.since ?? 0),
          waitingStartedBy: 'message',
        });
      },
      /** Every ping Telegram accepted, with the member it went to and the minute (clock) it left. */
      pings: [] as { who: string; minute: number; text: string }[],
      /** Advances the clock in 20 s steps up to `minute`, sweeping at each step. */
      async runTo(minute: number) {
        while (clock.now().getTime() < at(minute).getTime()) {
          await sweep();
          clock.advance(SWEEP_EVERY_MS);
        }
        await sweep();
      },
      /** One sweep at the current clock. */
      sweep: () => sweep(),
    };
    let seen = 0;
    async function sweep() {
      await deps.sendPings.runSweep(workspaceId);
      const calls = fake.calls(token).filter((c) => c.method === 'sendMessage');
      for (const call of calls.slice(seen)) {
        const who = [...members].find(
          ([, m]) => Number(m.telegramUserId) === call.params.chat_id,
        )?.[0];
        w.pings.push({
          who: who ?? '?',
          minute: (clock.now().getTime() - NOW.getTime()) / MIN,
          text: String(call.params.text),
        });
      }
      seen = calls.length;
    }
    return w;
  }

  it('(a) due at 5 minutes: accepted within one sweep, logged within 60 s (AC-07)', async () => {
    const w = await world();
    const a = await w.member('A');
    await w.waiting({ assignee: a });
    await w.runTo(7);
    expect(w.pings).toHaveLength(1);
    expect(w.pings[0]!.minute).toBe(5);
    expect(w.pings[0]!.text).toContain(
      'Acme Flowers: 1 customer is waiting for your reply (5 min)',
    );
    const [log] = logs.filter((l) => l.workspaceId === w.workspaceId && l.outcome === 'accepted');
    expect(log!.dueToAcceptedMs).toBeLessThanOrEqual(60_000);
    expect(log!.pausedMs).toBe(0);
  });

  it('(b) three conversations due within 10 minutes: one ping, then one combined ping at the next allowed moment (AC-08)', async () => {
    const w = await world();
    const a = await w.member('A');
    await w.waiting({ assignee: a, since: 0 });
    await w.waiting({ assignee: a, since: 3 });
    await w.waiting({ assignee: a, since: 6 });
    await w.runTo(20);
    expect(w.pings.map((p) => [p.who, p.minute])).toEqual([
      ['A', 5],
      ['A', 15],
    ]);
    expect(w.pings[0]!.text).toContain('1 customer is waiting for your reply (5 min)');
    expect(w.pings[1]!.text).toContain(
      '2 customers are waiting for your reply, the longest 12 min',
    );
    expect(w.pings[1]!.text).toContain(`/w/${w.workspaceId}/inbox?assignee=mine`);
    const accepted = logs.filter(
      (l) => l.workspaceId === w.workspaceId && l.outcome === 'accepted',
    );
    expect(accepted).toHaveLength(2);
    expect(accepted.every((l) => l.dueToAcceptedMs <= 60_000)).toBe(true);
  });

  it('(c) a member who becomes away at 12 minutes is pinged at the next sweep', async () => {
    const w = await world();
    const a = await w.member('A');
    await w.onWeb(a, 12);
    await w.waiting();
    await w.runTo(14);
    expect(w.pings.map((p) => [p.who, p.minute])).toEqual([['A', 12]]);
    expect(w.pings[0]!.text).toContain('an unassigned customer is waiting for a reply (12 min)');
  });

  it('(d) a reassignment to an away linked member makes it due at once; unassigning does too', async () => {
    const reassign = await world();
    const p = await reassign.member('P', { linked: false });
    const q = await reassign.member('Q');
    await reassign.onWeb(p);
    const conv = await reassign.waiting({ assignee: p });
    await reassign.runTo(7);
    expect(reassign.pings).toEqual([]);
    await db()
      .updateTable('conversations')
      .set({ assignee_account_id: q })
      .where('id', '=', conv)
      .execute();
    await reassign.sweep();
    expect(reassign.pings.map((x) => [x.who, x.minute])).toEqual([['Q', 7]]);

    const unassign = await world();
    const p2 = await unassign.member('P', { linked: false });
    await unassign.member('R');
    await unassign.onWeb(p2);
    const conv2 = await unassign.waiting({ assignee: p2 });
    await unassign.runTo(8);
    expect(unassign.pings).toEqual([]);
    await db()
      .updateTable('conversations')
      .set({ assignee_account_id: null })
      .where('id', '=', conv2)
      .execute();
    await unassign.sweep();
    expect(unassign.pings.map((x) => [x.who, x.minute])).toEqual([['R', 8]]);
    expect(unassign.pings[0]!.text).toContain(
      'an unassigned customer is waiting for a reply (8 min)',
    );
  });

  it('(e) a bot that needs a token sends and queues nothing for 20 minutes, then one combined ping (AC-10)', async () => {
    const w = await world();
    const a = await w.member('A');
    await w.waiting({ assignee: a, since: 0 });
    await w.waiting({ assignee: a, since: 2 });
    await db()
      .updateTable('bots')
      .set({ state: 'needs_token' })
      .where('workspace_id', '=', w.workspaceId)
      .execute();
    await w.runTo(20);
    expect(w.pings).toEqual([]);
    expect(
      await db()
        .selectFrom('pings')
        .selectAll()
        .where('workspace_id', '=', w.workspaceId)
        .execute(),
    ).toEqual([]);
    await db()
      .updateTable('bots')
      .set({ state: 'connected' })
      .where('workspace_id', '=', w.workspaceId)
      .execute();
    await w.runTo(21);
    expect(w.pings.map((p) => [p.who, p.minute])).toEqual([['A', 20]]);
    expect(w.pings[0]!.text).toContain(
      '2 customers are waiting for your reply, the longest 20 min',
    );
  });

  it('(f) two workers sweeping at once leave one ledger item per period', async () => {
    const w = await world();
    const a = await w.member('A');
    await w.waiting({ assignee: a });
    clock.set(at(6));
    await Promise.all([
      deps.sendPings.runSweep(w.workspaceId),
      deps.sendPings.runSweep(w.workspaceId),
    ]);
    const items = await db()
      .selectFrom('ping_items')
      .selectAll()
      .where('workspace_id', '=', w.workspaceId)
      .execute();
    expect(items).toHaveLength(1);
    expect(fake.calls(w.token).filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });

  describe('(g) the rest of the team (AC-09)', () => {
    it('reaches every other away, linked, unread member at 30 minutes, not before', async () => {
      const w = await world();
      const a = await w.member('A');
      await w.member('B');
      await w.onWeb(a);
      await w.waiting({ assignee: a });
      await w.runTo(31);
      expect(w.pings.map((p) => [p.who, p.minute])).toEqual([['B', 30]]);
      expect(w.pings[0]!.text).toContain("a teammate's customer is waiting for a reply (30 min)");
    });

    it('reaches them at 5 minutes when the away assignee has no link', async () => {
      const w = await world();
      const a = await w.member('A', { linked: false });
      await w.member('B');
      await w.waiting({ assignee: a });
      await w.runTo(6);
      expect(w.pings.map((p) => [p.who, p.minute])).toEqual([['B', 5]]);
    });

    it("reaches them at 5 minutes when the assignee's link is already not reachable", async () => {
      const w = await world();
      const a = await w.member('A', { blockedAt: at(-60) });
      await w.member('B');
      fake.bot(w.token).script({ sendMessage: [sendAnswers.blocked()] });
      await w.waiting({ assignee: a });
      await w.runTo(5);
      expect(w.pings.map((p) => [p.who, p.minute]).sort()).toEqual([
        ['A', 5],
        ['B', 5],
      ]);
    });

    it('a blocked first attempt brings the team in at the next sweep', async () => {
      const w = await world();
      const a = await w.member('A');
      await w.member('B');
      fake.bot(w.token).script({ sendMessage: [sendAnswers.blocked()] });
      await w.waiting({ assignee: a });
      await w.runTo(6);
      expect(w.pings.map((p) => [p.who, p.minute])).toEqual([
        ['A', 5],
        ['B', 5 + 1 / 3],
      ]);
      expect(w.pings[1]!.text).toContain("a teammate's customer");
    });

    it('never names the teammate or the customer in a ping', async () => {
      const w = await world();
      const a = await w.member('A');
      await w.member('B');
      await w.onWeb(a);
      await w.waiting({ assignee: a });
      await w.runTo(31);
      const text = w.pings.map((p) => p.text).join('\n');
      expect(text).not.toMatch(/Test|Alice|Olena/);
    });
  });
});
