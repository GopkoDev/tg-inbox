import { GrammyError, HttpError, type Api } from 'grammy';
import { telegramApi } from '../../../platform/telegram.js';
import type { SendOutcome, TelegramGateway } from '../app/ports.js';

export interface TelegramGatewayOptions {
  /** `TELEGRAM_API_ROOT`; unset = Telegram's. */
  apiRoot?: string;
  /** `TELEGRAM_WEBHOOK_MAX_CONNECTIONS`. */
  maxConnections: number;
}

/** grammY types its signal with the abort-controller polyfill; Node's AbortSignal is compatible. */
type Signal = Parameters<Api['getMe']>[0];
const timeout = (ms: number) => AbortSignal.timeout(ms) as unknown as Signal;

const ALLOWED_UPDATES = ['message', 'edited_message'] as const;

/**
 * grammY errors become typed outcomes here. Their messages, causes and URLs (which embed the
 * token) are never copied into a result, an error or a log line.
 */
function isUnauthorized(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 401 || err.error_code === 404);
}

/** Socket errors that occur before any byte of the request was written. */
const NOT_WRITTEN = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

function causeCodes(err: unknown): string[] {
  const codes: string[] = [];
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; i++) {
    const { code, cause, error } = e as { code?: unknown; cause?: unknown; error?: unknown };
    if (typeof code === 'string') codes.push(code);
    e = cause ?? error;
  }
  return codes;
}

/** Classifies a failed sendMessage without copying Telegram's text, the URL or the token. */
function classifySendError(err: unknown): SendOutcome {
  if (err instanceof GrammyError) {
    const code = err.error_code;
    if (code === 401 || code === 404) return { outcome: 'bot_unauthorized' };
    if (code === 403) {
      return /deactivated/i.test(err.description)
        ? { outcome: 'refused', reason: 'account_gone' }
        : { outcome: 'refused', reason: 'blocked' };
    }
    if (code === 400) return { outcome: 'refused', reason: 'chat_not_found' };
    if (code === 429) {
      const seconds = err.parameters.retry_after;
      return typeof seconds === 'number' && seconds >= 0
        ? { outcome: 'not_accepted', retryAfterMs: seconds * 1000 }
        : { outcome: 'not_accepted' };
    }
    return code >= 500 ? { outcome: 'not_accepted' } : { outcome: 'unknown' };
  }
  // A network failure: safe to retry only when nothing was written.
  if (err instanceof HttpError && causeCodes(err).some((c) => NOT_WRITTEN.has(c))) {
    return { outcome: 'not_accepted' };
  }
  return { outcome: 'unknown' };
}

/** Same webhook when scheme, host and path match, ignoring a trailing slash. */
function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '');
    return (
      x.protocol === y.protocol && x.host === y.host && path(x) === path(y) && x.search === y.search
    );
  } catch {
    return false;
  }
}

/** A URL under the same webhook path as ours (same origin, path up to the bot row id). */
function underOurWebhookPath(url: string, ourUrl: string): boolean {
  try {
    const x = new URL(url);
    const y = new URL(ourUrl);
    const prefix = y.pathname.slice(0, y.pathname.lastIndexOf('/') + 1);
    return x.protocol === y.protocol && x.host === y.host && x.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export function createTelegramGateway({
  apiRoot,
  maxConnections,
}: TelegramGatewayOptions): TelegramGateway {
  const api = (token: string) => telegramApi(token, apiRoot ? { apiRoot } : {});

  return {
    async sendText(token, chatId, text, timeoutMs) {
      try {
        const sent = await api(token).sendMessage(
          Number(chatId),
          text,
          undefined,
          timeout(timeoutMs),
        );
        return {
          outcome: 'accepted',
          messageId: BigInt(sent.message_id),
          at: new Date(sent.date * 1000),
        };
      } catch (err) {
        return classifySendError(err);
      }
    },

    async getMe(token, timeoutMs) {
      try {
        const me = await api(token).getMe(timeout(timeoutMs));
        return {
          ok: true,
          telegramBotId: BigInt(me.id),
          name: me.first_name,
          username: me.username,
        };
      } catch (err) {
        return isUnauthorized(err) ? 'unauthorized' : 'transient';
      }
    },

    async getWebhook(token, ourUrl, timeoutMs) {
      try {
        const info = await api(token).getWebhookInfo(timeout(timeoutMs));
        if (!info.url) return 'none';
        if (sameUrl(info.url, ourUrl)) return 'ours';
        return underOurWebhookPath(info.url, ourUrl) ? 'stale' : 'foreign';
      } catch (err) {
        return isUnauthorized(err) ? 'unauthorized' : 'transient';
      }
    },

    async setWebhook(token, { url, secret, dropPending }, timeoutMs) {
      try {
        await api(token).setWebhook(
          url,
          {
            secret_token: secret,
            allowed_updates: [...ALLOWED_UPDATES],
            max_connections: maxConnections,
            drop_pending_updates: dropPending,
          },
          timeout(timeoutMs),
        );
        return 'ok';
      } catch {
        return 'failed';
      }
    },

    async deleteWebhook(token, timeoutMs) {
      try {
        await api(token).deleteWebhook({ drop_pending_updates: true }, timeout(timeoutMs));
        return 'ok';
      } catch {
        return 'failed';
      }
    },
  };
}
