import type { FastifyError, FastifyInstance } from 'fastify';
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

function envelope(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(envelope(error.code, error.message, error.details));
    }
    if (error.validation) {
      return reply
        .status(400)
        .send(envelope(ErrorCode.VALIDATION_ERROR, error.message, error.validation));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(envelope(ErrorCode.INTERNAL_ERROR, 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send(envelope(ErrorCode.NOT_FOUND, `Route ${request.method} ${request.url} not found`)),
  );
}
