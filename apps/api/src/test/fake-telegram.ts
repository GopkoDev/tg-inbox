import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Bot API answers as recorded from https://core.telegram.org/bots/api (and real responses of the
 * same methods). The fake builds every answer from these, so it cannot drift from Telegram's wire
 * shapes silently; `fake-telegram.test.ts` pins them. Synthetic ids and names only (PII guard).
 */
export const RECORDED = {
  getMe: {
    ok: true,
    result: {
      id: 100001,
      is_bot: true,
      first_name: 'Test Bot 100001',
      username: 'test_bot_100001',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    },
  },
  getWebhookInfoEmpty: {
    ok: true,
    result: { url: '', has_custom_certificate: false, pending_update_count: 0 },
  },
  getWebhookInfoSet: {
    ok: true,
    result: {
      url: 'https://example.test/hook',
      has_custom_certificate: false,
      pending_update_count: 0,
      max_connections: 40,
      ip_address: '192.0.2.1',
      allowed_updates: ['message', 'edited_message'],
    },
  },
  setWebhook: { ok: true, result: true, description: 'Webhook was set' },
  deleteWebhook: { ok: true, result: true, description: 'Webhook was deleted' },
  setWebhookFailed: {
    ok: false,
    error_code: 400,
    description: 'Bad Request: bad webhook: Failed to resolve host: Name or service not known',
  },
  unauthorized: { ok: false, error_code: 401, description: 'Unauthorized' },
  serverError: { ok: false, error_code: 500, description: 'Internal Server Error' },
  rateLimited: {
    ok: false,
    error_code: 429,
    description: 'Too Many Requests: retry after 5',
    parameters: { retry_after: 5 },
  },
  /** A webhook delivery of a private text message (openapi `receiveTelegramUpdate` example). */
  update: {
    update_id: 900001,
    message: {
      message_id: 42,
      date: 1791712800,
      chat: { id: 700001, type: 'private', first_name: 'Test User' },
      from: {
        id: 700001,
        is_bot: false,
        first_name: 'Test User',
        username: 'test_user_1',
        language_code: 'en',
      },
      text: 'Hello',
    },
  },
} as const;

export type GetMeBehaviour = 'ok' | 'unauthorized' | 'server_error' | 'rate_limited' | 'hang';
export type CallBehaviour = 'ok' | 'fail' | 'hang';

/** What a webhook registered by today's code subscribes to (ADR-0003). */
const CURRENT_ALLOWED_UPDATES = ['message', 'edited_message', 'my_chat_member'];

/** One scripted `sendMessage` answer — plain JSON so it crosses the control API. */
export type SendAnswer =
  | { kind: 'ok'; messageId: number }
  | { kind: 'error'; status: number; body: unknown }
  | { kind: 'hang'; ms: number }
  | { kind: 'reset' };

const failure = (status: number, description: string, parameters?: object): SendAnswer => ({
  kind: 'error',
  status,
  body: { ok: false, error_code: status, description, ...(parameters && { parameters }) },
});

export const sendAnswers = {
  ok: (messageId: number): SendAnswer => ({ kind: 'ok', messageId }),
  blocked: () => failure(403, 'Forbidden: bot was blocked by the user'),
  deactivated: () => failure(403, 'Forbidden: user is deactivated'),
  chatNotFound: () => failure(400, 'Bad Request: chat not found'),
  userNotFound: () => failure(400, 'Bad Request: user not found'),
  peerIdInvalid: () => failure(400, 'Bad Request: PEER_ID_INVALID'),
  textTooLong: () => failure(400, 'Bad Request: message is too long'),
  textEmpty: () => failure(400, 'Bad Request: message text is empty'),
  /** A 400 whose description names nothing we classify. */
  otherBadRequest: () => failure(400, 'Bad Request: something new'),
  unauthorized: (): SendAnswer => ({ kind: 'error', status: 401, body: RECORDED.unauthorized }),
  serverError: (): SendAnswer => ({ kind: 'error', status: 500, body: RECORDED.serverError }),
  tooMany: (retryAfter: number) =>
    failure(429, `Too Many Requests: retry after ${retryAfter}`, { retry_after: retryAfter }),
  /** Holds the request for `ms`, then answers ok; released early by reset()/stop(). */
  hang: (ms: number): SendAnswer => ({ kind: 'hang', ms }),
  /** Records the call, then destroys the socket without an answer. */
  resetAfterWrite: (): SendAnswer => ({ kind: 'reset' }),
};

/** A file Telegram knows (`path`, `size` bytes), or why it refuses to hand it out. */
export type FileScript = { path: string; size: number } | 'too_big' | 'not_found';

