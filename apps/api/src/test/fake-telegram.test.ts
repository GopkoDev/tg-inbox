import { Api, GrammyError, HttpError } from 'grammy';
import type { Message, Update } from 'grammy/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { telegramApi } from '../platform/telegram.js';
import { RECORDED, startFakeTelegram, type FakeTelegram } from './fake-telegram.js';
import {
  CAPTIONED_KINDS,
  MESSAGE_KIND_FIXTURES,
  telegramEdit,
  telegramUpdate,
} from './fixtures/telegram.js';

const TOKEN = '100001:TEST-fake-token-not-real-aaaaaaaaaaaaaaaaaa';
const OTHER = '100002:TEST-fake-token-not-real-bbbbbbbbbbbbbbbbbb';

describe('fake Telegram Bot API', () => {
  let fake: FakeTelegram;
  const api = (token = TOKEN) => telegramApi(token, { apiRoot: fake.apiRoot });

  beforeAll(async () => {
    fake = await startFakeTelegram();
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.reset();
  });

  it('answers getMe with the scripted identity in the recorded User shape', async () => {
    fake.bot(TOKEN).script({ me: { first_name: 'Test Bot 1', username: 'test_bot_1' } });
    const me = await api().getMe();
    expect(me).toEqual({
      ...RECORDED.getMe.result,
      id: 100001,
      first_name: 'Test Bot 1',
      username: 'test_bot_1',
    });
    expect(Object.keys(me).sort()).toEqual(Object.keys(RECORDED.getMe.result).sort());
  });

  it('derives a default identity from the token id', async () => {
    fake.bot(TOKEN).script({});
    expect(await api().getMe()).toMatchObject({
      id: 100001,
      is_bot: true,
      username: 'test_bot_100001',
    });
  });

  it('rejects a token that was never scripted with 401, like Telegram', async () => {
    const err = await api(OTHER)
      .getMe()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GrammyError);
    expect((err as GrammyError).error_code).toBe(401);
    expect((err as GrammyError).description).toBe(RECORDED.unauthorized.description);
  });

  it.each([
    ['unauthorized', 401],
    ['server_error', 500],
    ['rate_limited', 429],
  ] as const)('answers getMe %s with error_code %i', async (behaviour, code) => {
    fake.bot(TOKEN).script({ getMe: behaviour });
    const err = (await api()
      .getMe()
      .catch((e: unknown) => e)) as GrammyError;
    expect(err).toBeInstanceOf(GrammyError);
    expect(err.error_code).toBe(code);
    if (behaviour === 'rate_limited') {
      expect(err.parameters.retry_after).toBe(RECORDED.rateLimited.parameters.retry_after);
    }
  });

  it('holds a hanging request until reset(), so client timeouts are testable', async () => {
    fake.bot(TOKEN).script({ getMe: 'hang' });
    const pending = api().getMe();
    const settled = await Promise.race([
      pending.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise((r) => setTimeout(() => r('pending'), 200)),
    ]);
    expect(settled).toBe('pending');
    fake.reset();
    await expect(pending).rejects.toBeInstanceOf(HttpError);
  });

  it('lets a client timeout fire against a hanging request', async () => {
    fake.bot(TOKEN).script({ getMe: 'hang' });
    const timed = new Api(TOKEN, { apiRoot: fake.apiRoot, timeoutSeconds: 1 });
    await expect(timed.getMe()).rejects.toBeInstanceOf(HttpError);
  });

  it('reports no webhook, another service, or the URL setWebhook stored', async () => {
    fake.bot(TOKEN).script({});
    expect(await api().getWebhookInfo()).toEqual(RECORDED.getWebhookInfoEmpty.result);

    fake.bot(OTHER).script({ webhookUrl: 'https://other-service.example.test/hook' });
    expect((await api(OTHER).getWebhookInfo()).url).toBe('https://other-service.example.test/hook');

    const url = 'https://tg-inbox.example.test/api/telegram/webhook/abc';
    expect(
      await api().setWebhook(url, {
        secret_token: 'secret_A',
        allowed_updates: ['message', 'edited_message'],
        max_connections: 5,
        drop_pending_updates: true,
      }),
    ).toBe(true);
    const info = await api().getWebhookInfo();
    expect(info.url).toBe(url);
    expect(Object.keys(info).sort()).toEqual(
      expect.arrayContaining(Object.keys(RECORDED.getWebhookInfoEmpty.result).sort()),
    );
  });

  it('clears the stored URL on deleteWebhook', async () => {
    fake.bot(TOKEN).script({ webhookUrl: 'https://tg-inbox.example.test/hook' });
    expect(await api().deleteWebhook({ drop_pending_updates: false })).toBe(true);
    expect((await api().getWebhookInfo()).url).toBe('');
  });

  it.each(['setWebhook', 'deleteWebhook', 'getWebhookInfo'] as const)(
    'fails %s when scripted to',
    async (method) => {
      fake.bot(TOKEN).script({ [method]: 'fail' });
      const call =
        method === 'setWebhook'
          ? api().setWebhook('https://x.example.test/h')
          : method === 'deleteWebhook'
            ? api().deleteWebhook()
            : api().getWebhookInfo();
      await expect(call).rejects.toBeInstanceOf(GrammyError);
    },
  );

  it('records every call with its parameters, per token', async () => {
    fake.bot(TOKEN).script({});
    fake.bot(OTHER).script({});
    await api().getMe();
    await api().setWebhook('https://tg-inbox.example.test/h', {
      secret_token: 'secret_B',
      allowed_updates: ['message', 'edited_message'],
      max_connections: 5,
      drop_pending_updates: false,
    });
    await api(OTHER).deleteWebhook({ drop_pending_updates: true });

    expect(fake.calls(TOKEN)).toEqual([
      { token: TOKEN, method: 'getMe', params: {} },
      {
        token: TOKEN,
        method: 'setWebhook',
        params: {
          url: 'https://tg-inbox.example.test/h',
          secret_token: 'secret_B',
          allowed_updates: ['message', 'edited_message'],
          max_connections: 5,
          drop_pending_updates: false,
        },
      },
    ]);
    expect(fake.calls().map((c) => c.method)).toEqual(['getMe', 'setWebhook', 'deleteWebhook']);
    expect(fake.calls(OTHER)[0]?.params).toEqual({ drop_pending_updates: true });
  });

  it('forgets scripts and calls on reset()', async () => {
    fake.bot(TOKEN).script({});
    await api().getMe();
    fake.reset();
    expect(fake.calls()).toEqual([]);
    await expect(api().getMe()).rejects.toBeInstanceOf(GrammyError);
  });
});

