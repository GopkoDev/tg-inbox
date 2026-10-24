import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Bots, DB } from '../../../platform/db.types.gen.js';
import type { BotState } from '../domain/connection.js';
import { DUE_AFTER_MS } from '../domain/health.js';
import type { BotRecord, BotRepo, LiveRowGuard, TokenCipher } from '../app/ports.js';
import { TokenDecryptError } from './token-cipher.js';
import { hashSecret, secretMatches } from './webhook-secret.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every column but the token and the secret hash — those never leave this file undecoded. */
const PUBLIC_COLUMNS = [
  'id',
  'workspace_id',
  'telegram_bot_id',
  'name',
  'username',
  'state',
  'connected_at',
  'last_checked_at',
  'created_at',
  'send_paused_until',
  'needs_token_at',
] as const;

type PublicRow = Pick<Selectable<Bots>, (typeof PUBLIC_COLUMNS)[number]>;

function toRecord(row: PublicRow): BotRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    telegramBotId: BigInt(row.telegram_bot_id),
    name: row.name,
    username: row.username,
    state: row.state as BotState,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    sendPausedUntil: row.send_paused_until,
    stoppedWorkingAt: row.needs_token_at,
  };
}

function uniqueViolation(err: unknown): 'bound_elsewhere' | 'workspace_has_bot' | null {
  const e = err as { code?: string; constraint?: string };
  if (e.code !== '23505') return null;
  if (e.constraint === 'bots_telegram_bot_id_key') return 'bound_elsewhere';
  if (e.constraint === 'bots_workspace_id_key') return 'workspace_has_bot';
  return null;
}

/** A token the current key cannot decrypt is an outcome (needs a new token), not a crash. */
function decryptOrNull(cipher: TokenCipher, blob: Buffer): string | null {
  try {
    return cipher.decrypt(blob);
  } catch (err) {
    if (err instanceof TokenDecryptError) return null;
    throw err;
  }
}

/** The row is live with this epoch (and check time, when given): no other writer changed it. */
const liveAsWritten = (guard: LiveRowGuard) => (eb: ExpressionBuilder<DB, 'bots'>) =>
  eb.and([
    eb('state', '<>', 'disconnected'),
    eb('connected_at', '=', guard.connectedAt),
    ...(guard.lastCheckedAt ? [eb('last_checked_at', '=', guard.lastCheckedAt)] : []),
  ]);

