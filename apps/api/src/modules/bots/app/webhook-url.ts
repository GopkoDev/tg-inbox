/** The per-bot webhook URL (ADR-0002): only tg-inbox's opaque bot row id, never the token. */
export function webhookUrl(baseUrl: string, botId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/telegram/webhook/${botId}`;
}
