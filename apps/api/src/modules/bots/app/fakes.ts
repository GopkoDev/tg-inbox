import { DUE_AFTER_MS } from '../domain/health.js';
import type { NormalisedEdit, NormalisedMessage } from '../domain/inbound.js';
import type {
  LiveRowGuard,
  BotRecord,
  BotRepo,
  BotSignals,
  ContactsApi,
  BroadcastSendAnswer,
  ContactsReach,
  FileFetch,
  ConversationsApi,
  GetMeResult,
  InboundInterceptor,
  InterceptInput,
  NewBot,
  SendOutcome,
  TelegramGateway,
  Transaction,
  WebhookTarget,
} from './ports.js';

/** A stored bot row of the fake repository, with the plain token and secret it would encrypt / hash. */
export interface FakeBotRow extends Omit<BotRecord, 'sendPausedUntil' | 'stoppedWorkingAt'> {
  /** Absent = not paused. */
  sendPausedUntil?: Date | null;
  /** Absent = the token was never rejected. */
  stoppedWorkingAt?: Date | null;
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
  const matches = (r: FakeBotRow, g: LiveRowGuard | undefined) =>
    g === undefined ||
    (r.state !== 'disconnected' &&
      r.connectedAt?.getTime() === g.connectedAt.getTime() &&
      (g.lastCheckedAt === undefined || r.lastCheckedAt?.getTime() === g.lastCheckedAt.getTime()));
  const record = (r: FakeBotRow): BotRecord => {
    const copy: Partial<FakeBotRow> = { ...r };
    delete copy.token;
    delete copy.webhookSecret;
    delete copy.undecryptable;
    return {
      ...copy,
      sendPausedUntil: r.sendPausedUntil ?? null,
      stoppedWorkingAt: r.stoppedWorkingAt ?? null,
    } as BotRecord;
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
      if (ifRead && ifRead !== 'disconnected' && !matches(row, ifRead)) {
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
      const wasNeedingToken = row.state === 'needs_token';
      Object.assign(row, patch);
      if (patch.state === 'needs_token' && !wasNeedingToken) row.stoppedWorkingAt = new Date();
      if (patch.token !== undefined) delete row.undecryptable;
      return { ok: true };
    },
    async setState(workspaceId, botId, state, checkedAt, options) {
      const row = find(workspaceId, botId);
      if (!row || row.state === 'disconnected') return false;
      const read = options?.ifLastCheckedAt;
      if (read !== undefined && row.lastCheckedAt?.getTime() !== read?.getTime()) return false;
      Object.assign(row, { state, lastCheckedAt: checkedAt }, options?.identity ?? {});
      if (state === 'needs_token') row.stoppedWorkingAt = checkedAt;
      return true;
    },
    async clearOnDisconnect(workspaceId, botId, _tx, ifWritten) {
      const row = find(workspaceId, botId);
      if (!row || !matches(row, ifWritten)) return false;
      Object.assign(row, {
        state: 'disconnected',
        token: null,
        webhookSecret: null,
        connectedAt: null,
      });
      return true;
    },
    async delete(workspaceId, botId, _tx, ifWritten) {
      const i = rows.findIndex((r) => r.workspaceId === workspaceId && r.id === botId);
      if (i < 0 || !matches(rows[i]!, ifWritten)) return false;
      rows.splice(i, 1);
      return true;
    },
    async pauseSends(workspaceId, botId, until) {
      const row = find(workspaceId, botId);
      if (!row) return false;
      if (!row.sendPausedUntil || row.sendPausedUntil.getTime() < until.getTime()) {
        row.sendPausedUntil = until;
      }
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
  method:
    | 'getMe'
    | 'getWebhook'
    | 'setWebhook'
    | 'deleteWebhook'
    | 'sendText'
    | 'sendBroadcast'
    | 'openFile';
  token: string;
  timeoutMs: number;
  webhook?: { url: string; secret: string; dropPending: boolean };
  ourUrl?: string;
  chatId?: bigint;
  text?: string;
  options?: { disableLinkPreview?: boolean } | undefined;
  fileReference?: string;
  range?: string | undefined;
}

/** Scriptable TelegramGateway for unit tests: set the next answers, read the calls made. */
export function fakeGateway(): TelegramGateway & {
  calls: GatewayCall[];
  me: GetMeResult;
  webhook: WebhookTarget;
  setResult: 'ok' | 'failed';
  deleteResult: 'ok' | 'failed';
  sendResult: SendOutcome;
  broadcastResult: BroadcastSendAnswer;
  fileResult: FileFetch;
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
    sendResult: { outcome: 'accepted', messageId: 1n, at: new Date(0) } as SendOutcome,
    broadcastResult: { outcome: 'accepted', messageId: 1n, at: new Date(0) } as BroadcastSendAnswer,
    fileResult: { outcome: 'gone' } as FileFetch,
    async openFile(token: string, fileReference: string, range: string | undefined) {
      fake.calls.push({ method: 'openFile', token, timeoutMs: 0, fileReference, range });
      return fake.fileResult;
    },
    async sendText(
      token: string,
      chatId: bigint,
      text: string,
      timeoutMs: number,
      options?: { disableLinkPreview?: boolean },
    ) {
      fake.calls.push({
        method: 'sendText',
        token,
        timeoutMs,
        chatId,
        text,
        ...(options ? { options } : {}),
      });
      return fake.sendResult;
    },
    async sendBroadcast(token: string, chatId: bigint, text: string, timeoutMs: number) {
      fake.calls.push({ method: 'sendBroadcast', token, timeoutMs, chatId, text });
      return fake.broadcastResult;
    },
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
export function fakeBotTransaction(
  repo: { rows: FakeBotRow[] },
  signals?: { published: string[] },
): Transaction {
  return async (fn) => {
    const snapshot = repo.rows.map((r) => ({ ...r }));
    const published = signals?.published.length ?? 0;
    try {
      return await fn(undefined as never);
    } catch (err) {
      repo.rows.splice(0, repo.rows.length, ...snapshot);
      // A signal published in a rolled-back transaction is never delivered.
      signals?.published.splice(published);
      throw err;
    }
  };
}

/** Records the workspace of every `bot.changed` signal published. */
export function fakeBotSignals(): BotSignals & { published: string[] } {
  const published: string[] = [];
  return {
    published,
    async botChanged(_tx, workspaceId) {
      published.push(workspaceId);
    },
  };
}

/** A captured message as `bots` hands it over: with the receiving bot's Telegram id. */
type CapturedMessage = NormalisedMessage & { telegramBotId: bigint };

/** Scriptable conversations / contacts app layers as `bots` sees them. */
export function fakeConversationsApi(): ConversationsApi & {
  last: Map<string, Date>;
  withConversations: Set<string>;
  captured: { workspaceId: string; message: CapturedMessage }[];
  edits: { workspaceId: string; edit: NormalisedEdit }[];
  editOutcome: 'applied' | 'not_later' | 'not_found';
} {
  const fake = {
    last: new Map<string, Date>(),
    withConversations: new Set<string>(),
    captured: [] as { workspaceId: string; message: CapturedMessage }[],
    edits: [] as { workspaceId: string; edit: NormalisedEdit }[],
    editOutcome: 'applied' as 'applied' | 'not_later' | 'not_found',
    lastMessageReceivedAt: async (w: string) => fake.last.get(w) ?? null,
    hasConversations: async (w: string) => fake.withConversations.has(w),
    async captureInbound(workspaceId: string, message: CapturedMessage) {
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

/** Records what the interceptor was asked; answers `pass` unless told otherwise. */
export function fakeInterceptor(): InboundInterceptor & {
  calls: InterceptInput[];
  answer: 'pass' | 'consumed';
  fail: boolean;
} {
  const fake = {
    calls: [] as InterceptInput[],
    answer: 'pass' as 'pass' | 'consumed',
    fail: false,
    async intercept(input: InterceptInput) {
      fake.calls.push(input);
      if (fake.fail) throw new Error('interceptor down');
      return fake.answer;
    },
  };
  return fake;
}

/** Records `contacts.recordBlockChange` calls as `bots` makes them; `fail` makes it throw. */
export function fakeContactsReach(): ContactsReach & {
  changes: {
    workspaceId: string;
    telegramBotId: bigint;
    telegramUserId: bigint;
    blocked: boolean;
    at: Date;
  }[];
  fail: boolean;
} {
  const fake = {
    changes: [] as {
      workspaceId: string;
      telegramBotId: bigint;
      telegramUserId: bigint;
      blocked: boolean;
      at: Date;
    }[],
    fail: false,
    async recordBlockChange(
      workspaceId: string,
      telegramBotId: bigint,
      telegramUserId: bigint,
      blocked: boolean,
      at: Date,
    ) {
      if (fake.fail) throw new Error('contacts down');
      fake.changes.push({ workspaceId, telegramBotId, telegramUserId, blocked, at });
      return true;
    },
  };
  return fake;
}
