import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { answerText } from '../domain/answers.js';
import { SEND_BOT_MESSAGE_DLQ, SEND_BOT_MESSAGE_QUEUE, type SendBotMessageJob } from './jobs.js';

const PANEL = 'http://localhost:5173';
const NAME = 'Acme Flowers 9d2e';
const DISPLAY_NAME = 'Zelda Quartz';
const TELEGRAM_USER = 90_123_456_789n;

describe('notifications.send-bot-message worker (pg-boss + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  let boss: Jobs;
  const lines: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot, LOG_LEVEL: 'info' },
      { logStream },
    );
    db = createDb(database.url);
    boss = await startJobs(database.url);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await app?.close();
    await db?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    fake.reset();
    lines.length = 0;
  });

  async function seed(o: { botState?: 'connected' | 'needs_token'; pausedForMs?: number } = {}) {
    const workspaceId = await insertWorkspace(db, NAME);
    const { token } = await insertBot(db, {
      workspaceId,
      state: o.botState ?? 'connected',
      ...(o.pausedForMs && { sendPausedUntil: new Date(Date.now() + o.pausedForMs) }),
    });
    fake.bot(token).script({});
    const { accountId } = await insertMembership(db, workspaceId);
    const link = await insertTelegramLink(db, {
      workspaceId,
      accountId,
      telegramUserId: TELEGRAM_USER,
      displayName: DISPLAY_NAME,
    });
    return { workspaceId, token, accountId, linkId: link.id };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  const send = (payload: SendBotMessageJob) => boss.send(SEND_BOT_MESSAGE_QUEUE, payload);
  const sendCalls = (token: string) => fake.calls(token).filter((c) => c.method === 'sendMessage');
  const jobsOf = async (queue: string, workspaceId: string) =>
    (
      await sql<{ state: string; retry_count: number }>`
        select state, retry_count from pgboss.job
        where name = ${queue} and data->>'workspace_id' = ${workspaceId}
        order by created_on`.execute(db)
    ).rows;
  const storedUserId = async (linkId: string) =>
    (
      await db
        .selectFrom('telegram_links')
        .select('telegram_user_id')
        .where('id', '=', linkId)
        .executeTakeFirstOrThrow()
    ).telegram_user_id;
  const removeByMember = (s: Seed) =>
    db
      .updateTable('telegram_links')
      .set({ removed_at: new Date(), removed_reason: 'member', display_name: null })
      .where('id', '=', s.linkId)
      .execute();

  it('sends the connected answer with its TG-02 text to the linked member (AC-04)', async () => {
    const s = await seed();
    await send({ workspace_id: s.workspaceId, kind: 'connected', telegram_link_id: s.linkId });
    await vi.waitFor(() => expect(sendCalls(s.token)).toHaveLength(1), { timeout: 10_000 });
    const [call] = sendCalls(s.token);
    expect(call!.params.chat_id).toBe(Number(TELEGRAM_USER));
    expect(call!.params.text).toBe(
      answerText('connected', { workspaceName: NAME, workspaceId: s.workspaceId, panelUrl: PANEL }),
    );
    expect(call!.params.link_preview_options).toMatchObject({ is_disabled: true });
  });

  it("sends link_expired to the payload's Telegram user (AC-05)", async () => {
    const s = await seed();
    await send({
      workspace_id: s.workspaceId,
      kind: 'link_expired',
      telegram_user_id: '4242424242',
    });
    await vi.waitFor(() => expect(sendCalls(s.token)).toHaveLength(1), { timeout: 10_000 });
    expect(sendCalls(s.token)[0]!.params.chat_id).toBe(4242424242);
  });

  it('drops the answer of a bot that needs a token: nothing sent, the job completes', async () => {
    const s = await seed({ botState: 'needs_token' });
    await send({ workspace_id: s.workspaceId, kind: 'connected', telegram_link_id: s.linkId });
    await vi.waitFor(
      async () =>
        expect((await jobsOf(SEND_BOT_MESSAGE_QUEUE, s.workspaceId))[0]?.state).toBe('completed'),
      { timeout: 10_000 },
    );
    expect(sendCalls(s.token)).toHaveLength(0);
  });

  it('a member who blocked the bot: the job completes, no retry, the id is cleared for notifications_off', async () => {
    const s = await seed();
    await removeByMember(s);
    fake.bot(s.token).script({ sendMessage: [sendAnswers.blocked()] });
    await send({
      workspace_id: s.workspaceId,
      kind: 'notifications_off',
      telegram_link_id: s.linkId,
    });
    await vi.waitFor(
      async () =>
        expect((await jobsOf(SEND_BOT_MESSAGE_QUEUE, s.workspaceId))[0]?.state).toBe('completed'),
      { timeout: 10_000 },
    );
    expect(sendCalls(s.token)).toHaveLength(1);
    expect(await storedUserId(s.linkId)).toBeNull();
  });

  it('a send pause postpones the answer to its end, then it goes out once', async () => {
    const s = await seed({ pausedForMs: 2_500 });
    await send({ workspace_id: s.workspaceId, kind: 'connected', telegram_link_id: s.linkId });
    await new Promise((r) => setTimeout(r, 1_200));
    expect(sendCalls(s.token)).toHaveLength(0);
    await vi.waitFor(() => expect(sendCalls(s.token)).toHaveLength(1), { timeout: 12_000 });
    await vi.waitFor(
      async () =>
        expect((await jobsOf(SEND_BOT_MESSAGE_QUEUE, s.workspaceId)).map((j) => j.state)).toEqual([
          'completed',
          'completed',
        ]),
      { timeout: 10_000 },
    );
    expect(sendCalls(s.token)).toHaveLength(1);
  }, 30_000);

  it('Telegram 429 stores the pause and the answer is sent again after it', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.tooMany(1)] });
    await send({ workspace_id: s.workspaceId, kind: 'connected', telegram_link_id: s.linkId });
    await vi.waitFor(() => expect(sendCalls(s.token)).toHaveLength(2), { timeout: 15_000 });
  }, 30_000);

  it('three failed attempts dead-letter the job and notifications_off still clears the id', async () => {
    const s = await seed();
    await removeByMember(s);
    fake.bot(s.token).script({
      sendMessage: [
        sendAnswers.serverError(),
        sendAnswers.serverError(),
        sendAnswers.serverError(),
      ],
    });
    await send({
      workspace_id: s.workspaceId,
      kind: 'notifications_off',
      telegram_link_id: s.linkId,
    });
    await vi.waitFor(
      async () => expect(await jobsOf(SEND_BOT_MESSAGE_DLQ, s.workspaceId)).toHaveLength(1),
      {
        timeout: 40_000,
      },
    );
    expect(sendCalls(s.token)).toHaveLength(3);
    expect(await storedUserId(s.linkId)).toBeNull();
  }, 60_000);

  it('rejects a payload that does not match its kind', async () => {
    const id = newId();
    const bad = { workspace_id: id, kind: 'cannot_connect', telegram_user_id: '5' };
    await boss.send(SEND_BOT_MESSAGE_QUEUE, bad);
    // Fails visibly (retry, then the dead letter) instead of being sent or silently completed.
    await vi.waitFor(
      async () =>
        expect((await jobsOf(SEND_BOT_MESSAGE_QUEUE, id))[0]?.state).toMatch(/^(retry|failed)$/),
      { timeout: 10_000 },
    );
    expect(fake.calls().filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('logs carry ids, kinds and outcome codes - never the text, the name or the Telegram user id', async () => {
    const s = await seed();
    await send({ workspace_id: s.workspaceId, kind: 'connected', telegram_link_id: s.linkId });
    await vi.waitFor(() => expect(sendCalls(s.token)).toHaveLength(1), { timeout: 10_000 });
    await vi.waitFor(() => expect(lines.some((l) => l.includes('send-bot-message'))).toBe(true), {
      timeout: 5_000,
    });
    const log = lines.join('\n');
    expect(log).not.toContain(DISPLAY_NAME);
    expect(log).not.toContain(String(TELEGRAM_USER));
    expect(log).not.toContain('connected to');
    expect(log).not.toContain(NAME);
    expect(log).not.toContain(s.token);
  });
});
