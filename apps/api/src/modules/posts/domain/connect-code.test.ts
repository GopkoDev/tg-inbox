import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, hashCode, newCode, parseCode } from './connect-code.js';

describe('connect code (AC-01 format)', () => {
  it('newCode is tgp_ + random, unique, with the sha-256 hash and a 10-minute ttl', () => {
    const a = newCode();
    const b = newCode();
    expect(a.code).toMatch(/^tgp_[A-Za-z0-9_-]{20,}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.hash).toEqual(hashCode(a.code));
    expect(CODE_TTL_MS).toBe(10 * 60_000);
  });

  it('hashCode is deterministic and differs per code', () => {
    expect(hashCode('tgp_a')).toEqual(hashCode('tgp_a'));
    expect(hashCode('tgp_a')).not.toEqual(hashCode('tgp_b'));
  });

  describe('parseCode', () => {
    it('reads /connect@bot tgp_x in a group', () => {
      expect(parseCode('/connect@my_bot tgp_abc123', { botUsername: 'my_bot' })).toBe('tgp_abc123');
    });
    it('bot name match is case-insensitive', () => {
      expect(parseCode('/connect@My_Bot tgp_abc123', { botUsername: 'my_bot' })).toBe('tgp_abc123');
    });
    it('ignores a command addressed to another bot', () => {
      expect(parseCode('/connect@other_bot tgp_x', { botUsername: 'my_bot' })).toBeNull();
    });
    it('finds a code with surrounding text in a channel post', () => {
      expect(
        parseCode('hello\nhere: tgp_Ab-_9 thanks', { botUsername: 'my_bot', channel: true }),
      ).toBe('tgp_Ab-_9');
    });
    it('a plain group message with a code but no command is not a code', () => {
      expect(parseCode('here tgp_abc', { botUsername: 'my_bot' })).toBeNull();
    });
    it('no code at all', () => {
      expect(parseCode('/connect@my_bot', { botUsername: 'my_bot' })).toBeNull();
      expect(parseCode('just text', { botUsername: 'my_bot', channel: true })).toBeNull();
    });
  });
});
