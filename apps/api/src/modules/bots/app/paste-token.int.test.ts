import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import {
  BotBelongsToAnotherWorkspaceError,
  WorkspaceKeepsOneBotError,
} from '../../../platform/errors.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { fakeBotToken, testBotKey } from '../../../test/fixtures/bots.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createBotRepo } from '../infra/bot-repo.js';
import { createBotSignals } from '../infra/bot-signals.js';
import { createTelegramGateway } from '../infra/telegram-gateway.js';
import { createTokenCipher } from '../infra/token-cipher.js';
import { createWebhookSecrets } from '../infra/webhook-secret.js';
import { fakeContactsApi, fakeConversationsApi } from './fakes.js';
import { createPasteToken } from './paste-token.js';
import { createBotSettings } from './settings.js';

describe('pasteToken (Postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let db: Db;
  let fake: FakeTelegram;
  let paste: ReturnType<typeof createPasteToken>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    fake = await startFakeTelegram();
    const bots = createBotRepo(db, createTokenCipher(testBotKey));
    paste = createPasteToken({
      bots,
      conversations: fakeConversationsApi(),
      telegram: createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 5 }),
      secrets: createWebhookSecrets(testBotKey.key),
      clock: fixedClock(new Date('2026-10-11T10:00:00Z')),
      transaction: (fn) => db.transaction().execute(fn),
      signals: createBotSignals(),
      settings: createBotSettings({
        bots,
        conversations: fakeConversationsApi(),
        contacts: fakeContactsApi(),
      }),
      webhookBaseUrl: 'https://inbox.example.test',
    });
  });

  afterAll(async () => {
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });

  it('two workspaces pasting the same bot concurrently: one connects, the other is refused, one webhook set', async () => {
    const a = await insertWorkspace(db);
    const b = await insertWorkspace(db);
    const token = fakeBotToken(410001n);
    fake.bot(token).script({});

    const results = await Promise.allSettled([
      paste.pasteToken(a, token, false),
      paste.pasteToken(b, token, false),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      BotBelongsToAnotherWorkspaceError,
    );

    const rows = await db
      .selectFrom('bots')
      .select(['workspace_id', 'state'])
      .where('telegram_bot_id', '=', '410001')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('connected');
    expect(fake.calls(token).filter((c) => c.method === 'setWebhook')).toHaveLength(1);
  });

  it('a double-submitted paste of the same bot into one workspace: both connect, one row, no 500', async () => {
    const w = await insertWorkspace(db);
    const token = fakeBotToken(410003n);
    fake.bot(token).script({});
    const results = await Promise.allSettled([
      paste.pasteToken(w, token, false),
      paste.pasteToken(w, token, false),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const rows = await db
      .selectFrom('bots')
      .select('state')
      .where('workspace_id', '=', w)
      .execute();
    expect(rows).toEqual([{ state: 'connected' }]);
  });

  it('two different bots pasted into one workspace at once: one connects, the other is refused 409', async () => {
    const w = await insertWorkspace(db);
    const first = fakeBotToken(410004n);
    const second = fakeBotToken(410005n);
    fake.bot(first).script({});
    fake.bot(second).script({});
    const results = await Promise.allSettled([
      paste.pasteToken(w, first, false),
      paste.pasteToken(w, second, false),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(WorkspaceKeepsOneBotError);
    const rows = await db
      .selectFrom('bots')
      .select('state')
      .where('workspace_id', '=', w)
      .execute();
    expect(rows).toEqual([{ state: 'connected' }]);
  });

  it('connect stores the token encrypted and only the secret hash; the answer has no token', async () => {
    const w = await insertWorkspace(db);
    const token = fakeBotToken(410002n);
    fake.bot(token).script({});
    const settings = await paste.pasteToken(w, ` ${token} `, false);
    expect(settings).toMatchObject({ state: 'connected', bot: { username: 'test_bot_410002' } });
    expect(JSON.stringify(settings)).not.toContain(token);
    const row = await db
      .selectFrom('bots')
      .selectAll()
      .where('workspace_id', '=', w)
      .executeTakeFirstOrThrow();
    expect(row.token_encrypted!.toString('utf8')).not.toContain(token);
    expect(row.webhook_secret_hash).toHaveLength(32);
    const set = fake.calls(token).find((c) => c.method === 'setWebhook')!;
    expect(set.params).toMatchObject({
      url: `https://inbox.example.test/api/telegram/webhook/${row.id}`,
      drop_pending_updates: true,
    });
  });
});
