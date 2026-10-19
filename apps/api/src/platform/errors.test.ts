import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AccessRemovedError,
  AlreadyAMemberError,
  AssigneeNotActiveError,
  ChangeLimitReachedError,
  CloseNeedsConfirmationError,
  ContactTagLimitReachedError,
  TagChangeLimitReachedError,
  TagCountChangedError,
  TagLimitReachedError,
  TagMergeTargetChangedError,
  TagNameInvalidError,
  TagNameTakenError,
  TagNotFoundError,
  ConversationStateChangedError,
  type AppError,
  BotBelongsToAnotherWorkspaceError,
  BotNeedsNewTokenError,
  BotCannotReplyError,
  BotTokenInvalidError,
  DuplicateRiskConfirmationRequiredError,
  MediaUnavailableError,
  ReplyLimitReachedError,
  ConnectLinkLimitReachedError,
  TelegramAlreadyLinkedError,
  PingsNeedWorkingBotError,
  ReplyNotResendableError,
  TeammateRepliedError,
  NoBotConnectedError,
  NothingToReconnectError,
  TakeoverConfirmationRequiredError,
  TelegramUnavailableError,
  WorkspaceKeepsOneBotError,
  InvalidCredentialsError,
  InvitationForAnotherEmailError,
  InvitationInvalidError,
  LastActiveOwnerError,
  OwnerAlreadyJoinedError,
  OwnerOnlyError,
  ResetLinkInvalidError,
  TooManyRequestsError,
  UnauthenticatedError,
  registerErrorHandler,
} from './errors.js';

const cases: [string, () => AppError, number, string][] = [
  ['unauthenticated', () => new UnauthenticatedError('x'), 401, 'UNAUTHENTICATED'],
  ['invalid credentials', () => new InvalidCredentialsError('x'), 401, 'INVALID_CREDENTIALS'],
  ['access removed', () => new AccessRemovedError('x'), 403, 'ACCESS_REMOVED'],
  ['owner only', () => new OwnerOnlyError('x'), 403, 'OWNER_ONLY'],
  [
    'other email',
    () => new InvitationForAnotherEmailError('x'),
    403,
    'INVITATION_FOR_ANOTHER_EMAIL',
  ],
  [
    'invitation invalid',
    () => new InvitationInvalidError('x', 'business_owner'),
    404,
    'INVITATION_INVALID',
  ],
  ['reset invalid', () => new ResetLinkInvalidError('x'), 404, 'RESET_LINK_INVALID'],
  ['already member', () => new AlreadyAMemberError('x'), 409, 'ALREADY_A_MEMBER'],
  ['last owner', () => new LastActiveOwnerError('x'), 409, 'LAST_ACTIVE_OWNER'],
  ['owner joined', () => new OwnerAlreadyJoinedError('x'), 409, 'OWNER_ALREADY_JOINED'],
  ['too many', () => new TooManyRequestsError('x'), 429, 'TOO_MANY_ATTEMPTS'],
  ['bot token invalid', () => new BotTokenInvalidError(), 400, 'BOT_TOKEN_INVALID'],
  [
    'bot of another workspace',
    () => new BotBelongsToAnotherWorkspaceError(),
    409,
    'BOT_BELONGS_TO_ANOTHER_WORKSPACE',
  ],
  [
    'one bot per workspace',
    () => new WorkspaceKeepsOneBotError('connected'),
    409,
    'WORKSPACE_KEEPS_ONE_BOT',
  ],
  [
    'takeover confirmation',
    () => new TakeoverConfirmationRequiredError({ name: 'Test Bot 1', username: 'test_bot_1' }),
    409,
    'TAKEOVER_CONFIRMATION_REQUIRED',
  ],
  ['nothing to reconnect', () => new NothingToReconnectError({}), 409, 'NOTHING_TO_RECONNECT'],
  ['needs new token', () => new BotNeedsNewTokenError({}), 409, 'BOT_NEEDS_NEW_TOKEN'],
  ['no bot connected', () => new NoBotConnectedError({}), 409, 'NO_BOT_CONNECTED'],
  ['telegram unavailable', () => new TelegramUnavailableError(), 503, 'TELEGRAM_UNAVAILABLE'],
  [
    'bot cannot reply',
    () => new BotCannotReplyError({ state: 'needs_token' }),
    409,
    'BOT_CANNOT_REPLY',
  ],
  ['teammate replied', () => new TeammateRepliedError({ id: 'r' }), 409, 'TEAMMATE_REPLIED'],
  [
    'duplicate risk',
    () => new DuplicateRiskConfirmationRequiredError(),
    409,
    'DUPLICATE_RISK_CONFIRMATION_REQUIRED',
  ],
  ['not resendable', () => new ReplyNotResendableError({ id: 'r' }), 409, 'REPLY_NOT_RESENDABLE'],
  ['media unavailable', () => new MediaUnavailableError('file_gone'), 409, 'MEDIA_UNAVAILABLE'],
  [
    'reply limit',
    () => new ReplyLimitReachedError(new Date('2026-10-18T10:21:12.000Z'), 12),
    429,
    'REPLY_LIMIT_REACHED',
  ],
  [
    'state changed',
    () => new ConversationStateChangedError({}, null),
    409,
    'CONVERSATION_STATE_CHANGED',
  ],
  [
    'close needs confirmation',
    () => new CloseNeedsConfirmationError({ reasons: ['customer_waiting'] }),
    409,
    'CLOSE_NEEDS_CONFIRMATION',
  ],
  ['assignee not active', () => new AssigneeNotActiveError(), 400, 'ASSIGNEE_NOT_ACTIVE'],
  [
    'change limit',
    () => new ChangeLimitReachedError(new Date('2026-10-18T10:21:14.200Z'), 15),
    429,
    'CHANGE_LIMIT_REACHED',
  ],
  [
    'connect link limit',
    () => new ConnectLinkLimitReachedError(new Date('2026-10-19T09:26:30.000Z'), 270),
    429,
    'CONNECT_LINK_LIMIT_REACHED',
  ],
  [
    'telegram already linked',
    () => new TelegramAlreadyLinkedError({ workspace_id: 'w' }),
    409,
    'TELEGRAM_ALREADY_LINKED',
  ],
  [
    'pings need working bot',
    () => new PingsNeedWorkingBotError({ workspace_id: 'w' }),
    409,
    'PINGS_NEED_WORKING_BOT',
  ],
  ['tag name invalid', () => new TagNameInvalidError(), 400, 'TAG_NAME_INVALID'],
  ['tag limit', () => new TagLimitReachedError(), 409, 'TAG_LIMIT_REACHED'],
  ['contact tag limit', () => new ContactTagLimitReachedError(), 409, 'CONTACT_TAG_LIMIT_REACHED'],
  ['tag not found', () => new TagNotFoundError('t'), 404, 'TAG_NOT_FOUND'],
  ['tag name taken', () => new TagNameTakenError({ id: 't' }), 409, 'TAG_NAME_TAKEN'],
  [
    'tag merge target changed',
    () => new TagMergeTargetChangedError(null),
    409,
    'TAG_MERGE_TARGET_CHANGED',
  ],
  ['tag count changed', () => new TagCountChangedError({ id: 't' }), 409, 'TAG_COUNT_CHANGED'],
  [
    'tag change limit',
    () => new TagChangeLimitReachedError(new Date('2026-10-19T10:21:14.000Z'), 14),
    429,
    'TAG_CHANGE_LIMIT_REACHED',
  ],
];

