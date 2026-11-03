import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import type { BotRecord, LiveBotState } from '../../modules/bots/app/ports.js';
import type { BotState } from '../../modules/bots/domain/connection.js';
import { createTokenCipher } from '../../modules/bots/infra/token-cipher.js';
import { createWebhookSecrets, hashSecret } from '../../modules/bots/infra/webhook-secret.js';
import { TEST_BOT_TOKEN_ENCRYPTION_KEY } from '../postgres.js';
import { insertWorkspace } from './workspaces.js';

/** The key testConfig() gives the app, so fixture rows decrypt and authenticate in app tests. */
export const testBotKey = TEST_BOT_TOKEN_ENCRYPTION_KEY;
const cipher = createTokenCipher(testBotKey);
const secrets = createWebhookSecrets(testBotKey.key);

const T = new Date('2026-10-11T10:00:00Z');
let nextTelegramBotId = 200000n;

/** A visibly fake token `<telegramBotId>:TEST-<random>` (PII guard). */
export function fakeBotToken(telegramBotId: bigint): string {
  return `${telegramBotId}:TEST-${newId().replaceAll('-', '').slice(0, 30)}`;
}

export interface InsertedBot {
  bot: BotRecord;
  /** The plain fake token (also for a disconnected row: what a re-paste would send). */
  token: string;
  /** The plain webhook secret; null for a disconnected row (it keeps none). */
  webhookSecret: string | null;
}

/**
 * A bots row written directly. `state: 'disconnected'` builds the kept-after-disconnect row (no
 * token, secret or capture epoch). The token is encrypted and the secret derived with the test key.
 */
export async function insertBot(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    telegramBotId?: bigint;
    state?: BotState;
    name?: string;
    username?: string;
    connectedAt?: Date;
    lastCheckedAt?: Date;
    /** The send pause (bots.send_paused_until); defaults to none. */
    sendPausedUntil?: Date | null;
  },
): Promise<InsertedBot> {
  const id = newId();
  const telegramBotId = o.telegramBotId ?? nextTelegramBotId++;
  const state = o.state ?? 'connected';
  const live = state !== 'disconnected';
  const connectedAt = live ? (o.connectedAt ?? T) : null;
  const token = fakeBotToken(telegramBotId);
  const webhookSecret = connectedAt ? secrets.secretFor(id, connectedAt) : null;
  const bot: BotRecord = {
    id,
    workspaceId: o.workspaceId,
    telegramBotId,
    name: o.name ?? `Test Bot ${telegramBotId}`,
    username: o.username ?? `test_bot_${telegramBotId}`,
    state,
    connectedAt,
    lastCheckedAt: o.lastCheckedAt ?? (live ? T : null),
    createdAt: T,
    sendPausedUntil: o.sendPausedUntil ?? null,
    stoppedWorkingAt: null,
  };
  await db
    .insertInto('bots')
    .values({
      id,
      workspace_id: bot.workspaceId,
      telegram_bot_id: telegramBotId,
      name: bot.name,
      username: bot.username,
      state,
      token_encrypted: live ? cipher.encrypt(token) : null,
      webhook_secret_hash: webhookSecret ? hashSecret(webhookSecret) : null,
      connected_at: connectedAt,
      last_checked_at: bot.lastCheckedAt,
      send_paused_until: bot.sendPausedUntil,
      created_at: T,
    })
    .execute();
  return { bot, token, webhookSecret };
}

/** `twoWorkspaces` with one connected bot each. */
export async function twoWorkspacesWithBots(db: Kysely<DB>, state: LiveBotState = 'connected') {
  const a = { workspaceId: await insertWorkspace(db, 'A') };
  const b = { workspaceId: await insertWorkspace(db, 'B') };
  return {
    a,
    b,
    botA: await insertBot(db, { workspaceId: a.workspaceId, state }),
    botB: await insertBot(db, { workspaceId: b.workspaceId, state }),
  };
}
