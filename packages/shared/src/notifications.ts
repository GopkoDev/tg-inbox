import { z } from 'zod';
import { InboxBotStatus } from './inbox.js';
import { Role } from './workspaces.js';

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();

// ───────── attention count ─────────

export const AttentionCount = z.strictObject({
  workspace_id: Id,
  count: z.number().int().min(0),
});
export type AttentionCount = z.infer<typeof AttentionCount>;

// ───────── notification settings ─────────

/** Derived, not stored: blocked first, then a bot that is not working, otherwise on. */
export const PingsState = z.enum(['on', 'paused', 'not_reachable']);
export type PingsState = z.infer<typeof PingsState>;

export const TelegramNotConnected = z.strictObject({ state: z.literal('not_connected') });
/** Never carries the Telegram user id. */
export const TelegramConnected = z.strictObject({
  state: z.literal('connected'),
  display_name: z.string().min(1),
  linked_at: DateTime,
  blocked_at: DateTime.nullable(),
  pings: PingsState,
});

export const TelegramLinkState = z.discriminatedUnion('state', [
  TelegramNotConnected,
  TelegramConnected,
]);
export type TelegramLinkState = z.infer<typeof TelegramLinkState>;

export const NotificationSettings = z.strictObject({
  workspace_id: Id,
  caller_role: Role,
  bot: InboxBotStatus,
  telegram: TelegramLinkState,
  can_connect: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

// ───────── connect link ─────────

export const IssuedConnectLink = z.strictObject({
  workspace_id: Id,
  bot_username: z.string(),
  /** `https://t.me/<bot>?start=tgi_<43 base64url characters>` (32 random bytes). */
  url: z.string().regex(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=tgi_[A-Za-z0-9_-]{43}$/),
  expires_at: DateTime,
});
export type IssuedConnectLink = z.infer<typeof IssuedConnectLink>;

// ───────── refusals ─────────

const refusal = <C extends string, D extends z.ZodType>(code: C, details: D) =>
  z.strictObject({
    error: z.strictObject({ code: z.literal(code), message: z.string(), details }),
  });

export const ConnectLinkLimitReachedError = refusal(
  'CONNECT_LINK_LIMIT_REACHED',
  z.strictObject({
    limit: z.literal(5),
    window_seconds: z.literal(600),
    retry_at: DateTime,
  }),
);

export const TelegramAlreadyLinkedError = refusal(
  'TELEGRAM_ALREADY_LINKED',
  z.strictObject({ settings: NotificationSettings }),
);

export const PingsNeedWorkingBotError = refusal(
  'PINGS_NEED_WORKING_BOT',
  z.strictObject({ settings: NotificationSettings }),
);
