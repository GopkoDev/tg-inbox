import type { Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Bots } from '../../../platform/db.types.gen.js';
import type { BotState } from '../domain/connection.js';
import { DUE_AFTER_MS } from '../domain/health.js';
import type { BotRecord, BotRepo, TokenCipher } from '../app/ports.js';
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
  };
}

function isBoundElsewhere(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === 'bots_telegram_bot_id_key';
}

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
        if (isBoundElsewhere(err)) return { ok: false, reason: 'bound_elsewhere' };
        throw err;
      }
    },

    async update(workspaceId, botId, patch, tx) {
      try {
        const result = await (tx ?? db)
          .updateTable('bots')
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.username !== undefined && { username: patch.username }),
            ...(patch.state !== undefined && { state: patch.state }),
            ...(patch.token !== undefined && { token_encrypted: cipher.encrypt(patch.token) }),
            ...(patch.webhookSecret !== undefined && {
              webhook_secret_hash: hashSecret(patch.webhookSecret),
            }),
            ...(patch.connectedAt !== undefined && { connected_at: patch.connectedAt }),
            ...(patch.lastCheckedAt !== undefined && { last_checked_at: patch.lastCheckedAt }),
          })
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', botId)
          .executeTakeFirst();
        return result.numUpdatedRows > 0n ? { ok: true } : { ok: false, reason: 'not_found' };
      } catch (err) {
        if (isBoundElsewhere(err)) return { ok: false, reason: 'bound_elsewhere' };
        throw err;
      }
    },

    async setState(workspaceId, botId, state, checkedAt, identity, tx) {
      const result = await (tx ?? db)
        .updateTable('bots')
        .set({
          state,
          last_checked_at: checkedAt,
          ...(identity && { name: identity.name, username: identity.username }),
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .where('state', '<>', 'disconnected')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async clearOnDisconnect(workspaceId, botId, tx) {
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
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async delete(workspaceId, botId, tx) {
      const result = await (tx ?? db)
        .deleteFrom('bots')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', botId)
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
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
      return { bot: toRecord(rest), token: cipher.decrypt(token_encrypted) };
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
