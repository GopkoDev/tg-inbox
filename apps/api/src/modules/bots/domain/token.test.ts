import { describe, expect, it } from 'vitest';
import { parseBotToken } from './token.js';

const SECRET = 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('parseBotToken (AC-01, AC-02)', () => {
  it('accepts a bot token and returns the bot id before the colon as bigint', () => {
    expect(parseBotToken(`123456:${SECRET}`)).toEqual({
      valid: true,
      token: `123456:${SECRET}`,
      telegramBotId: 123456n,
    });
  });

  it('ignores surrounding spaces and newlines', () => {
    expect(parseBotToken(`  123:${SECRET} \n`)).toMatchObject({
      valid: true,
      token: `123:${SECRET}`,
    });
  });

  it('keeps a 20-digit bot id exact', () => {
    const result = parseBotToken(`12345678901234567890:${SECRET}`);
    expect(result).toMatchObject({ valid: true, telegramBotId: 12345678901234567890n });
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['short secret', '123:short'],
    ['non-numeric id', `abc:${SECRET}`],
    ['no colon', `123${SECRET}`],
    ['21-digit id', `123456789012345678901:${SECRET}`],
    ['secret over 100 chars', `123:${'a'.repeat(101)}`],
    ['inner space', `123:${SECRET.slice(0, 10)} ${SECRET.slice(10)}`],
    ['illegal character', `123:${SECRET}!`],
    ['two tokens', `123:${SECRET} 456:${SECRET}`],
  ])('rejects %s', (_name, raw) => {
    expect(parseBotToken(raw)).toEqual({ valid: false });
  });

  it('accepts the edges of the secret length (30 and 100)', () => {
    expect(parseBotToken(`1:${'a'.repeat(30)}`).valid).toBe(true);
    expect(parseBotToken(`1:${'a'.repeat(100)}`).valid).toBe(true);
    expect(parseBotToken(`1:${'a'.repeat(29)}`).valid).toBe(false);
  });
});
