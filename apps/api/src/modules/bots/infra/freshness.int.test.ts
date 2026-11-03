import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import type { Config } from '../../../platform/config.js';
import { startJobs } from '../../../platform/jobs.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot, type InsertedBot } from '../../../test/fixtures/bots.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { SCHEDULE_HEALTH_CHECKS_QUEUE } from './jobs.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60_000;
const FRESHNESS = 5 * MINUTE;

describe('health-check freshness over a simulated hour (QG-3b, AC-15, AC-16, AC-16b)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let config: Config;
  const clock = fixedClock(T0);
  let deps: ReturnType<typeof buildDeps>;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config, { clock });
  });
  afterAll(async () => {
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });

  const ours = (b: InsertedBot) =>
    `${config.TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${b.bot.id}`;

  /** One cron tick, run inline with the controllable clock: enqueue the due bots and check them. */
  async function tick(): Promise<void> {
    const due = await deps.bots.healthCheck.scheduleChecks();
    for (const { workspaceId, botId } of due) {
      await deps.bots.healthCheck.checkOne(workspaceId, botId);
    }
  }

  const rowOf = (b: InsertedBot) =>
    deps.db
      .selectFrom('bots')
      .select(['state', 'last_checked_at'])
      .where('id', '=', b.bot.id)
      .executeTakeFirstOrThrow();

  it('no live bot is ever more than 5 minutes stale; revocation and takeover land on the first due tick', async () => {
    const steady = await insertBot(db(), {
      workspaceId: await insertWorkspace(db()),
      lastCheckedAt: T0,
    });
    const revoked = await insertBot(db(), {
      workspaceId: await insertWorkspace(db()),
      lastCheckedAt: T0,
    });
    const taken = await insertBot(db(), {
      workspaceId: await insertWorkspace(db()),
      lastCheckedAt: T0,
    });
    const flaky = await insertBot(db(), {
      workspaceId: await insertWorkspace(db()),
      lastCheckedAt: T0,
    });
    for (const b of [steady, revoked, taken, flaky]) {
      fake.bot(b.token).script({ webhookUrl: ours(b) });
    }

    const lastCheck = new Map<string, number>();
    for (const b of [steady, revoked, taken, flaky]) lastCheck.set(b.bot.id, T0.getTime());
    const transitions: Record<string, number | undefined> = {};
    const expectedAt: Record<string, number | undefined> = {};
    let flakyFrozen: { state: string; checked: number } | null = null;

    for (let minute = 1; minute <= 60; minute++) {
      clock.set(new Date(T0.getTime() + minute * MINUTE));
      if (minute === 10) fake.bot(revoked.token).script({ getMe: 'unauthorized' });
      if (minute === 20) fake.bot(taken.token).script({ webhookUrl: 'https://other.example/hook' });
      if (minute === 30)
        fake.bot(flaky.token).script({ webhookUrl: ours(flaky), getMe: 'server_error' });
      if (minute === 40) fake.bot(flaky.token).script({ webhookUrl: ours(flaky) });

      // The first tick at or after the change on which the bot is due (≥ 3 min since its check).
      const dueNow = (b: InsertedBot) =>
        minute * MINUTE + T0.getTime() - lastCheck.get(b.bot.id)! >= 3 * MINUTE;
      if (minute >= 10 && expectedAt.revoked === undefined && dueNow(revoked))
        expectedAt.revoked = minute;
      if (minute >= 20 && expectedAt.taken === undefined && dueNow(taken))
        expectedAt.taken = minute;

      await tick();

      for (const [name, b] of Object.entries({ steady, revoked, taken, flaky })) {
        const row = await rowOf(b);
        const checked = row.last_checked_at!.getTime();
        lastCheck.set(b.bot.id, checked);
        if (name === 'revoked' && row.state === 'needs_token') transitions.revoked ??= minute;
        if (name === 'taken' && row.state === 'taken_over') transitions.taken ??= minute;

        const transient = name === 'flaky' && minute >= 30 && minute < 40;
        if (transient) {
          // Telegram unreachable: nothing is written — the state and the last check stay as they were.
          flakyFrozen ??= { state: row.state, checked };
          expect(row.state).toBe(flakyFrozen.state);
          expect(checked).toBe(flakyFrozen.checked);
          continue;
        }
        // A bot that needs a new token is no longer checked (it waits for the owner).
        if (row.state === 'needs_token') continue;
        const age = clock.now().getTime() - checked;
        expect(age, `${name} at minute ${minute}`).toBeLessThanOrEqual(FRESHNESS);
      }
    }

    expect(transitions.revoked).toBe(expectedAt.revoked);
    expect(transitions.taken).toBe(expectedAt.taken);
    expect(transitions.revoked).toBeLessThanOrEqual(13);
    expect(transitions.taken).toBeLessThanOrEqual(23);
    expect((await rowOf(steady)).state).toBe('connected');
    expect((await rowOf(flaky)).state).toBe('connected');
    // The transient window ended: the flaky bot is fresh again.
    expect(
      clock.now().getTime() - (await rowOf(flaky)).last_checked_at!.getTime(),
    ).toBeLessThanOrEqual(FRESHNESS);
  });

  it('buildApp registers the health-check workers and the one-minute cron tick', async () => {
    const app = await buildApp(config, { clock });
    const boss = await startJobs(config.DATABASE_URL);
    try {
      const schedules = await boss.getSchedules(SCHEDULE_HEALTH_CHECKS_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(['* * * * *']);
    } finally {
      await boss.stop({ graceful: false });
      await app.close();
    }
  });

  function db() {
    return deps.db;
  }

  it('rollout: a webhook registered before my_chat_member is set again once by the next due check (flow 17)', async () => {
    clock.set(T0);
    const b = await insertBot(db(), {
      workspaceId: await insertWorkspace(db()),
      lastCheckedAt: new Date(T0.getTime() - 3 * MINUTE),
    });
    fake
      .bot(b.token)
      .script({ webhookUrl: ours(b), allowedUpdates: ['message', 'edited_message'] });
    await deps.bots.healthCheck.checkOne(b.bot.workspaceId, b.bot.id);
    const sets = () => fake.calls(b.token).filter((c) => c.method === 'setWebhook');
    expect(sets()).toEqual([
      {
        token: b.token,
        method: 'setWebhook',
        params: {
          url: ours(b),
          secret_token: b.webhookSecret,
          allowed_updates: ['message', 'edited_message', 'my_chat_member'],
          max_connections: expect.any(Number),
          drop_pending_updates: false,
        },
      },
    ]);
    expect((await rowOf(b)).state).toBe('connected');
    // Up to date now: the next check leaves it alone.
    clock.advance(3 * MINUTE);
    await deps.bots.healthCheck.checkOne(b.bot.workspaceId, b.bot.id);
    expect(sets()).toHaveLength(1);
  });
});