describe('stop() with a hanging request', () => {
  it('resolves and releases the request', async () => {
    const fake = await startFakeTelegram();
    fake.bot(TOKEN).script({ getMe: 'hang' });
    const pending = telegramApi(TOKEN, { apiRoot: fake.apiRoot })
      .getMe()
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    await fake.stop();
    expect(await pending).toBeInstanceOf(HttpError);
  });
});

/** Same keys and value types as the recorded example, recursively for plain objects. */
function expectShapeOf(actual: unknown, recorded: unknown, path = '$'): void {
  if (recorded === null || typeof recorded !== 'object' || Array.isArray(recorded)) {
    expect(typeof actual, path).toBe(typeof recorded);
    return;
  }
  expect(actual, path).toBeTypeOf('object');
  for (const [key, value] of Object.entries(recorded)) {
    expect(actual, `${path}.${key}`).toHaveProperty(key);
    expectShapeOf((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
  }
}

describe('webhook update builders', () => {
  it('builds a private text message from a human in the recorded Update shape', () => {
    const update = telegramUpdate({
      updateId: 900001,
      chatId: 700001,
      messageId: 42,
      date: 1791712800,
      text: 'Hello',
    });
    expectShapeOf(update, RECORDED.update);
    expect(update.message).toMatchObject({
      message_id: 42,
      date: 1791712800,
      chat: { id: 700001, type: 'private' },
      from: { id: 700001, is_bot: false, first_name: 'Test User' },
      text: 'Hello',
    });
  });

  it.each(Object.keys(MESSAGE_KIND_FIXTURES))('builds a %s message', (kind) => {
    const update = telegramUpdate({ updateId: 1, messageId: 1, date: 1, kind, caption: 'cap' });
    const message = update.message as Message & Record<string, unknown>;
    const { message_id, date, chat, from } = RECORDED.update.message;
    expectShapeOf(message, { message_id, date, chat, from });
    const field = kind === 'other' ? 'story' : kind;
    expect(message).toHaveProperty(field);
    if (kind === 'venue') expect(message).toHaveProperty('location');
    if (kind === 'animation') expect(message).toHaveProperty('document');
    if (CAPTIONED_KINDS.has(kind)) expect(message.caption).toBe('cap');
    else expect(message.caption).toBeUndefined();
  });

  it('covers the 15 captured kinds', () => {
    expect(Object.keys(MESSAGE_KIND_FIXTURES).sort()).toEqual(
      [
        'text',
        'photo',
        'video',
        'animation',
        'voice',
        'audio',
        'video_note',
        'document',
        'sticker',
        'location',
        'venue',
        'contact',
        'poll',
        'dice',
        'other',
      ].sort(),
    );
  });

  it.each([
    ['group', { chatType: 'group' as const }, { chat: { type: 'group' } }],
    ['supergroup', { chatType: 'supergroup' as const }, { chat: { type: 'supergroup' } }],
    ['channel', { chatType: 'channel' as const }, { chat: { type: 'channel' } }],
    ['bot sender', { fromIsBot: true }, { from: { is_bot: true } }],
    ['business', { businessConnectionId: 'bc-1' }, { business_connection_id: 'bc-1' }],
    ['album item', { kind: 'photo', mediaGroupId: 'album-1' }, { media_group_id: 'album-1' }],
  ])('builds the %s variant', (_name, options, expected) => {
    const update = telegramUpdate({ updateId: 2, messageId: 2, date: 2, text: 'x', ...options });
    const message = (update.message ?? update.channel_post) as unknown as Record<string, unknown>;
    expect(message).toMatchObject(expected);
  });

  it('builds a channel variant as a channel_post without a human sender', () => {
    const update = telegramUpdate({
      updateId: 3,
      messageId: 3,
      date: 3,
      chatType: 'channel',
      text: 'x',
    });
    expect(update.message).toBeUndefined();
    expect(update.channel_post?.chat.type).toBe('channel');
  });

  it('builds an edit of text and a live-location edit', () => {
    const edit: Update = telegramEdit({
      updateId: 5,
      messageId: 42,
      date: 10,
      editDate: 20,
      text: 'fixed',
    });
    expectShapeOf(edit.edited_message, RECORDED.update.message);
    expect(edit.edited_message).toMatchObject({
      message_id: 42,
      date: 10,
      edit_date: 20,
      text: 'fixed',
    });
    expect(edit.message).toBeUndefined();

    const live = telegramEdit({
      updateId: 6,
      messageId: 43,
      date: 10,
      editDate: 30,
      liveLocation: true,
    });
    expect(live.edited_message).toMatchObject({ location: { live_period: expect.any(Number) } });
    expect(live.edited_message?.text).toBeUndefined();
    expect(live.edited_message?.caption).toBeUndefined();
  });

  it('uses only synthetic identities (PII guard)', () => {
    const update = telegramUpdate({ updateId: 4, fromId: 7, messageId: 4, date: 4, text: 'x' });
    expect(update.message?.from).toMatchObject({
      first_name: 'Test User',
      username: 'test_user_7',
    });
  });

  it('adds the configured latency to every answer (load-test profile)', async () => {
    const slow = await startFakeTelegram({ latencyMs: 150 });
    try {
      slow.bot(TOKEN).script({});
      const started = performance.now();
      await telegramApi(TOKEN, { apiRoot: slow.apiRoot }).getMe();
      expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    } finally {
      await slow.stop();
    }
  });
});
