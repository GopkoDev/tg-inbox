import { Api } from 'grammy';

/** Every Bot API call goes through an Api built here — one per business bot token. */
export function telegramApi(botToken: string): Api {
  return new Api(botToken);
}
