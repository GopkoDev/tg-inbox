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

/** 5 connect links per member per workspace per 10 minutes — AC-13. */
export class ConnectLinkLimitReachedError extends AppError {
  readonly code = ErrorCode.CONNECT_LINK_LIMIT_REACHED;
  readonly statusCode = 429;
  override readonly headers: Record<string, string>;

  constructor(retryAt: Date, retryAfterSeconds: number) {
    super(
      `Connect links are limited to 5 per 10 minutes — you can ask for a new one in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutes`,
      { limit: 5, window_seconds: 600, retry_at: retryAt.toISOString() },
    );
    this.headers = { 'Retry-After': String(retryAfterSeconds) };
  }
}

/** The member already has a live Telegram link — AC-06. `settings` is their current notification settings. */
export class TelegramAlreadyLinkedError extends AppError {
  readonly code = ErrorCode.TELEGRAM_ALREADY_LINKED;
  readonly statusCode = 409;

  constructor(settings: unknown) {
    super('You are already connected — disconnect first to connect another Telegram account', {
      settings,
    });
  }
}

/** The workspace's bot cannot receive the Start — AC-13. */
export class PingsNeedWorkingBotError extends AppError {
  readonly code = ErrorCode.PINGS_NEED_WORKING_BOT;
  readonly statusCode = 409;

  constructor(settings: unknown) {
    super('Telegram pings need a working bot that receives messages', { settings });
  }
}

/** The assignee or status moved since the version the member saw — AC-03. */
export class ConversationStateChangedError extends AppError {
  readonly code = ErrorCode.CONVERSATION_STATE_CHANGED;
  readonly statusCode = 409;

  constructor(conversation: unknown, latestChange: unknown) {
    super('This conversation changed since you looked', {
      conversation,
      latest_change: latestChange,
    });
  }
}

/** A close that may be early needs the member's confirmation — AC-03, AC-06, AC-08. */
export class CloseNeedsConfirmationError extends AppError {
  readonly code = ErrorCode.CLOSE_NEEDS_CONFIRMATION;
  readonly statusCode = 409;

  constructor(details: {
    reasons: string[];
    stale_change?: unknown;
    newest_unread_message?: unknown;
    conversation?: unknown;
  }) {
    super('The customer may still need an answer — close anyway?', details);
  }
}

/** The picked assignee is not an active member of the workspace. */
export class AssigneeNotActiveError extends AppError {
  readonly code = ErrorCode.ASSIGNEE_NOT_ACTIVE;
  readonly statusCode = 400;

  constructor() {
    super('This person is no longer an active member of the workspace', {
      field: 'assignee_account_id',
    });
  }
}

/** 60 recorded assignment or status changes per member per workspace per 60 s — AC-12. */
export class ChangeLimitReachedError extends AppError {
  readonly code = ErrorCode.CHANGE_LIMIT_REACHED;
  readonly statusCode = 429;
  override readonly headers: Record<string, string>;

  constructor(retryAt: Date, retryAfterSeconds: number) {
    super(
      `Changes are limited to 60 per minute — you can continue in ${retryAfterSeconds} seconds`,
      { limit: 60, window_seconds: 60, retry_at: retryAt.toISOString() },
    );
    this.headers = { 'Retry-After': String(retryAfterSeconds) };
  }
}

/** A tag name that is empty or longer than 32 characters once tidied (AC-07). */
export class TagNameInvalidError extends AppError {
  readonly code = ErrorCode.TAG_NAME_INVALID;
  readonly statusCode = 400;

  constructor() {
    super('A tag name must be 1 to 32 characters', {
      field: 'name',
      min_length: 1,
      max_length: 32,
    });
  }
}

/** The workspace already has 100 tags (AC-08). */
export class TagLimitReachedError extends AppError {
  readonly code = ErrorCode.TAG_LIMIT_REACHED;
  readonly statusCode = 409;

  constructor() {
    super('A workspace can have at most 100 tags', { limit: 100 });
  }
}

/** The contact already carries 20 tags (AC-08). */
export class ContactTagLimitReachedError extends AppError {
  readonly code = ErrorCode.CONTACT_TAG_LIMIT_REACHED;
  readonly statusCode = 409;

