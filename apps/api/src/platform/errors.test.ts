import Fastify from 'fastify';
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

  it('puts ask into details for InvitationInvalidError', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/e', () => {
      throw new InvitationInvalidError('x', 'tg_inbox_team');
    });
    const res = await app.inject('/e');
    expect(res.json().error.details).toEqual({ ask: 'tg_inbox_team' });
  });
});
