import type { Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { DestinationCodes } from '../../../platform/db.types.gen.js';

/** 'no_send_right' = a group where the bot may not send messages; 'no_post_right' = a channel. */
export type CodeResult = 'connected' | 'no_post_right' | 'no_send_right' | 'destination_limit';

export interface CodeRecord {
  id: string;
  workspaceId: string;
  accountId: string;
  codeHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
  replacedAt: Date | null;
  usedAt: Date | null;
  destinationId: string | null;
  result: CodeResult | null;
  resultAt: Date | null;
}

export interface NewCode {
  id: string;
  accountId: string;
  codeHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

function toCode(r: Selectable<DestinationCodes>): CodeRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    codeHash: r.code_hash,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    replacedAt: r.replaced_at,
    usedAt: r.used_at,
    destinationId: r.destination_id,
    result: r.result as CodeResult | null,
    resultAt: r.result_at,
  };
}

export function createCodeRepo(db: Db) {
  return {
    async insert(workspaceId: string, c: NewCode, tx?: Db): Promise<CodeRecord> {
      const row = await (tx ?? db)
        .insertInto('destination_codes')
        .values({
          id: c.id,
          workspace_id: workspaceId,
          account_id: c.accountId,
          code_hash: c.codeHash,
          created_at: c.createdAt,
          expires_at: c.expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toCode(row);
    },

    async find(workspaceId: string, id: string, tx?: Db): Promise<CodeRecord | null> {
      const row = await (tx ?? db)
        .selectFrom('destination_codes')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toCode(row) : null;
    },

    async findByHash(workspaceId: string, hash: Buffer, tx?: Db): Promise<CodeRecord | null> {
      const row = await (tx ?? db)
        .selectFrom('destination_codes')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('code_hash', '=', hash)
        .executeTakeFirst();
      return row ? toCode(row) : null;
    },

    /** Retires the account's live (unused, unreplaced, unexpired) codes; returns how many. */
    async replacePrevious(
      workspaceId: string,
      accountId: string,
      at: Date,
      tx?: Db,
    ): Promise<number> {
      const res = await (tx ?? db)
        .updateTable('destination_codes')
        .set({ replaced_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .where('used_at', 'is', null)
        .where('replaced_at', 'is', null)
        .where('expires_at', '>', at)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    },

    /** Spends a code once; false when it is foreign, already used or replaced. */
    async markUsed(
      workspaceId: string,
      id: string,
      destinationId: string,
      at: Date,
      tx?: Db,
    ): Promise<boolean> {
      const res = await (tx ?? db)
        .updateTable('destination_codes')
        .set({ used_at: at, destination_id: destinationId, result: 'connected', result_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('used_at', 'is', null)
        .where('replaced_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },

    async markResult(
      workspaceId: string,
      id: string,
      result: Exclude<CodeResult, 'connected'>,
      at: Date,
      tx?: Db,
    ): Promise<boolean> {
      const res = await (tx ?? db)
        .updateTable('destination_codes')
        .set({ result, result_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },
  };
}

export type CodeRepo = ReturnType<typeof createCodeRepo>;