  constructor() {
    super('A contact can carry at most 20 tags', { limit: 20 });
  }
}

/** Not a tag of this workspace (deleted, merged away, or foreign): never a hint which. */
export class TagNotFoundError extends AppError {
  readonly code = ErrorCode.TAG_NOT_FOUND;
  readonly statusCode = 404;

  constructor(tagId: string) {
    super('This tag no longer exists', { tag_id: tagId });
  }
}

/** A rename to a name another tag holds: details.tag is the merge target offered (AC-09). */
export class TagNameTakenError extends AppError {
  readonly code = ErrorCode.TAG_NAME_TAKEN;
  readonly statusCode = 409;

  constructor(tag: unknown) {
    super('Another tag already has this name', { tag });
  }
}

/** The confirmed merge target is gone or no longer holds the name (AC-09). */
export class TagMergeTargetChangedError extends AppError {
  readonly code = ErrorCode.TAG_MERGE_TARGET_CHANGED;
  readonly statusCode = 409;

  constructor(nameHolder: unknown) {
    super('The tag to merge into has changed', { name_holder: nameHolder });
  }
}

/** The tag's contact count differs from the one the owner confirmed (AC-09). */
export class TagCountChangedError extends AppError {
  readonly code = ErrorCode.TAG_COUNT_CHANGED;
  readonly statusCode = 409;

  constructor(tag: unknown) {
    super('The number of contacts with this tag has changed', { tag });
  }
}

/** 60 recorded tag changes per member per workspace per 60 s — AC-15. */
export class TagChangeLimitReachedError extends AppError {
  readonly code = ErrorCode.TAG_CHANGE_LIMIT_REACHED;
  readonly statusCode = 429;
  override readonly headers: Record<string, string>;

  constructor(retryAt: Date, retryAfterSeconds: number) {
    super(
      `Tag changes are limited to 60 per minute — you can continue in ${retryAfterSeconds} seconds`,
      { limit: 60, window_seconds: 60, retry_at: retryAt.toISOString() },
    );
    this.headers = { 'Retry-After': String(retryAfterSeconds) };
  }
}

/** A broadcast name that is empty or longer than 80 characters once tidied (AC-02). */
export class BroadcastNameInvalidError extends AppError {
  readonly code = ErrorCode.BROADCAST_NAME_INVALID;
  readonly statusCode = 400;

  constructor() {
    super('A name must be 1 to 80 characters', { field: 'name', min_length: 1, max_length: 80 });
  }
}

/**
 * A text that is empty or longer than 4096 UTF-16 code units once trimmed (AC-02); also an empty
 * draft text at launch ("Write the text before launching"). `length` is the trimmed length.
 */
export class BroadcastTextInvalidError extends AppError {
  readonly code = ErrorCode.BROADCAST_TEXT_INVALID;
  readonly statusCode = 400;

  constructor(
    length: number,
    message = 'The text must be 1 to 4096 characters as Telegram counts them',
  ) {
    super(message, { field: 'text', min_length: 1, max_length: 4096, length });
  }
}

/** A save against a version a teammate has moved on: details.draft is the current draft (AC-03). */
export class BroadcastDraftChangedError extends AppError {
  readonly code = ErrorCode.BROADCAST_DRAFT_CHANGED;
  readonly statusCode = 409;

  constructor(draft: unknown) {
    super('A teammate changed this draft — check their version and apply your change again', {
      draft,
    });
  }
}

/** A switch away from a group whose size differs from the one the member confirmed (AC-03). */
export class BroadcastGroupChangedError extends AppError {
  readonly code = ErrorCode.BROADCAST_GROUP_CHANGED;
  readonly statusCode = 409;

  constructor(groupSize: number) {
    super(`The group changed — it now holds ${groupSize} contacts`, { group_size: groupSize });
  }
}

/** A draft-only change of a launched broadcast (AC-09). */
export class BroadcastNotADraftError extends AppError {
  readonly code = ErrorCode.BROADCAST_NOT_A_DRAFT;
  readonly statusCode = 409;

