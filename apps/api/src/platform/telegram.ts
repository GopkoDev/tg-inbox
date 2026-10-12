import { Api } from 'grammy';

export interface TelegramApiOptions {
  /** Bot API base URL; tests point it at a fake Bot API (`TELEGRAM_API_ROOT`). */
  apiRoot?: string;
}

/** Every Bot API call goes through an Api built here — one per business bot token. */
export function telegramApi(botToken: string, options: TelegramApiOptions = {}): Api {
  return new Api(botToken, options.apiRoot ? { apiRoot: options.apiRoot } : undefined);
}
