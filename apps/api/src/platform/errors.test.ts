import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AccessRemovedError,
  AlreadyAMemberError,
  type AppError,
  BotBelongsToAnotherWorkspaceError,
  BotNeedsNewTokenError,
  BotTokenInvalidError,
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
