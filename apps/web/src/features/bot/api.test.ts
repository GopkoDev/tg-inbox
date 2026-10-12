import { ErrorCode } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { botRefusal, disconnectBot, getBotSettings, pasteBotToken, reconnectBot } from './api';

const fetchMock = vi.fn();
const settings = { state: 'not_connected' };
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: init.body, headers: new Headers(init.headers) };
};

describe('bot api', () => {
  it('getBotSettings GETs the settings; background marks the request', async () => {
    fetchMock.mockResolvedValue(ok(settings));
    expect(await getBotSettings('w 1')).toEqual(settings);
    expect(call()).toMatchObject({ url: '/api/workspaces/w%201/bot', method: 'GET' });
    fetchMock.mockResolvedValue(ok(settings));
    await getBotSettings('w1', { background: true });
    expect(call(1).headers.get('x-background-request')).toBe('1');
  });

  it('pasteBotToken POSTs token + confirm_takeover', async () => {
    fetchMock.mockResolvedValue(ok(settings));
    await pasteBotToken('w1', { token: '1:abc', confirm_takeover: false });
    expect(call()).toMatchObject({ url: '/api/workspaces/w1/bot/token', method: 'POST' });
    expect(JSON.parse(call().body as string)).toEqual({ token: '1:abc', confirm_takeover: false });
  });

  it('reconnectBot and disconnectBot POST', async () => {
    fetchMock.mockResolvedValue(ok(settings));
    await reconnectBot('w1', { confirm_takeover: true });
    expect(call()).toMatchObject({ url: '/api/workspaces/w1/bot/reconnect', method: 'POST' });
    expect(JSON.parse(call().body as string)).toEqual({ confirm_takeover: true });
    fetchMock.mockResolvedValue(ok(settings));
    await disconnectBot('w1');
    expect(call(1)).toMatchObject({ url: '/api/workspaces/w1/bot/disconnect', method: 'POST' });
  });

  it('rejects a response carrying anything beyond BotSettings (no token can slip through)', async () => {
    fetchMock.mockResolvedValue(ok({ state: 'not_connected', token: 'x' }));
    await expect(getBotSettings('w1')).rejects.toThrow();
  });
});

describe('botRefusal', () => {
  const err = (code: ErrorCode, details?: unknown) => new ApiError(409, code, 'msg', details);

  it('types the details of each refusal', () => {
    expect(botRefusal(err(ErrorCode.WORKSPACE_KEEPS_ONE_BOT, { reason: 'history' }))).toEqual({
      code: ErrorCode.WORKSPACE_KEEPS_ONE_BOT,
      message: 'msg',
      reason: 'history',
    });
    const bot = { name: 'B', username: 'b_bot' };
    expect(botRefusal(err(ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED, { bot }))).toEqual({
      code: ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED,
      message: 'msg',
      bot,
    });
    expect(botRefusal(err(ErrorCode.NO_BOT_CONNECTED, { settings }))).toEqual({
      code: ErrorCode.NO_BOT_CONNECTED,
      message: 'msg',
      settings,
    });
    expect(botRefusal(err(ErrorCode.BOT_TOKEN_INVALID))).toEqual({
      code: ErrorCode.BOT_TOKEN_INVALID,
      message: 'msg',
    });
  });

  it('is null for anything that is not an ApiError', () => {
    expect(botRefusal(new Error('x'))).toBeNull();
  });

  it('drops details that do not match the schema', () => {
    expect(botRefusal(err(ErrorCode.WORKSPACE_KEEPS_ONE_BOT, { reason: 'nope' }))).toEqual({
      code: ErrorCode.WORKSPACE_KEEPS_ONE_BOT,
      message: 'msg',
    });
  });
});