async function envelopeOf(make: () => AppError) {
  const app = Fastify();
  registerErrorHandler(app);
  app.get('/e', () => {
    throw make();
  });
  const res = await app.inject('/e');
  return res.json() as { error: { code: string; message: string; details?: unknown } };
}

describe('notifications errors', () => {
  it('the connect link limit carries Retry-After and the 5 / 600 / retry_at details (AC-13)', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new ConnectLinkLimitReachedError(new Date('2026-10-19T09:26:30.000Z'), 270);
    });
    const res = await app.inject('/e');
    expect(res.headers['retry-after']).toBe('270');
    expect(res.json().error.details).toEqual({
      limit: 5,
      window_seconds: 600,
      retry_at: '2026-10-19T09:26:30.000Z',
    });
    expect(res.json().error.message).toContain('5 per 10 minutes');
  });

  it('the two 409 refusals carry details.settings (AC-06)', async () => {
    const settings = { workspace_id: 'w' };
    for (const make of [
      () => new TelegramAlreadyLinkedError(settings),
      () => new PingsNeedWorkingBotError(settings),
    ]) {
      expect((await envelopeOf(make)).error.details).toEqual({ settings });
    }
  });
});

describe('error handler', () => {
  it.each(cases)('maps %s', async (_name, make, status, code) => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw make();
    });
    const res = await app.inject('/e');
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
  });

  it('maps a body over bodyLimit to 413 PAYLOAD_TOO_LARGE', async () => {
    const app = Fastify({ bodyLimit: 10 });
    registerErrorHandler(app);
    app.post('/p', () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/p',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ big: 'x'.repeat(100) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers any other framework 4xx with 400 VALIDATION_ERROR', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/t', () => {
      throw Object.assign(new Error('teapot'), { statusCode: 418 });
    });
    const res = await app.inject('/t');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['a plain Error', () => new Error('boom')],
    ['an error with statusCode 503', () => Object.assign(new Error('down'), { statusCode: 503 })],
  ])('answers %s with 500 INTERNAL_ERROR, logged at error level', async (_name, make) => {
    const levels: number[] = [];
    const stream = {
      write: (line: string) => {
        const entry = JSON.parse(line) as { level: number; msg?: string };
        if (entry.msg === 'unhandled error' || entry.msg === 'client error') {
          levels.push(entry.level);
        }
      },
    };
    const app = Fastify({ logger: { level: 'info', stream } });
    registerErrorHandler(app);
    app.get('/x', () => {
      throw make();
    });
    const res = await app.inject('/x');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(levels).toEqual([50]);
  });

  it.each([
    [
      'BOT_TOKEN_INVALID',
      () => new BotTokenInvalidError(),
      { message: 'The token is not valid — copy it again from BotFather' },
    ],
    [
      'BOT_BELONGS_TO_ANOTHER_WORKSPACE',
      () => new BotBelongsToAnotherWorkspaceError(),
      { message: 'This bot already belongs to another workspace' },
    ],
    [
      'WORKSPACE_KEEPS_ONE_BOT connected',
      () => new WorkspaceKeepsOneBotError('connected'),
      {
        message: 'A workspace keeps one business bot — disconnect the current bot first',
        details: { reason: 'connected' },
      },
    ],
    [
      'WORKSPACE_KEEPS_ONE_BOT history',
      () => new WorkspaceKeepsOneBotError('history'),
      {
        message:
          'A workspace keeps one business bot — your customers know only the bot they wrote to',
        details: { reason: 'history' },
      },
    ],
    [
      'TAKEOVER_CONFIRMATION_REQUIRED',
      () => new TakeoverConfirmationRequiredError({ name: 'Test Bot 1', username: 'test_bot_1' }),
      {
        message: 'Connecting will stop this bot delivering messages to another service',
        details: { bot: { name: 'Test Bot 1', username: 'test_bot_1' } },
      },
    ],
    [
      'NOTHING_TO_RECONNECT',
      () => new NothingToReconnectError({ state: 'connected' }),
      {
        message: 'The bot is not taken over by another service — there is nothing to reconnect',
        details: { settings: { state: 'connected' } },
      },
    ],
    [
      'BOT_NEEDS_NEW_TOKEN',
      () => new BotNeedsNewTokenError({ state: 'needs_token' }),
      {
        message: "The bot's token no longer works — paste a new token from BotFather",
        details: { settings: { state: 'needs_token' } },
      },
    ],
    [
      'NO_BOT_CONNECTED',
      () => new NoBotConnectedError({ state: 'not_connected' }),
      { message: 'No bot is connected', details: { settings: { state: 'not_connected' } } },
    ],
    [
      'TELEGRAM_UNAVAILABLE',
      () => new TelegramUnavailableError(),
      { message: 'Telegram is not responding — try again' },
    ],
  ])('sends %s with its contract message and details', async (_name, make, expected) => {
    const { error } = await envelopeOf(make);
    expect(error).toEqual({ code: error.code, ...expected });
  });

  it('answers a 5xx AppError with its own status and envelope, logged at warn with the code only', async () => {
    const entries: Record<string, unknown>[] = [];
    const stream = {
      write: (line: string) => {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      },
    };
    const app = Fastify({ logger: { level: 'info', stream } });
    registerErrorHandler(app);
    app.get('/x', () => {
      throw new TelegramUnavailableError();
    });
    const res = await app.inject('/x');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: { code: 'TELEGRAM_UNAVAILABLE', message: 'Telegram is not responding — try again' },
    });
    const logged = entries.filter((e) => e.code === 'TELEGRAM_UNAVAILABLE');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.level).toBe(40);
    expect(logged[0]).not.toHaveProperty('err');
    expect(entries.some((e) => e.msg === 'unhandled error')).toBe(false);
  });

  it('puts ask into details for InvitationInvalidError', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new InvitationInvalidError('x', 'tg_inbox_team');
    });
    const res = await app.inject('/e');
    expect(res.json().error.details).toEqual({ ask: 'tg_inbox_team' });
  });

  it('shapes route zod validation errors as plain message + field details', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    app.post(
      '/v',
      {
        schema: {
          body: z.object({
            password: z.string().min(10, 'The password must be at least 10 characters long'),
          }),
        },
      },
      () => ({ ok: true }),
    );
    const res = await app.inject({ method: 'POST', url: '/v', payload: { password: 'short' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The password must be at least 10 characters long',
        details: { field: 'password' },
      },
    });
  });
});

