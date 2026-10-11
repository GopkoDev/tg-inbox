import { GrammyError, type Api } from 'grammy';
import { telegramApi } from '../../../platform/telegram.js';
import type { TelegramGateway } from '../app/ports.js';

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
