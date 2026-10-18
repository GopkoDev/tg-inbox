import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startRealtimeListener, type RealtimeListener } from '../../../platform/realtime.js';
import type { RealtimeSignal } from '../../../platform/realtime.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { fakeBotToken, insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { fakeContactsApi, fakeConversationsApi } from '../app/fakes.js';
import { createDisconnect } from '../app/disconnect.js';
import { createHealthCheck } from '../app/health-check.js';
import { createPasteToken } from '../app/paste-token.js';
import { createReconnect } from '../app/reconnect.js';
import { createBotSettings } from '../app/settings.js';
import { createBotRepo } from './bot-repo.js';
import { createBotSignals } from './bot-signals.js';
import { createTelegramGateway } from './telegram-gateway.js';
import { createTokenCipher } from './token-cipher.js';
import { createWebhookSecrets } from './webhook-secret.js';

const BASE = 'https://inbox.example.test';
const OTHER = 'https://other-service.example.test/hook';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('bot state transitions publish bot.changed once, on commit (AC-13, AC-14)', () => {
  let database: TestDatabase;
  let db: Db;
  let fake: FakeTelegram;
  let listener: RealtimeListener;
  let got: RealtimeSignal[] = [];
  let paste: ReturnType<typeof createPasteToken>;
  let reconnect: ReturnType<typeof createReconnect>;
  let disconnect: ReturnType<typeof createDisconnect>;
  let health: ReturnType<typeof createHealthCheck>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    fake = await startFakeTelegram();
    listener = await startRealtimeListener(
      database.url,
      pino({ level: 'silent' }, new Writable({ write: (_c, _e, cb) => cb() })),
    );
    listener.onSignal((s) => got.push(s));
    const clock = fixedClock(new Date('2026-10-11T12:00:00Z'));
    const bots = createBotRepo(db, createTokenCipher(testBotKey));
    const conversations = fakeConversationsApi();
    const common = {
      bots,
      telegram: createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 5 }),
      secrets: createWebhookSecrets(testBotKey.key),
      clock,
      transaction: <T>(fn: (tx: Db) => Promise<T>) => db.transaction().execute(fn),
      signals: createBotSignals(),
      settings: createBotSettings({ bots, conversations, contacts: fakeContactsApi() }),
      webhookBaseUrl: BASE,
    };
    paste = createPasteToken({ ...common, conversations });
    reconnect = createReconnect(common);
    disconnect = createDisconnect({ ...common, conversations });
    health = createHealthCheck(common);
  }, 120_000);

  afterAll(async () => {
    await listener?.stop();
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });

  beforeEach(() => {
    fake.reset();
    got = [];
  });

  /** Signals of the workspace once delivery has settled. */
  async function signalsOf(w: string) {
    await wait(300);
    return got.filter((s) => s.workspace_id === w).map((s) => s.type);
  }

  it('paste: one signal on connect, none on a refusal that rolls back', async () => {
    const w = await insertWorkspace(db);
    const token = fakeBotToken(510001n);
    fake.bot(token).script({ webhookUrl: OTHER });
    await paste.pasteToken(w, token, false).catch(() => undefined);
    expect(await signalsOf(w)).toEqual([]);

    await paste.pasteToken(w, token, true);
    expect(await signalsOf(w)).toEqual(['bot.changed']);
  });

  it('reconnect, disconnect and the health check: one signal each, none without a change', async () => {
    const w = await insertWorkspace(db);
    const { bot, token } = await insertBot(db, { workspaceId: w, state: 'taken_over' });
    fake.bot(token).script({ webhookUrl: OTHER });
    await reconnect.reconnect(w, true);
    expect(await signalsOf(w)).toEqual(['bot.changed']);

    got = [];
    fake.bot(token).script({ webhookUrl: `${BASE}/api/telegram/webhook/${bot.id}` });
    expect(await health.checkOne(w, bot.id)).toBe('connected');
    expect(await signalsOf(w)).toEqual([]);

    fake.bot(token).script({ webhookUrl: OTHER });
    expect(await health.checkOne(w, bot.id)).toBe('taken_over');
    expect(await signalsOf(w)).toEqual(['bot.changed']);

    got = [];
    await disconnect.disconnect(w);
    expect(await signalsOf(w)).toEqual(['bot.changed']);
  });
});
