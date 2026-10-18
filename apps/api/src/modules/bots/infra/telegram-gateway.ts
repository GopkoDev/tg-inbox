import { Readable } from 'node:stream';
import { GrammyError, HttpError, type Api } from 'grammy';
import { telegramApi } from '../../../platform/telegram.js';
import {
  DOWNLOAD_IDLE_TIMEOUT,
  GET_FILE_TIMEOUT,
  MAX_DOWNLOAD_BYTES,
  type FileFetch,
  type SendOutcome,
  type TelegramGateway,
} from '../app/ports.js';

export interface TelegramGatewayOptions {
  /** `TELEGRAM_API_ROOT`; unset = Telegram's. */
  apiRoot?: string;
  /** `TELEGRAM_WEBHOOK_MAX_CONNECTIONS`. */
  maxConnections: number;
  /** `getFile` timeout; defaults to 5 s (tests shorten it). */
  getFileTimeoutMs?: number;
  /** Idle timeout of a media download; defaults to 30 s (tests shorten it). */
  downloadIdleTimeoutMs?: number;
  /** Time source of the file path cache (tests). */
  now?: () => number;
}

/** Telegram keeps a `file_path` valid for at least an hour; we trust it for less. */
const FILE_PATH_TTL_MS = 50 * 60 * 1000;
const FILE_PATH_CACHE_MAX = 5000;
const TELEGRAM_API_ROOT = 'https://api.telegram.org';
/** One `bytes=a-b` range; multiple ranges are not forwarded. */
const SINGLE_RANGE = /^bytes=(\d+-\d*|-\d+)$/;

type PathLookup =
  { path: string } | Exclude<FileFetch, { outcome: 'stream' | 'range_not_satisfiable' }>;

/**
 * Reads a download body, aborting when no byte arrives for `idleMs`. The timer runs only while
 * waiting on Telegram, never while the consumer is slow. Errors are replaced by a generic one:
 * the original may carry the download URL.
 */
async function* idleGuarded(
  body: AsyncIterable<Uint8Array>,
  controller: AbortController,
  idleMs: number,
): AsyncGenerator<Buffer> {
  const it = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const timer = setTimeout(() => controller.abort(), idleMs);
      try {
        const step = await it.next();
        if (step.done) return;
        yield Buffer.from(step.value);
      } catch {
        throw new Error('media download failed');
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    controller.abort();
  }
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
  getFileTimeoutMs = GET_FILE_TIMEOUT,
  downloadIdleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT,
  now = Date.now,
}: TelegramGatewayOptions): TelegramGateway {
  const api = (token: string) => telegramApi(token, apiRoot ? { apiRoot } : {});
  // Keyed by bot id (the token's prefix), never by the token; Map keeps insertion order.
  const paths = new Map<string, { path: string; expiresAt: number }>();
  const pathKey = (token: string, fileReference: string) =>
    `${token.split(':')[0]}:${fileReference}`;

  async function filePath(token: string, fileReference: string): Promise<PathLookup> {
    const key = pathKey(token, fileReference);
    const hit = paths.get(key);
    if (hit && hit.expiresAt > now()) return { path: hit.path };
    paths.delete(key);
    try {
      const file = await api(token).getFile(fileReference, timeout(getFileTimeoutMs));
      if (file.file_size !== undefined && file.file_size > MAX_DOWNLOAD_BYTES) {
        return { outcome: 'too_large' };
      }
      if (!file.file_path) return { outcome: 'gone' };
      if (paths.size >= FILE_PATH_CACHE_MAX) paths.delete(paths.keys().next().value!);
      paths.set(key, { path: file.file_path, expiresAt: now() + FILE_PATH_TTL_MS });
      return { path: file.file_path };
    } catch (err) {
      if (err instanceof GrammyError) {
        if (err.error_code === 400) {
          return { outcome: /too big/i.test(err.description) ? 'too_large' : 'gone' };
        }
        if (isUnauthorized(err)) return { outcome: 'unauthorized' };
      }
      return { outcome: 'unavailable' };
    }
  }

  async function download(
    token: string,
    path: string,
    range: string | undefined,
  ): Promise<FileFetch | 'not_found'> {
    const controller = new AbortController();
    const headerTimer = setTimeout(() => controller.abort(), downloadIdleTimeoutMs);
    // The URL embeds the token: it is built here, used once and never leaves this function.
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const url = `${apiRoot ?? TELEGRAM_API_ROOT}/file/bot${token}/${encoded}`;
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        ...(range && { headers: { range } }),
      });
    } catch {
      controller.abort();
      return { outcome: 'unavailable' };
    } finally {
      clearTimeout(headerTimer);
    }
    if (res.status === 200 || res.status === 206) {
      if (!res.body) return { outcome: 'unavailable' };
      const length = Number(res.headers.get('content-length'));
      const contentRange = res.headers.get('content-range');
      return {
        outcome: 'stream',
        body: Readable.from(idleGuarded(res.body, controller, downloadIdleTimeoutMs), {
          objectMode: false,
        }),
        status: res.status,
        contentLength: res.headers.has('content-length') && Number.isFinite(length) ? length : null,
        ...(contentRange && { contentRange }),
      };
    }
    await res.body?.cancel().catch(() => undefined);
    controller.abort();
    if (res.status === 416) return { outcome: 'range_not_satisfiable' };
    if (res.status === 401) return { outcome: 'unauthorized' };
    if (res.status === 404) return 'not_found';
    if (res.status === 400 || res.status === 403) return { outcome: 'gone' };
    return { outcome: 'unavailable' };
  }

  return {
    async openFile(token, fileReference, range) {
      const forwarded = range && SINGLE_RANGE.test(range) ? range : undefined;
      for (const firstTry of [true, false]) {
        const looked = await filePath(token, fileReference);
        if (!('path' in looked)) return looked;
        const fetched = await download(token, looked.path, forwarded);
        if (fetched !== 'not_found') return fetched;
        // The path may have gone stale: ask Telegram again once before calling the file gone.
        paths.delete(pathKey(token, fileReference));
        if (!firstTry) break;
      }
      return { outcome: 'gone' };
    },

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
