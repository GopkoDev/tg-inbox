import { describe, expect, it } from 'vitest';
import { telegramDisplayName } from './sender.js';

describe('telegramDisplayName', () => {
  it('first and last name', () => {
    expect(telegramDisplayName({ firstName: 'Test', lastName: 'User', username: 'tu' })).toBe(
      'Test User',
    );
  });
  it('first name only', () => {
    expect(telegramDisplayName({ firstName: 'Test' })).toBe('Test');
  });
  it('else @username', () => {
    expect(telegramDisplayName({ firstName: '  ', username: 'test_user' })).toBe('@test_user');
  });
  it('else a neutral label', () => {
    expect(telegramDisplayName({})).toBe('Telegram user');
  });
  it('is cut to 100 characters', () => {
    expect(telegramDisplayName({ firstName: 'x'.repeat(300) })).toHaveLength(100);
  });
});
