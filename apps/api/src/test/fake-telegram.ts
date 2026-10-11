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

export interface BotScript {
  /** Identity returned by getMe; defaults derive from the token id (`Test Bot <id>`). */
  me?: { first_name?: string; username?: string };
  getMe?: GetMeBehaviour;
  /** URL the bot currently delivers to (another service's, or ours); '' / unset = no webhook. */
  webhookUrl?: string;
  getWebhookInfo?: CallBehaviour;
  setWebhook?: CallBehaviour;
  deleteWebhook?: CallBehaviour;
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
  /** Forgets scripts and calls, and drops every hanging request. */
  reset(): void;
  stop(): Promise<void>;
}

interface BotState extends BotScript {
  webhookUrl: string;
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
  const hanging = new Set<ServerResponse>();

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function hang(res: ServerResponse): void {
    hanging.add(res);
    res.on('close', () => hanging.delete(res));
  }

  function dropHanging(): void {
    for (const res of hanging) res.socket?.destroy();
    hanging.clear();
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
      case 'getWebhookInfo':
        return send(res, 200, {
          ok: true,
          result: bot.webhookUrl
            ? { ...RECORDED.getWebhookInfoSet.result, url: bot.webhookUrl }
            : RECORDED.getWebhookInfoEmpty.result,
        });
      case 'setWebhook':
        bot.webhookUrl = String(params.url ?? '');
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

  const server = createServer((req, res) => {
    const match = PATH.exec(req.url ?? '');
    if (!match) return send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    const [, token = '', method = ''] = match;
    readParams(req).then(
      (params) => {
        recorded.push({ token, method, params });
        if (latency > 0) setTimeout(() => answer(res, token, method, params), latency);
        else answer(res, token, method, params);
      },
      () => send(res, 400, { ok: false, error_code: 400, description: 'Bad Request' }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    apiRoot: `http://127.0.0.1:${port}`,
    bot(token) {
      return {
        script(script) {
          bots.set(token, { ...script, webhookUrl: script.webhookUrl ?? '' });
        },
      };
    },
    calls(token) {
      return recorded.filter((c) => token === undefined || c.token === token);
    },
    reset() {
      bots.clear();
      recorded = [];
      dropHanging();
    },
    async stop() {
      dropHanging();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
