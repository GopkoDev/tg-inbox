import { describe, expect, it } from 'vitest';
import { telegramLink } from './telegram-link.js';

describe('telegramLink', () => {
  it('public chat: t.me/<username>/<id>', () => {
    expect(telegramLink({ username: 'test_channel', chatId: -1001234567890n, messageId: 41 })).toBe(
      'https://t.me/test_channel/41',
    );
  });
  it('private chat: t.me/c/<id without -100>/<msgId>', () => {
    expect(telegramLink({ username: null, chatId: -1001234567890n, messageId: 7 })).toBe(
      'https://t.me/c/1234567890/7',
    );
  });
  it('no link for a basic group (no -100 prefix) without a username', () => {
    expect(telegramLink({ username: null, chatId: -555n, messageId: 7 })).toBeNull();
  });
});
