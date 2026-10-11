import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode, type ErrorEnvelope } from '@tg/shared';

/** Base class for every expected failure; the error handler maps it to the envelope + status. */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly statusCode: number;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly statusCode = 400;
}

export class ForbiddenError extends AppError {
  readonly code = ErrorCode.FORBIDDEN;
  readonly statusCode = 403;
}

export class NotFoundError extends AppError {
  readonly code = ErrorCode.NOT_FOUND;
  readonly statusCode = 404;
}

export class ConflictError extends AppError {
  readonly code = ErrorCode.CONFLICT;
  readonly statusCode = 409;
}

export class UnauthenticatedError extends AppError {
  readonly code = ErrorCode.UNAUTHENTICATED;
  readonly statusCode = 401;
}

export class InvalidCredentialsError extends AppError {
  readonly code = ErrorCode.INVALID_CREDENTIALS;
  readonly statusCode = 401;
}

export class AccessRemovedError extends AppError {
  readonly code = ErrorCode.ACCESS_REMOVED;
  readonly statusCode = 403;
}

export class OwnerOnlyError extends AppError {
  readonly code = ErrorCode.OWNER_ONLY;
  readonly statusCode = 403;
}

export class InvitationForAnotherEmailError extends AppError {
  readonly code = ErrorCode.INVITATION_FOR_ANOTHER_EMAIL;
  readonly statusCode = 403;
}

/** `ask` tells the panel whom the invitee should contact for a fresh link. */
export class InvitationInvalidError extends AppError {
  readonly code = ErrorCode.INVITATION_INVALID;
  readonly statusCode = 404;

  constructor(message: string, ask: 'business_owner' | 'tg_inbox_team') {
    super(message, { ask });
  }
}

export class ResetLinkInvalidError extends AppError {
  readonly code = ErrorCode.RESET_LINK_INVALID;
  readonly statusCode = 404;
}

export class AlreadyAMemberError extends AppError {
  readonly code = ErrorCode.ALREADY_A_MEMBER;
  readonly statusCode = 409;
}

export class LastActiveOwnerError extends AppError {
  readonly code = ErrorCode.LAST_ACTIVE_OWNER;
  readonly statusCode = 409;
}

export class OwnerAlreadyJoinedError extends AppError {
  readonly code = ErrorCode.OWNER_ALREADY_JOINED;
  readonly statusCode = 409;
}

export class TooManyRequestsError extends AppError {
  readonly code = ErrorCode.TOO_MANY_ATTEMPTS;
  readonly statusCode = 429;
}

function envelope(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** The one mapping from any thrown error to the envelope + status. */
function sendError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(envelope(error.code, error.message, error.details));
  }
  if (error.validation) {
    const first = error.validation[0];
    const field = first?.instancePath.split('/').filter(Boolean).at(-1);
    return reply
      .status(400)
      .send(
        envelope(
          ErrorCode.VALIDATION_ERROR,
          first?.message ?? 'Invalid request',
          field ? { field } : undefined,
        ),
      );
  }
  const status = error.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    request.log.info({ err: error }, 'client error');
    if (status === 415) {
      return reply
        .status(415)
        .send(
          envelope(
            ErrorCode.UNSUPPORTED_MEDIA_TYPE,
            'Only application/json request bodies are accepted',
          ),
        );
    }
    if (status === 413) {
      return reply
        .status(413)
        .send(envelope(ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large'));
    }
    return reply
      .status(400)
      .send(envelope(ErrorCode.VALIDATION_ERROR, error.message || 'Invalid request'));
  }
  request.log.error({ err: error }, 'unhandled error');
  return reply.status(500).send(envelope(ErrorCode.INTERNAL_ERROR, 'Internal server error'));
}

/**
 * Fastify's `frameworkErrors` option: router-level errors (malformed URL, a path param over
 * `maxParamLength`) skip the error handler, so this sends them through the same mapping.
 */
export const frameworkErrors = sendError;

export interface ErrorHandlerOptions {
  /** Tried before the JSON 404; returns true when it already answered (SPA index.html). */
  spaFallback?: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean> | boolean;
}

export function registerErrorHandler(
  app: FastifyInstance,
  options: ErrorHandlerOptions = {},
): void {
  app.setErrorHandler(sendError);

  app.setNotFoundHandler(async (request, reply) => {
    if (options.spaFallback && (await options.spaFallback(request, reply))) return reply;
    return reply
      .status(404)
      .send(envelope(ErrorCode.NOT_FOUND, `Route ${request.method} ${request.url} not found`));
  });
}