describe('shared-inbox error details (T2)', () => {
  it('carries the reply / bot / reason as details', async () => {
    const bot = { state: 'needs_token' };
    expect((await envelopeOf(() => new BotCannotReplyError(bot))).error.details).toEqual({ bot });
    const r = { id: 'r1', position_at: 'x' };
    expect((await envelopeOf(() => new TeammateRepliedError(r))).error.details).toEqual({
      reply: r,
    });
    expect((await envelopeOf(() => new ReplyNotResendableError(r))).error.details).toEqual({
      reply: r,
    });
    expect(
      (await envelopeOf(() => new MediaUnavailableError('file_too_large'))).error.details,
    ).toEqual({ reason: 'file_too_large' });
  });

  it('REPLY_LIMIT_REACHED has 429 details and a Retry-After header', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new ReplyLimitReachedError(new Date('2026-10-18T10:21:12.000Z'), 12);
    });
    const res = await app.inject('/e');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('12');
    expect(res.json().error.details).toEqual({
      limit: 30,
      window_seconds: 60,
      retry_at: '2026-10-18T10:21:12.000Z',
    });
  });

  it('CONVERSATION_STATE_CHANGED carries the summary and the latest change', async () => {
    const env = await envelopeOf(() => new ConversationStateChangedError({ id: 'c' }, { id: 'a' }));
    expect(env.error.details).toEqual({ conversation: { id: 'c' }, latest_change: { id: 'a' } });
  });

  it('CLOSE_NEEDS_CONFIRMATION carries the details as given', async () => {
    const details = {
      reasons: ['customer_waiting'],
      stale_change: null,
      newest_unread_message: null,
      conversation: { id: 'c' },
    };
    const env = await envelopeOf(() => new CloseNeedsConfirmationError(details));
    expect(env.error.details).toEqual(details);
  });

  it('ASSIGNEE_NOT_ACTIVE names the field', async () => {
    const env = await envelopeOf(() => new AssigneeNotActiveError());
    expect(env.error.details).toEqual({ field: 'assignee_account_id' });
  });

  it('CHANGE_LIMIT_REACHED has 60/60 details, exact retry_at and a rounded-up Retry-After', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new ChangeLimitReachedError(new Date('2026-10-18T10:21:14.200Z'), 15);
    });
    const res = await app.inject('/e');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('15');
    expect(res.json().error.details).toEqual({
      limit: 60,
      window_seconds: 60,
      retry_at: '2026-10-18T10:21:14.200Z',
    });
  });
});

