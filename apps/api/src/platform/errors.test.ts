import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AccessRemovedError,
  AlreadyAMemberError,
  type AppError,
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
];

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