export interface BotScript {
  /** Identity returned by getMe; defaults derive from the token id (`Test Bot <id>`). */
  me?: { first_name?: string; username?: string };
  getMe?: GetMeBehaviour;
  /** URL the bot currently delivers to (another service's, or ours); '' / unset = no webhook. */
  webhookUrl?: string;
  /**
   * `allowed_updates` the webhook was registered with; unset = today's set (message,
   * edited_message, my_chat_member). `setWebhook` stores what it is given.
   */
  allowedUpdates?: string[];
  getWebhookInfo?: CallBehaviour;
  setWebhook?: CallBehaviour;
  deleteWebhook?: CallBehaviour;
  /** `sendMessage` answers, consumed one per call; afterwards every call is answered ok. */
  sendMessage?: SendAnswer[];
  /** `getFile` outcomes and downloadable files by `file_id`. */
  files?: Record<string, FileScript>;
}

export interface RecordedCall {
  token: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeTelegram {
  /** Pass as `TELEGRAM_API_ROOT` / `telegramApi(token, { apiRoot })`. */
  apiRoot: string;
  /** Scripts a token; a token never scripted is answered 401 like an unknown token. */
  bot(token: string): { script(script: BotScript): void };
  calls(token?: string): RecordedCall[];
  /** When each `sendMessage` of a token reached the fake (ms since epoch), oldest first. */
  sendTimes(token: string): number[];
  /** Forgets scripts and calls, and drops every hanging request. */
  reset(): void;
  stop(): Promise<void>;
}

interface BotState extends BotScript {
  webhookUrl: string;
  lastMessageId: number;
}

const PATH = /^\/bot([^/]+)\/([A-Za-z]+)$/;

export interface FakeTelegramOptions {
  /** Added before every answer, like a slow network to Telegram (the load test uses 300 ms). */
  latencyMs?: number;
}

/** In-process fake Bot API on a random port — one per suite, `reset()` per test. */
export async function startFakeTelegram(options: FakeTelegramOptions = {}): Promise<FakeTelegram> {
  const latency = options.latencyMs ?? 0;
  const bots = new Map<string, BotState>();
  let recorded: RecordedCall[] = [];
  let sendTimes: { token: string; at: number }[] = [];
  const hanging = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function hang(res: ServerResponse): void {
    hanging.add(res);
    res.on('close', () => hanging.delete(res));
  }

  function dropHanging(): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const res of hanging) res.socket?.destroy();
    hanging.clear();
  }

  function sendOk(
    res: ServerResponse,
    bot: BotState,
    params: Record<string, unknown>,
    id?: number,
  ) {
    bot.lastMessageId = id ?? bot.lastMessageId + 1;
    return send(res, 200, {
      ok: true,
      result: {
        message_id: bot.lastMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: params.chat_id, type: 'private' },
        text: params.text,
      },
    });
  }

  function answerSend(res: ServerResponse, bot: BotState, params: Record<string, unknown>) {
    const next = bot.sendMessage?.shift();
    if (!next) return sendOk(res, bot, params);
    switch (next.kind) {
      case 'ok':
        return sendOk(res, bot, params, next.messageId);
      case 'error':
        return send(res, next.status, next.body);
      case 'reset':
        return res.socket?.destroy();
      case 'hang': {
        hang(res);
        const timer = setTimeout(() => {
          timers.delete(timer);
          hanging.delete(res);
          sendOk(res, bot, params);
        }, next.ms);
        timers.add(timer);
        return;
      }
    }
  }

  function answerGetFile(res: ServerResponse, bot: BotState, params: Record<string, unknown>) {
    const fileId = String(params.file_id ?? '');
    const file = bot.files?.[fileId];
    if (file === 'too_big') {
      return send(res, 400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: file is too big',
      });
    }
    if (!file || file === 'not_found') {
      return send(res, 400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: invalid file_id',
      });
    }
    return send(res, 200, {
      ok: true,
      result: {
        file_id: fileId,
        file_unique_id: `unique-${fileId}`,
        file_path: file.path,
        file_size: file.size,
      },
    });
  }

  /** Deterministic bytes: the byte at offset i is the same on every request. */
  function download(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const match = /^\/file\/bot([^/]+)\/(.+)$/.exec(url.pathname);
    const bot = match && bots.get(match[1]!);
    if (!match || !bot) return send(res, 401, RECORDED.unauthorized);
    const path = decodeURIComponent(match[2]!);
    const file = Object.values(bot.files ?? {}).find(
      (f): f is { path: string; size: number } => typeof f === 'object' && f.path === path,
    );
    if (!file) return send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    const { size } = file;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(size - Number(range[2]), 0);
      }
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return void res.end();
      }
    }
    const body = Buffer.alloc(end - start + 1);
    for (let i = 0; i < body.length; i++) body[i] = ((start + i) * 31 + 7) & 0xff;
    const partial = range !== null;
    res.writeHead(partial ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
      'accept-ranges': 'bytes',
      ...(partial && { 'content-range': `bytes ${start}-${end}/${size}` }),
    });
    res.end(body);
  }

  function answer(
    res: ServerResponse,
    token: string,
    method: string,
    params: Record<string, unknown>,
  ) {
    const bot = bots.get(token);
    if (!bot) return send(res, 401, RECORDED.unauthorized);

    if (method === 'getMe') {
      switch (bot.getMe ?? 'ok') {
        case 'unauthorized':
          return send(res, 401, RECORDED.unauthorized);
        case 'server_error':
          return send(res, 500, RECORDED.serverError);
        case 'rate_limited':
          return send(res, 429, RECORDED.rateLimited);
        case 'hang':
          return hang(res);
        case 'ok': {
          const id = Number(token.split(':')[0]);
          return send(res, 200, {
            ok: true,
            result: {
              ...RECORDED.getMe.result,
              id,
              first_name: bot.me?.first_name ?? `Test Bot ${id}`,
              username: bot.me?.username ?? `test_bot_${id}`,
            },
          });
        }
      }
    }

    const behaviour = bot[method as 'getWebhookInfo' | 'setWebhook' | 'deleteWebhook'];
    if (behaviour === 'hang') return hang(res);
    if (behaviour === 'fail') {
      return send(
        res,
        400,
        method === 'setWebhook' ? RECORDED.setWebhookFailed : RECORDED.serverError,
      );
    }
    switch (method) {
      case 'sendMessage':
        return answerSend(res, bot, params);
      case 'getFile':
        return answerGetFile(res, bot, params);
      case 'getWebhookInfo':
        return send(res, 200, {
          ok: true,
          result: bot.webhookUrl
            ? {
                ...RECORDED.getWebhookInfoSet.result,
                url: bot.webhookUrl,
                allowed_updates: bot.allowedUpdates ?? CURRENT_ALLOWED_UPDATES,
              }
            : RECORDED.getWebhookInfoEmpty.result,
        });
      case 'setWebhook':
        bot.webhookUrl = String(params.url ?? '');
        if (Array.isArray(params.allowed_updates)) {
          bot.allowedUpdates = params.allowed_updates.map(String);
        }
        return send(res, 200, RECORDED.setWebhook);
      case 'deleteWebhook':
        bot.webhookUrl = '';
        return send(res, 200, RECORDED.deleteWebhook);
      default:
        return send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    }
  }

  async function readParams(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  /** The control API of `connectFakeTelegram` — not recorded as a Bot API call. */
  function control(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (!url.pathname.startsWith(CONTROL)) return false;
    readParams(req).then(
      (body) => {
        switch (`${req.method} ${url.pathname.slice(CONTROL.length)}`) {
          case 'POST /script':
            fake.bot(String(body.token)).script((body.script ?? {}) as BotScript);
            return send(res, 200, { ok: true });
          case 'GET /calls':
            return send(res, 200, fake.calls(url.searchParams.get('token') ?? undefined));
          case 'POST /reset':
            fake.reset();
            return send(res, 200, { ok: true });
          default:
            return send(res, 404, { ok: false });
        }
      },
      () => send(res, 400, { ok: false }),
    );
    return true;
  }

  const server = createServer((req, res) => {
    if (control(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname.startsWith('/file/bot')) return download(req, res, url);
    const match = PATH.exec(req.url ?? '');
    if (!match) return send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    const [, token = '', method = ''] = match;
    readParams(req).then(
      (params) => {
        recorded.push({ token, method, params });
        if (method === 'sendMessage') sendTimes.push({ token, at: Date.now() });
        if (latency > 0) setTimeout(() => answer(res, token, method, params), latency);
        else answer(res, token, method, params);
      },
      () => send(res, 400, { ok: false, error_code: 400, description: 'Bad Request' }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const fake: FakeTelegram = {
    apiRoot: `http://127.0.0.1:${port}`,
    bot(token) {
      return {
        script(script) {
          bots.set(token, {
            ...script,
            sendMessage: [...(script.sendMessage ?? [])],
            webhookUrl: script.webhookUrl ?? '',
            lastMessageId: 0,
          });
        },
      };
    },
    calls(token) {
      return recorded.filter((c) => token === undefined || c.token === token);
    },
    sendTimes(token) {
      return sendTimes.filter((s) => s.token === token).map((s) => s.at);
    },
    reset() {
      bots.clear();
      recorded = [];
      sendTimes = [];
      dropHanging();
    },
    async stop() {
      dropHanging();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return fake;
}

const CONTROL = '/__fake';

/** The fake driven from another process (the browser e2e worker) over its control API. */
export interface FakeTelegramClient {
  script(token: string, script: BotScript): Promise<void>;
  calls(token?: string): Promise<RecordedCall[]>;
  reset(): Promise<void>;
}

export function connectFakeTelegram(apiRoot: string): FakeTelegramClient {
  const call = async (method: 'GET' | 'POST', path: string, body?: object) => {
    const res = await fetch(`${apiRoot}${CONTROL}${path}`, {
      method,
      ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`fake Bot API control ${path} answered ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  return {
    async script(token, script) {
      await call('POST', '/script', { token, script });
    },
    async calls(token) {
      const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
      return (await call('GET', `/calls${query}`)) as RecordedCall[];
    },
    async reset() {
      await call('POST', '/reset', {});
    },
  };
}
