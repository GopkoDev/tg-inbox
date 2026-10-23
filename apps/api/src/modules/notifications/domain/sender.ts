const MAX_LENGTH = 100;

export interface TelegramSender {
  firstName?: string | undefined;
  lastName?: string | undefined;
  username?: string | undefined;
}

/** First + last name, else `@username`, else a neutral label. Stored as plain text and shown only to that member. */
export function telegramDisplayName(from: TelegramSender): string {
  const name = [from.firstName, from.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' ');
  const username = from.username?.trim();
  const shown = name || (username ? `@${username}` : 'Telegram user');
  return shown.slice(0, MAX_LENGTH);
}
