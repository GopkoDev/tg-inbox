import {
  BotIdentity,
  BotSettings,
  ErrorCode,
  SettingsRefusalDetails,
  TakeoverConfirmationDetails,
  WorkspaceKeepsOneBotDetails,
  type BotReconnect,
  type BotTokenPaste,
} from '@tg/shared';
import { ApiError, apiRequest } from '@/shared/api/client';

const bot = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/bot`;

/** SCR-02 load: a pure database read on the server (no Telegram call). */
export const getBotSettings = (workspaceId: string, options: { background?: boolean } = {}) =>
  apiRequest(bot(workspaceId), BotSettings, options.background ? { background: true } : {});

/** Connect, rotate or re-paste. The token travels only in this request body. */
export const pasteBotToken = (workspaceId: string, body: BotTokenPaste) =>
  apiRequest(`${bot(workspaceId)}/token`, BotSettings, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const reconnectBot = (workspaceId: string, body: BotReconnect) =>
  apiRequest(`${bot(workspaceId)}/reconnect`, BotSettings, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const disconnectBot = (workspaceId: string) =>
  apiRequest(`${bot(workspaceId)}/disconnect`, BotSettings, { method: 'POST' });

/** A refused bot action: the envelope's code and message plus its typed `details`. */
export interface BotRefusal {
  code: ErrorCode;
  /** The contract message — the panel shows it as is. */
  message: string;
  reason?: WorkspaceKeepsOneBotDetails['reason'];
  bot?: BotIdentity;
  settings?: BotSettings;
}

/** Types an ApiError of a bot route; null for anything else. Unexpected details are dropped. */
export function botRefusal(error: unknown): BotRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const refusal: BotRefusal = { code: error.code, message: error.message };
  switch (error.code) {
    case ErrorCode.WORKSPACE_KEEPS_ONE_BOT: {
      const d = WorkspaceKeepsOneBotDetails.safeParse(error.details);
      if (d.success) refusal.reason = d.data.reason;
      break;
    }
    case ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED: {
      const d = TakeoverConfirmationDetails.safeParse(error.details);
      if (d.success) refusal.bot = d.data.bot;
      break;
    }
    case ErrorCode.NOTHING_TO_RECONNECT:
    case ErrorCode.BOT_NEEDS_NEW_TOKEN:
    case ErrorCode.NO_BOT_CONNECTED: {
      const d = SettingsRefusalDetails.safeParse(error.details);
      if (d.success) refusal.settings = d.data.settings;
      break;
    }
  }
  return refusal;
}