export function createBotRepo(db: Db, cipher: TokenCipher): BotRepo {
  return {
    async findByWorkspace(workspaceId, tx) {
      const row = await (tx ?? db)
        .selectFrom('bots')
        .select(PUBLIC_COLUMNS)
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirst();
      return row ? toRecord(row) : null;
    },

    async insert(workspaceId, bot, tx) {
      try {
        await (tx ?? db)
          .insertInto('bots')
          .values({
            id: bot.id,
            workspace_id: workspaceId,
            telegram_bot_id: bot.telegramBotId,
            name: bot.name,
            username: bot.username,
            state: bot.state,
            token_encrypted: cipher.encrypt(bot.token),
            webhook_secret_hash: hashSecret(bot.webhookSecret),
            connected_at: bot.connectedAt,
            last_checked_at: bot.lastCheckedAt,
            created_at: bot.createdAt,
          })
          .execute();
        return { ok: true };
      } catch (err) {
        const reason = uniqueViolation(err);
        if (reason) return { ok: false, reason };
        throw err;
      }
    },

    async update(workspaceId, botId, patch, tx, ifRead) {
      if (patch.state === 'needs_token' && patch.stoppedWorkingAt === undefined) {
        throw new Error('a needs_token patch carries stoppedWorkingAt (AC-12)');
      }
      try {
        const result = await (tx ?? db)
          .updateTable('bots')
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.username !== undefined && { username: patch.username }),
            ...(patch.state !== undefined && { state: patch.state }),
            // The moment the bot stopped working (AC-12), from the app's clock — never the old
            // exchange time a restoring patch carries; a row already needing a token keeps its own.
            ...(patch.state === 'needs_token' && {
              needs_token_at: sql<Date>`CASE WHEN state = 'needs_token' THEN needs_token_at ELSE ${patch.stoppedWorkingAt}::timestamptz END`,
            }),
            ...(patch.token !== undefined && { token_encrypted: cipher.encrypt(patch.token) }),
            ...(patch.webhookSecret !== undefined && {
              webhook_secret_hash: hashSecret(patch.webhookSecret),
            }),
            ...(patch.connectedAt !== undefined && { connected_at: patch.connectedAt }),
            ...(patch.lastCheckedAt !== undefined && { last_checked_at: patch.lastCheckedAt }),
          })
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', botId)
          .$if(ifRead === 'disconnected', (qb) => qb.where('state', '=', 'disconnected'))
          .$if(ifRead !== undefined && ifRead !== 'disconnected', (qb) =>
            qb.where(liveAsWritten(ifRead as LiveRowGuard)),
          )
          .executeTakeFirst();
        return result.numUpdatedRows > 0n ? { ok: true } : { ok: false, reason: 'not_found' };
      } catch (err) {
        const reason = uniqueViolation(err);
        if (reason) return { ok: false, reason };
        throw err;
      }
    },

    async setState(workspaceId, botId, state, checkedAt, options, tx) {
      const identity = options?.identity;
      const read = options?.ifLastCheckedAt;
      const result = await (tx ?? db)
        .updateTable('bots')
        .set({
          state,
          last_checked_at: checkedAt,
          ...(state === 'needs_token' && { needs_token_at: checkedAt }),
          ...(identity && { name: identity.name, username: identity.username }),
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .where('state', '<>', 'disconnected')
        .$if(read !== undefined, (qb) =>
          read === null || read === undefined
            ? qb.where('last_checked_at', 'is', null)
            : qb.where('last_checked_at', '=', read),
        )
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async clearOnDisconnect(workspaceId, botId, tx, ifWritten) {
      const result = await (tx ?? db)
        .updateTable('bots')
        .set({
          state: 'disconnected',
          token_encrypted: null,
          webhook_secret_hash: null,
          connected_at: null,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .$if(ifWritten !== undefined, (qb) => qb.where(liveAsWritten(ifWritten!)))
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async delete(workspaceId, botId, tx, ifWritten) {
      const result = await (tx ?? db)
        .deleteFrom('bots')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .$if(ifWritten !== undefined, (qb) => qb.where(liveAsWritten(ifWritten!)))
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },

    async pauseSends(workspaceId, botId, until, tx) {
      const result = await (tx ?? db)
        .updateTable('bots')
        .set({ send_paused_until: sql`GREATEST(send_paused_until, ${until}::timestamptz)` })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async findForCheck(workspaceId, botId, tx) {
      const row = await (tx ?? db)
        .selectFrom('bots')
        .select([...PUBLIC_COLUMNS, 'token_encrypted'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .where('state', '<>', 'disconnected')
        .executeTakeFirst();
      if (!row?.token_encrypted) return null;
      const { token_encrypted, ...rest } = row;
      return { bot: toRecord(rest), token: decryptOrNull(cipher, token_encrypted) };
    },

    async findByWebhookId(botId, secret) {
      // A non-UUID id is an unknown bot, not an error: the webhook gives no hint (ADR-0002).
      if (!UUID.test(botId) || !secret) return null;
      const row = await db
        .selectFrom('bots')
        .select([...PUBLIC_COLUMNS, 'webhook_secret_hash'])
        .where('id', '=', botId)
        .executeTakeFirst();
      if (!row || !secretMatches(secret, row.webhook_secret_hash)) return null;
      return toRecord(row);
    },

    async listDueForCheck(now) {
      const rows = await db
        .selectFrom('bots')
        .select(['id', 'workspace_id'])
        .where('state', 'in', ['connected', 'taken_over'])
        .where('last_checked_at', '<=', new Date(now.getTime() - DUE_AFTER_MS))
        .execute();
      return rows.map((r) => ({ botId: r.id, workspaceId: r.workspace_id }));
    },
  };
}
