/** Bot-token form after trimming (openapi `BotTokenPaste.token`). */
const BOT_TOKEN = /^([0-9]{1,20}):[A-Za-z0-9_-]{30,100}$/;

export type ParsedBotToken =
  { valid: true; token: string; telegramBotId: bigint } | { valid: false };

/**
 * Trims the pasted text and checks the bot-token form. An invalid form gets the same answer as a
 * token Telegram rejects (AC-02); the part before the colon is the bot's Telegram id.
 */
export function parseBotToken(raw: string): ParsedBotToken {
  const token = raw.trim();
  const match = BOT_TOKEN.exec(token);
  if (!match) return { valid: false };
  return { valid: true, token, telegramBotId: BigInt(match[1]!) };
}
