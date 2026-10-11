import { DUE_AFTER_MS } from '../domain/health.js';
import type {
  BotRecord,
  BotRepo,
  GetMeResult,
  NewBot,
  TelegramGateway,
  WebhookTarget,
} from './ports.js';

/** A stored bot row of the fake repository, with the plain token and secret it would encrypt / hash. */
export interface FakeBotRow extends BotRecord {
  token: string | null;
  webhookSecret: string | null;
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
      if (
        rows.some((r) => r.workspaceId === workspaceId || r.telegramBotId === bot.telegramBotId)
      ) {
        throw new Error('unique violation');
      }
      rows.push({ ...bot, workspaceId });
      return { ok: true };
    },
    async update(workspaceId, botId, patch) {
      const row = find(workspaceId, botId);
      if (!row) return { ok: false, reason: 'not_found' };
      Object.assign(row, patch);
      return { ok: true };
    },
    async setState(workspaceId, botId, state, checkedAt, identity) {
      const row = find(workspaceId, botId);
      if (!row || row.state === 'disconnected') return false;
      Object.assign(row, { state, lastCheckedAt: checkedAt }, identity ?? {});
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
      return { bot: record(row), token: row.token };
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
