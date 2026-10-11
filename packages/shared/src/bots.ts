import { z } from 'zod';

const DateTime = z.iso.datetime({ offset: true });

/** The bot as Telegram's getMe names it. No length bounds: Telegram's strings get none. */
export const BotIdentity = z.strictObject({
  name: z.string(),
  /** Stored without `@`. */
  username: z.string(),
});
export type BotIdentity = z.infer<typeof BotIdentity>;

/**
 * The state of a live connection. The stored `disconnected`, and no bot at all, are both shown as
 * `not_connected` in BotSettings.
 */
export const BotState = z.enum(['connected', 'needs_token', 'taken_over']);
export type BotState = z.infer<typeof BotState>;

export const NotConnectedBotSettings = z.strictObject({ state: z.literal('not_connected') });

export const ConnectedBotSettings = z.strictObject({
  state: BotState,
  bot: BotIdentity,
  last_checked_at: DateTime,
  /** Null before the first message (AC-07). */
  last_message_received_at: DateTime.nullable(),
  contacts_count: z.number().int().min(0),
});

/**
 * What Bot settings (SCR-02) shows; returned by every owner bot route and every refusal that
 * carries `details.settings`. Strict on purpose: no token or webhook secret can ever be added.
 */
export const BotSettings = z.discriminatedUnion('state', [
  NotConnectedBotSettings,
  ConnectedBotSettings,
]);
export type BotSettings = z.infer<typeof BotSettings>;

/**
 * The paste step of SCR-03. Only bounds the raw input: the server trims and checks the bot-token
 * form itself (bots domain), answering BOT_TOKEN_INVALID like a token Telegram rejects (AC-02).
 */
export const BotTokenPaste = z.strictObject({
  token: z.string().max(512),
  /** true only on the resubmission after the owner confirmed the takeover warning (SCR-04). */
  confirm_takeover: z.boolean().default(false),
});
export type BotTokenPaste = z.infer<typeof BotTokenPaste>;

export const BotReconnect = z.strictObject({
  confirm_takeover: z.boolean().default(false),
});
export type BotReconnect = z.infer<typeof BotReconnect>;

/** `details` of WORKSPACE_KEEPS_ONE_BOT (AC-05). */
export const WorkspaceKeepsOneBotDetails = z.strictObject({
  reason: z.enum(['connected', 'history']),
});
export type WorkspaceKeepsOneBotDetails = z.infer<typeof WorkspaceKeepsOneBotDetails>;

/** `details` of TAKEOVER_CONFIRMATION_REQUIRED (AC-06). */
export const TakeoverConfirmationDetails = z.strictObject({ bot: BotIdentity });
export type TakeoverConfirmationDetails = z.infer<typeof TakeoverConfirmationDetails>;

/** `details` of NOTHING_TO_RECONNECT, BOT_NEEDS_NEW_TOKEN and NO_BOT_CONNECTED. */
export const SettingsRefusalDetails = z.strictObject({ settings: BotSettings });
export type SettingsRefusalDetails = z.infer<typeof SettingsRefusalDetails>;
