import {
  ConnectLinkLimitReachedError,
  ErrorCode,
  IssuedConnectLink,
  NotificationSettings,
  PingsNeedWorkingBotError,
  TelegramAlreadyLinkedError,
} from '@tg/shared';
import { ApiError, apiRequest } from '@/shared/api/client';

const notifications = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/notifications`;

/** The caller's own Telegram link state and the bot's readiness (getNotificationSettings). */
export const getNotificationSettings = (
  workspaceId: string,
  options: { background?: boolean } = {},
) =>
  apiRequest(
    notifications(workspaceId),
    NotificationSettings,
    options.background ? { background: true } : {},
  );

/** A single-use connect link for the caller's own membership (createConnectLink). */
export const createConnectLink = (workspaceId: string) =>
  apiRequest(`${notifications(workspaceId)}/telegram/connect-link`, IssuedConnectLink, {
    method: 'POST',
  });

/** Removes the caller's link; answers the settings after the change (disconnectTelegram). */
export const disconnectTelegram = (workspaceId: string) =>
  apiRequest(`${notifications(workspaceId)}/telegram/disconnect`, NotificationSettings, {
    method: 'POST',
  });

/** The three refusals of `createConnectLink` that the panel shows itself (not the guard). */
export type ConnectRefusal =
  | { kind: 'limit'; retryAt: string }
  | { kind: 'already_linked'; settings: NotificationSettings }
  | { kind: 'no_working_bot'; settings: NotificationSettings };

export function connectRefusal(error: unknown): ConnectRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const envelope = { error: { code: error.code, message: error.message, details: error.details } };
  switch (error.code) {
    case ErrorCode.CONNECT_LINK_LIMIT_REACHED: {
      const parsed = ConnectLinkLimitReachedError.safeParse(envelope);
      return parsed.success ? { kind: 'limit', retryAt: parsed.data.error.details.retry_at } : null;
    }
    case ErrorCode.TELEGRAM_ALREADY_LINKED: {
      const parsed = TelegramAlreadyLinkedError.safeParse(envelope);
      return parsed.success
        ? { kind: 'already_linked', settings: parsed.data.error.details.settings }
        : null;
    }
    case ErrorCode.PINGS_NEED_WORKING_BOT: {
      const parsed = PingsNeedWorkingBotError.safeParse(envelope);
      return parsed.success
        ? { kind: 'no_working_bot', settings: parsed.data.error.details.settings }
        : null;
    }
    default:
      return null;
  }
}