  constructor(broadcastId: string, status: 'sending' | 'sent' | 'stopped') {
    super('This broadcast was launched and can no longer be changed', {
      broadcast_id: broadcastId,
      status,
    });
  }
}

/** "Only recipients it did not reach" of a broadcast still sending (AC-13). */
export class BroadcastNotEndedError extends AppError {
  readonly code = ErrorCode.BROADCAST_NOT_ENDED;
  readonly statusCode = 409;

  constructor(broadcastId: string) {
    super('Available once the broadcast has ended', {
      broadcast_id: broadcastId,
      status: 'sending',
    });
  }
}

/** The confirmed version or audience fingerprint no longer holds: details.confirmation is current (AC-06). */
export class BroadcastAudienceChangedError extends AppError {
  readonly code = ErrorCode.BROADCAST_AUDIENCE_CHANGED;
  readonly statusCode = 409;

  constructor(confirmation: unknown) {
    super('The contacts this broadcast would reach changed — check and confirm again', {
      confirmation,
    });
  }
}

const AUDIENCE_LIMIT = 10000;

/** An audience over 10 000 contacts, reachable or not (AC-05). */
export class BroadcastAudienceTooLargeError extends AppError {
  readonly code = ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE;
  readonly statusCode = 409;

  constructor(audienceSize: number) {
    const canAdd = Math.max(0, AUDIENCE_LIMIT - audienceSize);
    super(
      canAdd > 0
        ? `A broadcast's audience can hold at most 10 000 contacts — ${canAdd} more can be added`
        : "A broadcast's audience can hold at most 10 000 contacts",
      { limit: AUDIENCE_LIMIT, audience_size: audienceSize, can_add: canAdd },
    );
  }
}

/** A launch whose audience reaches nobody (AC-09). */
export class BroadcastNoReachableContactError extends AppError {
  readonly code = ErrorCode.BROADCAST_NO_REACHABLE_CONTACT;
  readonly statusCode = 409;

  constructor(breakdown: unknown) {
    super('This audience has no reachable contact', { breakdown });
  }
}

/** A launch with no bot or a bot that is not working (AC-10). */
export class BroadcastNeedsWorkingBotError extends AppError {
  readonly code = ErrorCode.BROADCAST_NEEDS_WORKING_BOT;
  readonly statusCode = 409;

  constructor(botState: 'not_connected' | 'needs_token' | 'taken_over') {
    super(
      botState === 'not_connected'
        ? 'Launching needs a working bot — connect it in Settings — Bot'
        : 'Launching needs a working bot',
      { bot_state: botState },
    );
  }
}

/** The workspace's 11th launch within 24 hours (AC-09): `next_launch_at` + `Retry-After`. */
export class BroadcastLaunchLimitReachedError extends AppError {
  readonly code = ErrorCode.BROADCAST_LAUNCH_LIMIT_REACHED;
  readonly statusCode = 429;
  override readonly headers: Record<string, string>;

  constructor(nextLaunchAt: Date, retryAfterSeconds: number) {
    super(
      `A workspace can launch at most 10 broadcasts in 24 hours — the next launch is possible in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutes`,
      { limit: 10, window_hours: 24, next_launch_at: nextLaunchAt.toISOString() },
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

/**
 * The request field a validation issue is about: the last named segment of its path (an array
 * index names the array). A failed union has no path of its own, so it names the field of the
 * branch that came closest (the fewest issues).
 */
function fieldOf(issue: {
  keyword: string;
  instancePath: string;
  params?: unknown;
}): string | undefined {
  const segments = issue.instancePath.split('/').filter(Boolean);
  if (issue.keyword === 'invalid_union') {
    const branches = (issue.params as { errors?: { path: (string | number)[] }[][] } | undefined)
      ?.errors;
    const closest = branches
      ?.filter((issues) => issues.length > 0)
      .sort((a, b) => a.length - b.length)[0];
    if (closest?.[0]) segments.push(...closest[0].path.map(String));
  }
  return segments.filter((segment) => !/^\d+$/.test(segment)).at(-1);
}

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
    const field = first && fieldOf(first);
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
