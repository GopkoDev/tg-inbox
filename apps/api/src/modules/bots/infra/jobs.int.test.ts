import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { fakeGateway } from '../app/fakes.js';
import { createHealthCheck, type CheckOutcome } from '../app/health-check.js';
import { createBotRepo } from './bot-repo.js';
import {
  BotHealthCheckJob,
  CHECK_HEALTH_QUEUE,
  registerBotJobs,
  SCHEDULE_HEALTH_CHECKS_QUEUE,
} from './jobs.js';
import { createTokenCipher } from './token-cipher.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const NOW = new Date(T0.getTime() + 10 * 60_000);

describe('bots health-check jobs (pg-boss)', () => {
  let database: TestDatabase;
  let db: Db;
  let boss: Jobs;
  const telegram = fakeGateway();
  const outcomes: { botId: string; outcome: CheckOutcome }[] = [];
  let enqueueDueChecks: () => Promise<number>;
  const ticks: number[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    boss = await startJobs(database.url);
    const health = createHealthCheck({
      bots: createBotRepo(db, createTokenCipher(testBotKey)),
      telegram,
      clock: fixedClock(NOW),
      webhookBaseUrl: 'https://inbox.example.test',
    });
    const recording = {
      ...health,
      async checkOne(workspaceId: string, botId: string) {
        const outcome = await health.checkOne(workspaceId, botId);
        outcomes.push({ botId, outcome });
        return outcome;
      },
    };
    ({ enqueueDueChecks } = await registerBotJobs(boss, recording, {
      pollingIntervalSeconds: 0.5,
      onTick: (enqueued) => ticks.push(enqueued),
    }));
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.destroy();
    await database?.stop();
  });

  const outcomesOf = (botId: string) => outcomes.filter((o) => o.botId === botId);

  it('a tick reports how many checks it enqueued (the "tick ran" signal)', async () => {
    const w = await insertWorkspace(db);
    await insertBot(db, { workspaceId: w, state: 'connected', lastCheckedAt: T0 });
    telegram.webhook = 'ours';
    await boss.send(SCHEDULE_HEALTH_CHECKS_QUEUE, {});
    await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(ticks[0]).toBeGreaterThanOrEqual(1);
  });

  it('schedules the cron tick every minute', async () => {
    const schedules = await boss.getSchedules(SCHEDULE_HEALTH_CHECKS_QUEUE);
    expect(schedules.map((s) => s.cron)).toEqual(['* * * * *']);
  });

  it('two ticks enqueueing the same due bot run one check, which refreshes the row', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, state: 'taken_over', lastCheckedAt: T0 });
    telegram.webhook = 'ours';
    await Promise.all([enqueueDueChecks(), enqueueDueChecks()]);
    await vi.waitFor(() => expect(outcomesOf(bot.id)).toHaveLength(1), { timeout: 10_000 });
    // Give a duplicate job time to surface if one had been queued.
    await new Promise((r) => setTimeout(r, 1500));
    expect(outcomesOf(bot.id)).toEqual([{ botId: bot.id, outcome: 'connected' }]);
    const row = await db
      .selectFrom('bots')
      .select(['state', 'name', 'last_checked_at'])
      .where('id', '=', bot.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'connected', name: 'Acme Flowers Bot', last_checked_at: NOW });
  });

  it('job options: singleton per bot, 30 s expiry, no retry; payload has no token or secret', async () => {
    const w = await insertWorkspace(db);
    const { bot, token, webhookSecret } = await insertBot(db, {
      workspaceId: w,
      lastCheckedAt: T0,
    });
    const spy = vi.spyOn(boss, 'send');
    await enqueueDueChecks();
    const call = spy.mock.calls.find(
      (c) => (c[1] as { bot_id?: string } | undefined)?.bot_id === bot.id,
    );
    spy.mockRestore();
    expect(call).toBeDefined();
    const [name, data, options] = call!;
    expect(name).toBe(CHECK_HEALTH_QUEUE);
    expect(data).toEqual({ bot_id: bot.id, workspace_id: w });
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(data)).not.toContain(webhookSecret);
    expect(options).toMatchObject({ singletonKey: bot.id, expireInSeconds: 30, retryLimit: 0 });
    await vi.waitFor(() => expect(outcomesOf(bot.id)).toHaveLength(1), { timeout: 10_000 });
  });

  it('a job for a disconnected bot changes nothing and does not resurrect it', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, state: 'disconnected' });
    const before = await db.selectFrom('bots').selectAll().where('id', '=', bot.id).execute();
    // Sent like the scheduler sends (singleton per bot): under the queue's `exclusive` policy a
    // key-less send is dropped while an earlier key-less job is still active.
    expect(
      await boss.send(
        CHECK_HEALTH_QUEUE,
        { bot_id: bot.id, workspace_id: w },
        { singletonKey: bot.id },
      ),
    ).not.toBeNull();
    await vi.waitFor(() => expect(outcomesOf(bot.id)).toHaveLength(1), { timeout: 10_000 });
    expect(outcomesOf(bot.id)[0]!.outcome).toBe('skipped');
    expect(await db.selectFrom('bots').selectAll().where('id', '=', bot.id).execute()).toEqual(
      before,
    );
  });

  it('a job whose workspace id does not own the bot reads and changes nothing', async () => {
    const w = await insertWorkspace(db);
    const other = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, lastCheckedAt: NOW });
    const before = await db.selectFrom('bots').selectAll().where('id', '=', bot.id).execute();
    const callsBefore = telegram.calls.length;
    // Sent like the scheduler sends (singleton per bot): under the queue's `exclusive` policy a
    // key-less send is dropped while an earlier key-less job is still active.
    expect(
      await boss.send(
        CHECK_HEALTH_QUEUE,
        { bot_id: bot.id, workspace_id: other },
        { singletonKey: bot.id },
      ),
    ).not.toBeNull();
    await vi.waitFor(() => expect(outcomesOf(bot.id)).toHaveLength(1), { timeout: 10_000 });
    expect(outcomesOf(bot.id)[0]!.outcome).toBe('skipped');
    expect(telegram.calls.length).toBe(callsBefore);
    expect(await db.selectFrom('bots').selectAll().where('id', '=', bot.id).execute()).toEqual(
      before,
    );
  });

  it('the payload schema rejects anything but two uuids', () => {
    expect(BotHealthCheckJob.safeParse({ bot_id: 'x', workspace_id: 'y' }).success).toBe(false);
    expect(BotHealthCheckJob.safeParse({}).success).toBe(false);
    expect(
      BotHealthCheckJob.safeParse({
        bot_id: '0199a000-0000-7000-8000-000000000001',
        workspace_id: '0199a000-0000-7000-8000-000000000002',
        extra: 1,
      }).success,
    ).toBe(true);
  });
});
