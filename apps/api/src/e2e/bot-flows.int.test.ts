import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BotSettings, ErrorEnvelope } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { fixedClock, type FixedClock } from '../platform/clock.js';
import { startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { fakeBotToken } from '../test/fixtures/bots.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../test/fixtures/telegram.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import {
  Device,
  PASSWORD,
  registeredWebhook,
  runCli,
  runHealthTick,
  tokenOf,
  truncateAll,
  type RegisteredWebhook,
} from './helpers.js';

const START = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60_000;

describe('bot-connection end-to-end stories (postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let clock: FixedClock;
  let deps: Deps;
  let app: FastifyInstance;
  let nextBot = 880000n;
  let nextUpdate = 1;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    clock = fixedClock(START);
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config, { clock });
    app = await buildApp(config, { clock });
  });
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(deps.db);
    fake.reset();
    clock.set(START);
  });

  const nowS = () => Math.floor(clock.now().getTime() / 1000);

  async function onboardOwner(name: string, email: string) {
    const created = await runCli(deps, 'workspace:create', '--name', name, '--owner-email', email);
    expect(created.code).toBe(0);
    const owner = new Device(app);
    const accept = await owner.post('/api/invitations/accept', {
      token: tokenOf(created.link!),
      password: PASSWORD,
      display_name: 'Owner',
    });
    expect(accept.statusCode).toBe(200);
    const bot = `/api/workspaces/${created.workspaceId!}/bot`;
    return { owner, bot, workspaceId: created.workspaceId! };
  }

  async function settingsOf(owner: Device, bot: string) {
    const res = await owner.get(bot);
    expect(res.statusCode).toBe(200);
    return BotSettings.parse(res.json());
  }

  async function paste(owner: Device, bot: string, token: string, confirm = false) {
    const res = await owner.post(`${bot}/token`, { token, confirm_takeover: confirm });
    return res;
  }

  /** A customer's private message delivered to the webhook as Telegram would, dated now. */
  function write(
    hook: RegisteredWebhook,
    fromId: number,
    messageId: number,
    text: string,
    date = nowS(),
  ) {
    return signedDelivery(
      app,
      hook,
      telegramUpdate({ updateId: nextUpdate++, messageId, date, fromId, text }),
    );
  }

  const messagesOf = (workspaceId: string) =>
    deps.db
      .selectFrom('messages')
      .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
      .select([
        'conversations.telegram_chat_id as chat',
        'messages.telegram_message_id as id',
        'messages.body',
        'messages.edited_at',
      ])
      .where('messages.workspace_id', '=', workspaceId)
      .orderBy('conversations.telegram_chat_id')
      .orderBy('messages.telegram_message_id')
      .execute();
  const conversationsOf = async (workspaceId: string) =>
    (
      await deps.db
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .execute()
    ).length;

  it('story 1 — capture lifecycle: connect, capture, rotate, disconnect, connect again (AC-01, AC-07, AC-13, AC-17, AC-18, AC-19)', async () => {
    const acme = await onboardOwner('Acme Flowers', 'owner@acme.test');
    const bolt = await onboardOwner('Bolt Bikes', 'owner@bolt.test');
    const botId = nextBot++;
    const tokenA = fakeBotToken(botId);
    const tokenBolt = fakeBotToken(nextBot++);
    fake
      .bot(tokenA)
      .script({ me: { first_name: 'Acme Flowers Support', username: 'acme_support_bot' } });
    fake.bot(tokenBolt).script({});

    // Connect (AC-01): the answer names the bot, never the token.
    const connected = await paste(acme.owner, acme.bot, `  ${tokenA}  `);
    expect(connected.statusCode).toBe(200);
    expect(BotSettings.parse(connected.json())).toMatchObject({
      state: 'connected',
      bot: { name: 'Acme Flowers Support', username: 'acme_support_bot' },
      last_message_received_at: null,
      contacts_count: 0,
    });
    expect(connected.body).not.toContain(tokenA);
    const hookA = registeredWebhook(fake, tokenA);
    expect((await paste(bolt.owner, bolt.bot, tokenBolt)).statusCode).toBe(200);
    const hookBolt = registeredWebhook(fake, tokenBolt);

    // Two customers write to Acme; one of them also writes to Bolt (AC-07, AC-13).
    clock.advance(MINUTE);
    expect((await write(hookA, 990001, 1, 'Do you deliver today?')).statusCode).toBe(200);
    expect((await write(hookA, 990002, 1, 'Hi!')).statusCode).toBe(200);
    expect((await write(hookBolt, 990001, 1, 'Is my bike ready?')).statusCode).toBe(200);
    const afterCapture = await settingsOf(acme.owner, acme.bot);
    expect(afterCapture).toMatchObject({
      state: 'connected',
      contacts_count: 2,
      last_message_received_at: clock.now().toISOString(),
    });
    expect(await settingsOf(bolt.owner, bolt.bot)).toMatchObject({ contacts_count: 1 });
    expect((await messagesOf(bolt.workspaceId)).map((m) => m.body)).toEqual(['Is my bike ready?']);

    // Rotate (AC-17): a new token of the same bot; the old one is no longer used.
    const tokenA2 = fakeBotToken(botId);
    fake
      .bot(tokenA2)
      .script({ me: { first_name: 'Acme Flowers Support', username: 'acme_support_bot' } });
    const rotated = await paste(acme.owner, acme.bot, tokenA2);
    expect(rotated.statusCode).toBe(200);
    expect(BotSettings.parse(rotated.json())).toMatchObject({
      state: 'connected',
      contacts_count: 2,
    });
    const hookA2 = registeredWebhook(fake, tokenA2);
    expect(hookA2.id).toBe(hookA.id);
    const oldTokenCalls = fake.calls(tokenA).length;
    clock.advance(4 * MINUTE);
    expect(await runHealthTick(deps)).toBeGreaterThanOrEqual(1);
    expect(fake.calls(tokenA)).toHaveLength(oldTokenCalls);
    expect(fake.calls(tokenA2).some((c) => c.method === 'getMe')).toBe(true);
    // Conversations continue.
    expect((await write(hookA2, 990001, 2, 'Still there?')).statusCode).toBe(200);
    expect(await conversationsOf(acme.workspaceId)).toBe(2);

    // Disconnect (AC-18): a late delivery is refused, everything captured stays.
    clock.advance(MINUTE);
    const off = await acme.owner.post(`${acme.bot}/disconnect`);
    expect(off.statusCode).toBe(200);
    expect(BotSettings.parse(off.json())).toEqual({ state: 'not_connected' });
    expect(fake.calls(tokenA2).some((c) => c.method === 'deleteWebhook')).toBe(true);
    const disconnectedAt = nowS();
    clock.advance(MINUTE);
    const late = await write(hookA2, 990002, 2, 'Anyone?');
    expect(late.statusCode).toBe(401);
    expect(late.body).toBe('');
    expect(await messagesOf(acme.workspaceId)).toHaveLength(3);

    // Connect again (AC-19): same bot only; the existing customer continues, no duplicate contact.
    clock.advance(MINUTE);
    const again = await paste(acme.owner, acme.bot, tokenA2);
    expect(again.statusCode).toBe(200);
    const hookAgain = registeredWebhook(fake, tokenA2);
    expect(hookAgain.id).toBe(hookA.id);
    expect(hookAgain.secret).not.toBe(hookA2.secret);
    expect((await write(hookA2, 990001, 3, 'old secret')).statusCode).toBe(401);
    expect((await write(hookAgain, 990001, 3, 'Back again')).statusCode).toBe(200);
    // A message sent while disconnected, redelivered now, is before the new epoch: ignored.
    expect((await write(hookAgain, 990002, 2, 'Anyone?', disconnectedAt + 30)).statusCode).toBe(
      200,
    );
    expect(await settingsOf(acme.owner, acme.bot)).toMatchObject({
      state: 'connected',
      contacts_count: 2,
    });
    expect(await conversationsOf(acme.workspaceId)).toBe(2);
    expect((await messagesOf(acme.workspaceId)).map((m) => [Number(m.chat), m.body])).toEqual([
      [990001, 'Do you deliver today?'],
      [990001, 'Still there?'],
      [990001, 'Back again'],
      [990002, 'Hi!'],
    ]);
  });

  it('story 2 — edits and redeliveries: one copy, Telegram order, the latest edit wins (AC-10, AC-11)', async () => {
    const acme = await onboardOwner('Acme Flowers', 'owner@acme.test');
    const token = fakeBotToken(nextBot++);
    fake.bot(token).script({});
    expect((await paste(acme.owner, acme.bot, token)).statusCode).toBe(200);
    const hook = registeredWebhook(fake, token);
    clock.advance(MINUTE);
    const t = nowS();
    const customer = { fromId: 990010 };
    const send = (u: unknown) => signedDelivery(app, hook, u);

    const m3 = telegramUpdate({
      ...customer,
      updateId: 103,
      messageId: 3,
      date: t + 3,
      text: 'third',
    });
    expect(
      (
        await send(
          telegramUpdate({ ...customer, updateId: 101, messageId: 1, date: t + 1, text: 'first' }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await send(m3)).statusCode).toBe(200);
    // A lower id arriving after a higher one, then a redelivery.
    expect(
      (
        await send(
          telegramUpdate({ ...customer, updateId: 102, messageId: 2, date: t + 2, text: 'second' }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await send(m3)).statusCode).toBe(200);
    // Edits out of order: the later edit time wins.
    const edit = (updateId: number, text: string, editDate: number) =>
      telegramEdit({ ...customer, updateId, messageId: 1, date: t + 1, text, editDate });
    expect((await send(edit(105, 'first (edited twice)', t + 20))).statusCode).toBe(200);
    expect((await send(edit(104, 'first (edited once)', t + 10))).statusCode).toBe(200);

    const rows = await messagesOf(acme.workspaceId);
    expect(rows.map((r) => [Number(r.id), r.body])).toEqual([
      [1, 'first (edited twice)'],
      [2, 'second'],
      [3, 'third'],
    ]);
    expect(rows[0]!.edited_at).not.toBeNull();
    expect(rows.slice(1).every((r) => r.edited_at === null)).toBe(true);
  });

  it('story 3 — health and recovery: revoke → needs token → new token; takeover → confirm → connected (AC-15, AC-16, AC-16b, AC-17)', async () => {
    const acme = await onboardOwner('Acme Flowers', 'owner@acme.test');
    const botId = nextBot++;
    const token = fakeBotToken(botId);
    fake.bot(token).script({});
    expect((await paste(acme.owner, acme.bot, token)).statusCode).toBe(200);
    const hook = registeredWebhook(fake, token);
    clock.advance(MINUTE);
    expect((await write(hook, 990020, 1, 'Hello')).statusCode).toBe(200);

    // Revoked in BotFather: the next due tick moves the bot to "needs a new token" (AC-16).
    fake.bot(token).script({ getMe: 'unauthorized', webhookUrl: hook.url });
    clock.advance(3 * MINUTE);
    await runHealthTick(deps);
    expect(await settingsOf(acme.owner, acme.bot)).toMatchObject({
      state: 'needs_token',
      contacts_count: 1,
    });

    // Messages sent meanwhile are held by Telegram; a new token of the same bot keeps them (AC-17).
    const heldFrom = nowS();
    const newToken = fakeBotToken(botId);
    fake.bot(newToken).script({ webhookUrl: hook.url });
    clock.advance(MINUTE);
    const pasted = await paste(acme.owner, acme.bot, newToken);
    expect(pasted.statusCode).toBe(200);
    expect(BotSettings.parse(pasted.json()).state).toBe('connected');
    const set = fake.calls(newToken).find((c) => c.method === 'setWebhook')!;
    expect(set.params.drop_pending_updates).toBe(false);
    const hook2 = registeredWebhook(fake, newToken);
    expect(hook2.secret).toBe(hook.secret);
    expect((await write(hook2, 990020, 3, 'held 2', heldFrom + 20)).statusCode).toBe(200);
    expect((await write(hook2, 990020, 2, 'held 1', heldFrom + 10)).statusCode).toBe(200);
    expect((await messagesOf(acme.workspaceId)).map((m) => m.body)).toEqual([
      'Hello',
      'held 1',
      'held 2',
    ]);

    // Another service takes the webhook: the next due tick shows "taken over" (AC-16b).
    fake.bot(newToken).script({ webhookUrl: 'https://other-service.example/hook' });
    clock.advance(3 * MINUTE);
    await runHealthTick(deps);
    expect((await settingsOf(acme.owner, acme.bot)).state).toBe('taken_over');

    const warn = await acme.owner.post(`${acme.bot}/reconnect`, { confirm_takeover: false });
    expect(warn.statusCode).toBe(409);
    expect(ErrorEnvelope.parse(warn.json()).error).toMatchObject({
      code: 'TAKEOVER_CONFIRMATION_REQUIRED',
      details: { bot: { username: `test_bot_${botId}` } },
    });
    const confirmed = await acme.owner.post(`${acme.bot}/reconnect`, { confirm_takeover: true });
    expect(confirmed.statusCode).toBe(200);
    expect(BotSettings.parse(confirmed.json()).state).toBe('connected');
    const hook3 = registeredWebhook(fake, newToken);
    expect(hook3.secret).toBe(hook.secret);
    clock.advance(MINUTE);
    expect((await write(hook3, 990020, 4, 'after reconnect')).statusCode).toBe(200);
    expect(await conversationsOf(acme.workspaceId)).toBe(1);
    clock.advance(3 * MINUTE);
    await runHealthTick(deps);
    expect((await settingsOf(acme.owner, acme.bot)).state).toBe('connected');
  });
});