describe('contacts tag errors (sad.md §8)', () => {
  const tag = { id: 't', name: 'VIP', contact_count: 3 };

  it('TAG_NAME_INVALID names the field and the 1-32 bounds', async () => {
    const env = await envelopeOf(() => new TagNameInvalidError());
    expect(env.error.details).toEqual({ field: 'name', min_length: 1, max_length: 32 });
  });

  it('the two limits carry their numbers', async () => {
    expect((await envelopeOf(() => new TagLimitReachedError())).error.details).toEqual({
      limit: 100,
    });
    expect((await envelopeOf(() => new ContactTagLimitReachedError())).error.details).toEqual({
      limit: 20,
    });
  });

  it('TAG_NOT_FOUND echoes the tag id', async () => {
    expect((await envelopeOf(() => new TagNotFoundError('abc'))).error.details).toEqual({
      tag_id: 'abc',
    });
  });

  it('TAG_NAME_TAKEN, TAG_COUNT_CHANGED and TAG_MERGE_TARGET_CHANGED carry the tag', async () => {
    expect((await envelopeOf(() => new TagNameTakenError(tag))).error.details).toEqual({ tag });
    expect((await envelopeOf(() => new TagCountChangedError(tag))).error.details).toEqual({ tag });
    expect((await envelopeOf(() => new TagMergeTargetChangedError(tag))).error.details).toEqual({
      name_holder: tag,
    });
    expect((await envelopeOf(() => new TagMergeTargetChangedError(null))).error.details).toEqual({
      name_holder: null,
    });
  });

  it('TAG_CHANGE_LIMIT_REACHED has 60/60 details, exact retry_at and Retry-After', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new TagChangeLimitReachedError(new Date('2026-10-19T10:21:14.200Z'), 15);
    });
    const res = await app.inject('/e');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('15');
    expect(res.json().error.code).toBe('TAG_CHANGE_LIMIT_REACHED');
    expect(res.json().error.details).toEqual({
      limit: 60,
      window_seconds: 60,
      retry_at: '2026-10-19T10:21:14.200Z',
    });
    expect(res.json().error.message).toContain('60 per minute');
  });
});
