import { DUE_AFTER_MS } from '../domain/health.js';
import type { NormalisedEdit, NormalisedMessage } from '../domain/inbound.js';
import type {
  BotRecord,
  BotRepo,
  ContactsApi,
  ConversationsApi,
  GetMeResult,
  NewBot,
  TelegramGateway,
  Transaction,
  WebhookTarget,
} from './ports.js';

/** A stored bot row of the fake repository, with the plain token and secret it would encrypt / hash. */
export interface FakeBotRow extends BotRecord {
  token: string | null;
  webhookSecret: string | null;
  /** The stored token cannot be decrypted (the encryption key was lost or changed). */
  undecryptable?: boolean;
}

/** In-memory BotRepo for unit tests; mirrors the SQL's constraints and tenancy filters. */
export function fakeBotRepo(): BotRepo & { rows: FakeBotRow[] } {
  const rows: FakeBotRow[] = [];
  const find = (w: string, id: string) => rows.find((r) => r.workspaceId === w && r.id === id);
  const boundElsewhere = (w: string, telegramBotId: bigint, id?: string) =>
    rows.some((r) => r.telegramBotId === telegramBotId && r.id !== id && r.workspaceId !== w);
  const record = (r: FakeBotRow): BotRecord => {
    const copy: Partial<FakeBotRow> = { ...r };
    delete copy.token;
    delete copy.webhookSecret;
    delete copy.undecryptable;
    return copy as BotRecord;
  };

  return {
    rows,
    async findByWorkspace(workspaceId) {
      const row = rows.find((r) => r.workspaceId === workspaceId);
      return row ? record(row) : null;
    },
    async insert(workspaceId, bot: NewBot) {
      if (boundElsewhere(workspaceId, bot.telegramBotId)) {
        return { ok: false, reason: 'bound_elsewhere' };
      }
      if (rows.some((r) => r.workspaceId === workspaceId)) {
        return { ok: false, reason: 'workspace_has_bot' };
      }
      if (rows.some((r) => r.telegramBotId === bot.telegramBotId)) {
        throw new Error('unique violation');
      }
      rows.push({ ...bot, workspaceId });
      return { ok: true };
    },
    async update(workspaceId, botId, patch, _tx, ifRead) {
      const row = find(workspaceId, botId);
      if (!row) return { ok: false, reason: 'not_found' };
      if (ifRead === 'disconnected' && row.state !== 'disconnected') {
        return { ok: false, reason: 'not_found' };
      }
      if (
        ifRead &&
        ifRead !== 'disconnected' &&
        (row.state === 'disconnected' ||
          row.connectedAt?.getTime() !== ifRead.connectedAt.getTime())
      ) {
        return { ok: false, reason: 'not_found' };
      }
      const next = { ...row, ...patch };
      // The bots_*_state_check constraints: a live row has token, secret hash and epoch.
      if (
        next.state !== 'disconnected' &&
        (next.token === null || next.webhookSecret === null || next.connectedAt === null)
      ) {
        throw new Error('check violation: a live bot row needs token, secret and epoch');
      }
      Object.assign(row, patch);
      if (patch.token !== undefined) delete row.undecryptable;
      return { ok: true };
    },
    async setState(workspaceId, botId, state, checkedAt, options) {
      const row = find(workspaceId, botId);
      if (!row || row.state === 'disconnected') return false;
      const read = options?.ifLastCheckedAt;
      if (read !== undefined && row.lastCheckedAt?.getTime() !== read?.getTime()) return false;
      Object.assign(row, { state, lastCheckedAt: checkedAt }, options?.identity ?? {});
      return true;
    },
    async clearOnDisconnect(workspaceId, botId) {
      const row = find(workspaceId, botId);
      if (!row) return false;
      Object.assign(row, {
        state: 'disconnected',
        token: null,
        webhookSecret: null,
        connectedAt: null,
      });
      return true;
    },
    async delete(workspaceId, botId) {
      const i = rows.findIndex((r) => r.workspaceId === workspaceId && r.id === botId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async findForCheck(workspaceId, botId) {
      const row = find(workspaceId, botId);
      if (!row || row.state === 'disconnected' || row.token === null) return null;
      return { bot: record(row), token: row.undecryptable ? null : row.token };
    },
    async findByWebhookId(botId, secret) {
      const row = rows.find((r) => r.id === botId);
      if (!row || !secret || row.webhookSecret !== secret) return null;
      return record(row);
    },
    async listDueForCheck(now) {
      return rows
        .filter(
          (r) =>
            (r.state === 'connected' || r.state === 'taken_over') &&
            r.lastCheckedAt !== null &&
            now.getTime() - r.lastCheckedAt.getTime() >= DUE_AFTER_MS,
        )
        .map((r) => ({ botId: r.id, workspaceId: r.workspaceId }));
    },
  };
}

export interface GatewayCall {
  method: 'getMe' | 'getWebhook' | 'setWebhook' | 'deleteWebhook';
  token: string;
  timeoutMs: number;
  webhook?: { url: string; secret: string; dropPending: boolean };
  ourUrl?: string;
}

/** Scriptable TelegramGateway for unit tests: set the next answers, read the calls made. */
export function fakeGateway(): TelegramGateway & {
  calls: GatewayCall[];
  me: GetMeResult;
  webhook: WebhookTarget;
  setResult: 'ok' | 'failed';
  deleteResult: 'ok' | 'failed';
} {
  const fake = {
    calls: [] as GatewayCall[],
    me: {
      ok: true,
      telegramBotId: 100001n,
      name: 'Acme Flowers Bot',
      username: 'acme_flowers_bot',
    } as GetMeResult,
    webhook: 'ours' as WebhookTarget,
    setResult: 'ok' as 'ok' | 'failed',
    deleteResult: 'ok' as 'ok' | 'failed',
    async getMe(token: string, timeoutMs: number) {
      fake.calls.push({ method: 'getMe', token, timeoutMs });
      return fake.me;
    },
    async getWebhook(token: string, ourUrl: string, timeoutMs: number) {
      fake.calls.push({ method: 'getWebhook', token, timeoutMs, ourUrl });
      return fake.webhook;
    },
    async setWebhook(
      token: string,
      webhook: { url: string; secret: string; dropPending: boolean },
      timeoutMs: number,
    ) {
      fake.calls.push({ method: 'setWebhook', token, timeoutMs, webhook });
      return fake.setResult;
    },
    async deleteWebhook(token: string, timeoutMs: number) {
      fake.calls.push({ method: 'deleteWebhook', token, timeoutMs });
      return fake.deleteResult;
    },
  };
  return fake;
}

/**
 * A fake transaction over a fake BotRepo: runs `fn` and, when it throws, restores the rows it
 * started from — the rollback the real transaction gives.
 */
export function fakeBotTransaction(repo: { rows: FakeBotRow[] }): Transaction {
  return async (fn) => {
    const snapshot = repo.rows.map((r) => ({ ...r }));
    try {
      return await fn(undefined as never);
    } catch (err) {
      repo.rows.splice(0, repo.rows.length, ...snapshot);
      throw err;
    }
  };
}

/** Scriptable conversations / contacts app layers as `bots` sees them. */
export function fakeConversationsApi(): ConversationsApi & {
  last: Map<string, Date>;
  withConversations: Set<string>;
  captured: { workspaceId: string; message: NormalisedMessage }[];
  edits: { workspaceId: string; edit: NormalisedEdit }[];
  editOutcome: 'applied' | 'not_later' | 'not_found';
} {
  const fake = {
    last: new Map<string, Date>(),
    withConversations: new Set<string>(),
    captured: [] as { workspaceId: string; message: NormalisedMessage }[],
    edits: [] as { workspaceId: string; edit: NormalisedEdit }[],
    editOutcome: 'applied' as 'applied' | 'not_later' | 'not_found',
    lastMessageReceivedAt: async (w: string) => fake.last.get(w) ?? null,
    hasConversations: async (w: string) => fake.withConversations.has(w),
    async captureInbound(workspaceId: string, message: NormalisedMessage) {
      const seen = fake.captured.some(
        (c) =>
          c.workspaceId === workspaceId &&
          c.message.chatId === message.chatId &&
          c.message.messageId === message.messageId,
      );
      if (seen) return 'already_present' as const;
      fake.captured.push({ workspaceId, message });
      fake.withConversations.add(workspaceId);
      return 'captured' as const;
    },
    async applyEdit(workspaceId: string, edit: NormalisedEdit) {
      fake.edits.push({ workspaceId, edit });
      return fake.editOutcome;
    },
  };
  return fake;
}

export function fakeContactsApi(): ContactsApi & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return { counts, countContacts: async (w) => counts.get(w) ?? 0 };
}
