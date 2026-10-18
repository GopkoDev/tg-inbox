import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode, type ErrorEnvelope } from '@tg/shared';

/** Base class for every expected failure; the error handler maps it to the envelope + status. */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly statusCode: number;

  /** Extra response headers (e.g. `Retry-After`). */
  readonly headers?: Record<string, string>;

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

export class BotTokenInvalidError extends AppError {
  readonly code = ErrorCode.BOT_TOKEN_INVALID;
  readonly statusCode = 400;

  constructor() {
    super('The token is not valid — copy it again from BotFather');
  }
}

export class BotBelongsToAnotherWorkspaceError extends AppError {
  readonly code = ErrorCode.BOT_BELONGS_TO_ANOTHER_WORKSPACE;
  readonly statusCode = 409;

  /** Never names the other workspace (AC-04). */
  constructor() {
    super('This bot already belongs to another workspace');
  }
}

const KEEPS_ONE_BOT_MESSAGES = {
  connected: 'A workspace keeps one business bot — disconnect the current bot first',
  history: 'A workspace keeps one business bot — your customers know only the bot they wrote to',
} as const;

/** `reason`: `connected` — disconnect first; `history` — the workspace stays with its bot (AC-05). */
export class WorkspaceKeepsOneBotError extends AppError {
  readonly code = ErrorCode.WORKSPACE_KEEPS_ONE_BOT;
  readonly statusCode = 409;

  constructor(reason: keyof typeof KEEPS_ONE_BOT_MESSAGES) {
    super(KEEPS_ONE_BOT_MESSAGES[reason], { reason });
  }
}

/** `bot` names the bot for the takeover warning (AC-06, SCR-04). */
export class TakeoverConfirmationRequiredError extends AppError {
  readonly code = ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED;
  readonly statusCode = 409;

  constructor(bot: { name: string; username: string }) {
    super('Connecting will stop this bot delivering messages to another service', { bot });
  }
}

/** The settings refusals hand back the current Bot settings so the panel can refresh. */
export class NothingToReconnectError extends AppError {
  readonly code = ErrorCode.NOTHING_TO_RECONNECT;
  readonly statusCode = 409;

  constructor(settings: unknown) {
    super('The bot is not taken over by another service — there is nothing to reconnect', {
      settings,
    });
  }
}

export class BotNeedsNewTokenError extends AppError {
  readonly code = ErrorCode.BOT_NEEDS_NEW_TOKEN;
  readonly statusCode = 409;

  constructor(settings: unknown) {
    super("The bot's token no longer works — paste a new token from BotFather", { settings });
  }
}

export class NoBotConnectedError extends AppError {
  readonly code = ErrorCode.NO_BOT_CONNECTED;
  readonly statusCode = 409;

  constructor(settings: unknown) {
    super('No bot is connected', { settings });
  }
}

/** The bot cannot carry replies (not connected / needs a new token) — AC-13. */
export class BotCannotReplyError extends AppError {
  readonly code = ErrorCode.BOT_CANNOT_REPLY;
  readonly statusCode = 409;

  constructor(bot: unknown) {
    super('Replies cannot be sent until the bot works again', { bot });
  }
}

/** A teammate replied after the reply the operator last saw — AC-16. */
export class TeammateRepliedError extends AppError {
  readonly code = ErrorCode.TEAMMATE_REPLIED;
  readonly statusCode = 409;

  constructor(reply: unknown) {
    super('A teammate has already replied to this customer', { reply });
  }
}

/** Resending a `not_confirmed` reply needs the member to accept the duplicate risk — AC-11. */
export class DuplicateRiskConfirmationRequiredError extends AppError {
  readonly code = ErrorCode.DUPLICATE_RISK_CONFIRMATION_REQUIRED;
  readonly statusCode = 409;

  constructor() {
    super('The customer may receive this reply twice — confirm to send it again');
  }
}

export class ReplyNotResendableError extends AppError {
  readonly code = ErrorCode.REPLY_NOT_RESENDABLE;
  readonly statusCode = 409;

  constructor(reply: unknown) {
    super('This reply cannot be sent again', { reply });
  }
}

export class MediaUnavailableError extends AppError {
  readonly code = ErrorCode.MEDIA_UNAVAILABLE;
  readonly statusCode = 409;

  constructor(reason: 'bot_not_connected' | 'bot_not_working' | 'file_too_large' | 'file_gone') {
    super('This content is unavailable', { reason });
  }
}

/** 30 member-initiated sends per workspace per 60 s — AC-12b. */
export class ReplyLimitReachedError extends AppError {
  readonly code = ErrorCode.REPLY_LIMIT_REACHED;
  readonly statusCode = 429;
  override readonly headers: Record<string, string>;

  constructor(retryAt: Date, retryAfterSeconds: number) {
    super(
      `Replies are limited to 30 per minute — you can send again in ${retryAfterSeconds} seconds`,
      { limit: 30, window_seconds: 60, retry_at: retryAt.toISOString() },
    );
    this.headers = { 'Retry-After': String(retryAfterSeconds) };
  }
}

/**
 * Telegram did not answer in time, answered 5xx / 429, or setWebhook failed — the first 5xx
 * AppError. Its message never carries Telegram's error text or URL.
 */
export class TelegramUnavailableError extends AppError {
  readonly code = ErrorCode.TELEGRAM_UNAVAILABLE;
  readonly statusCode = 503;

  constructor() {
    super('Telegram is not responding — try again');
  }
}

function envelope(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Router-level errors whose Fastify message embeds the request path. */
const URL_ERROR_CODES = new Set(['FST_ERR_BAD_URL', 'FST_ERR_MAX_PARAM_LENGTH']);

/** The one mapping from any thrown error to the envelope + status. */
function sendError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      // An expected upstream failure, not a bug: the code only — never the cause, text or URL.
      request.log.warn({ code: error.code }, 'upstream unavailable');
    }
    if (error.headers) void reply.headers(error.headers);
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
    if (URL_ERROR_CODES.has(error.code)) {
      // Fastify's message quotes the raw path, which may hold an invitation / reset token.
      request.log.info({ code: error.code }, 'client error');
      return reply.status(400).send(envelope(ErrorCode.VALIDATION_ERROR, 'Invalid request URL'));
    }
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
