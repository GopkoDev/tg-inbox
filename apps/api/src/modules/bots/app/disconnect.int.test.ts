import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { WorkspaceKeepsOneBotError } from '../../../platform/errors.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { fakeBotToken, insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import { createConversations } from '../../conversations/app/conversations.js';
import { createConversationRepo } from '../../conversations/infra/conversation-repo.js';
import { createMessageRepo } from '../../conversations/infra/message-repo.js';
import { createBotRepo } from '../infra/bot-repo.js';
import { createBotSignals } from '../infra/bot-signals.js';
import { createTelegramGateway } from '../infra/telegram-gateway.js';
import { createTokenCipher } from '../infra/token-cipher.js';
import { createWebhookSecrets } from '../infra/webhook-secret.js';
import { createDisconnect } from './disconnect.js';
import type { Transaction } from './ports.js';
import { createPasteToken } from './paste-token.js';
import { createReconnect } from './reconnect.js';
import { createBotSettings } from './settings.js';

const BASE = 'https://inbox.example.test';
const ourUrl = (botId: string) => `${BASE}/api/telegram/webhook/${botId}`;

describe('reconnect and disconnect (Postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let db: Db;
  let fake: FakeTelegram;
  let owner: {
    paste: ReturnType<typeof createPasteToken>;
    reconnect: ReturnType<typeof createReconnect>;
    disconnect: ReturnType<typeof createDisconnect>;
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    fake = await startFakeTelegram();
    const clock = fixedClock(new Date('2026-10-11T12:00:00Z'));
    const bots = createBotRepo(db, createTokenCipher(testBotKey));
    const contacts = createContacts({ repo: createContactRepo(db), clock });
    const conversations = createConversations({
      transaction: (fn) => db.transaction().execute(fn),
      conversations: createConversationRepo(db),
      messages: createMessageRepo(db),
      contacts,
      clock,
    });
    const settings = createBotSettings({ bots, conversations, contacts });
    const transaction: Transaction = (fn) => db.transaction().execute(fn);
    const common = {
      bots,
      telegram: createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 5 }),
      secrets: createWebhookSecrets(testBotKey.key),
      clock,
      settings,
      transaction,
      signals: createBotSignals(),
      webhookBaseUrl: BASE,
    };
    owner = {
      paste: createPasteToken({
        ...common,
        conversations,
        transaction,
        signals: common.signals,
      }),
      reconnect: createReconnect(common),
      disconnect: createDisconnect({ ...common, conversations }),
    };
  });

  afterAll(async () => {
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });

  beforeEach(() => fake.reset());

  const rowOf = (id: string) =>
    db.selectFrom('bots').selectAll().where('id', '=', id).executeTakeFirst();

  it('disconnect with captures keeps the row bound; a different bot then gets reason history (AC-18, AC-05)', async () => {
    const w = await insertWorkspace(db);
    const { bot, token } = await insertBot(db, { workspaceId: w });
    const contactId = await insertContact(db, { workspaceId: w });
    await insertConversation(db, { workspaceId: w, contactId });
    fake.bot(token).script({ webhookUrl: ourUrl(bot.id) });

    expect(await owner.disconnect.disconnect(w)).toEqual({ state: 'not_connected' });
    expect(fake.calls(token).map((c) => c.method)).toEqual(['getWebhookInfo', 'deleteWebhook']);
    expect(fake.calls(token)[1]!.params).toMatchObject({ drop_pending_updates: true });
    expect(await rowOf(bot.id)).toMatchObject({
      state: 'disconnected',
      token_encrypted: null,
      webhook_secret_hash: null,
      connected_at: null,
      telegram_bot_id: String(bot.telegramBotId),
    });

    const other = fakeBotToken(420001n);
    fake.bot(other).script({});
    const err = await owner.paste.pasteToken(w, other, false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceKeepsOneBotError);
    expect((err as WorkspaceKeepsOneBotError).details).toEqual({ reason: 'history' });
  });

  it('disconnect with nothing captured deletes the row', async () => {
    const w = await insertWorkspace(db);
    const { bot, token } = await insertBot(db, { workspaceId: w });
    fake.bot(token).script({ webhookUrl: ourUrl(bot.id) });
    await owner.disconnect.disconnect(w);
    expect(await rowOf(bot.id)).toBeUndefined();
  });

  it("deleteWebhook is never sent for another service's URL", async () => {
    const w = await insertWorkspace(db);
    const { bot, token } = await insertBot(db, { workspaceId: w });
    fake.bot(token).script({ webhookUrl: 'https://other-service.example.test/hook' });
    await owner.disconnect.disconnect(w);
    expect(fake.calls(token).map((c) => c.method)).toEqual(['getWebhookInfo']);
    expect(await rowOf(bot.id)).toBeUndefined();
  });

  it('reconnect after a takeover with confirmation re-registers our webhook, keeping the epoch (AC-16b)', async () => {
    const w = await insertWorkspace(db);
    const { bot, token, webhookSecret } = await insertBot(db, {
      workspaceId: w,
      state: 'taken_over',
    });
    fake.bot(token).script({ webhookUrl: 'https://other-service.example.test/hook' });
    const settings = await owner.reconnect.reconnect(w, true);
    expect(settings).toMatchObject({ state: 'connected' });
    const set = fake.calls(token).find((c) => c.method === 'setWebhook')!;
    expect(set.params).toMatchObject({ url: ourUrl(bot.id), secret_token: webhookSecret });
    expect(set.params.drop_pending_updates).not.toBe(true);
    expect(await rowOf(bot.id)).toMatchObject({
      state: 'connected',
      connected_at: bot.connectedAt,
    });
  });
});
