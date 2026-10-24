import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot, testBotKey, type InsertedBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { mostInOneSecond, recordingPacer } from '../../../test/recording-pacer.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactReach } from '../../contacts/app/reach.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import { createReachRepo } from '../../contacts/infra/reach-repo.js';
import { createReachSignals } from '../../contacts/infra/tag-signals.js';
import { createBotRepo } from '../infra/bot-repo.js';
import { createBotSignals } from '../infra/bot-signals.js';
import { createTelegramGateway } from '../infra/telegram-gateway.js';
import { createTokenCipher } from '../infra/token-cipher.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { BROADCAST_MESSAGES_PER_SECOND, createPacer } from './pacer.js';
import { createSendBroadcastMessage } from './send-broadcast-message.js';
import { createSendPauses, withPauseNotes } from './send-pauses.js';
import { createSendText } from './send-text.js';

describe('sendBroadcastMessage against the fake Bot API (Postgres; AC-08, AC-14, AC-15)', () => {
  let database: TestDatabase;
  let db: Db;
  let fake: FakeTelegram;
  let send: ReturnType<typeof createSendBroadcastMessage>;
  let sendText: ReturnType<typeof createSendText>;
  const pacer = recordingPacer(createPacer({ perSecond: BROADCAST_MESSAGES_PER_SECOND }));

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    fake = await startFakeTelegram();
    const bots = createBotRepo(db, createTokenCipher(testBotKey));
    const telegram = createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 5 });
    const transaction = <T>(fn: (tx: Db) => Promise<T>) => db.transaction().execute(fn);
    const markNeedsToken = createMarkNeedsToken({
      bots,
      clock: systemClock,
      transaction,
      signals: createBotSignals(),
    });
    const reach = createContactReach({
      transaction,
      contacts: createContactRepo(db),
      reach: createReachRepo(db),
      signals: createReachSignals(),
    });
    const pauses = createSendPauses();
    send = createSendBroadcastMessage({
      bots: withPauseNotes(bots, pauses),
      pauses,
      telegram,
      markNeedsToken,
      clock: systemClock,
      pacer,
      reach,
    });
    sendText = createSendText({ bots, telegram, markNeedsToken, clock: systemClock, reach });
  }, 120_000);

  afterAll(async () => {
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });

  beforeEach(() => fake.reset());

  async function workspaceBot(): Promise<InsertedBot> {
    const b = await insertBot(db, { workspaceId: await insertWorkspace(db) });
    fake.bot(b.token).script({});
    return b;
  }
  const req = (b: InsertedBot, chatId = 700001n) => ({
    workspaceId: b.bot.workspaceId,
    telegramBotId: b.bot.telegramBotId,
    chatId,
    text: 'Spring prices',
    launchedAt: new Date(),
  });

  it("two workspaces' bots never cross: each send goes through its own token only", async () => {
    const a = await workspaceBot();
    const b = await workspaceBot();
    expect((await send.sendBroadcastMessage(req(a))).outcome).toBe('delivered');
    expect(fake.calls(a.token).filter((c) => c.method === 'sendMessage')).toHaveLength(1);
    expect(fake.calls(b.token)).toEqual([]);
    // Workspace A asking with B's Telegram bot id: refused, no call anywhere.
    expect(
      await send.sendBroadcastMessage({ ...req(a), telegramBotId: b.bot.telegramBotId }),
    ).toEqual({ outcome: 'bot_changed' });
    expect(fake.calls(b.token)).toEqual([]);
  });

  it('paces one bot at 40 ms start slots (no 1 s window above 25) while sendText is not delayed', async () => {
    const b = await workspaceBot();
    const burst = Promise.all(Array.from({ length: 40 }, () => send.sendBroadcastMessage(req(b))));
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    const reply = await sendText.sendText({
      workspaceId: b.bot.workspaceId,
      chatId: 700002n,
      text: 'reply',
    });
    const replyMs = Date.now() - started;
    const outcomes = await burst;
    expect(reply.outcome).toBe('accepted');
    expect(replyMs).toBeLessThan(400);
    expect(outcomes.every((o) => o.outcome === 'delivered')).toBe(true);
    expect(fake.sendTimes(b.token)).toHaveLength(41);
    // The starts the pacer released: 40 ms apart at least, so no 1 s window holds more than 25.
    const starts = pacer.starts(b.bot.id);
    expect(starts).toHaveLength(40);
    expect(mostInOneSecond(starts)).toBeLessThanOrEqual(25);
  });

  it('a 429 stores send_paused_until; the next send answers paused with no Telegram call', async () => {
    const b = await workspaceBot();
    fake.bot(b.token).script({ sendMessage: [sendAnswers.tooMany(30)] });
    const first = await send.sendBroadcastMessage(req(b));
    expect(first.outcome).toBe('rate_limited');
    const row = await db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('id', '=', b.bot.id)
      .executeTakeFirstOrThrow();
    expect(row.send_paused_until).not.toBeNull();
    expect(await send.sendBroadcastMessage(req(b))).toEqual({
      outcome: 'paused',
      until: row.send_paused_until,
    });
    expect(fake.calls(b.token).filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });

  it('a 403 blocked marks the contact blocked for this bot', async () => {
    const b = await workspaceBot();
    const contactId = await insertContact(db, {
      workspaceId: b.bot.workspaceId,
      telegramUserId: 760100n,
    });
    fake.bot(b.token).script({ sendMessage: [sendAnswers.blocked()] });
    expect(await send.sendBroadcastMessage(req(b, 760100n))).toEqual({ outcome: 'blocked' });
    const reach = await db
      .selectFrom('contact_bot_reach')
      .select(['telegram_bot_id', 'blocked_at'])
      .where('workspace_id', '=', b.bot.workspaceId)
      .where('contact_id', '=', contactId)
      .executeTakeFirstOrThrow();
    expect(reach.telegram_bot_id).toBe(String(b.bot.telegramBotId));
    expect(reach.blocked_at).not.toBeNull();
  });
});
