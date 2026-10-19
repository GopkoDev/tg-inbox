import { describe, expect, it } from 'vitest';
import {
  CONNECT_LINK_LIMIT,
  CONNECT_LINK_TTL_MS,
  CONNECT_LINK_WINDOW_MS,
  hashToken,
  isUsable,
  limitDecision,
  newConnectToken,
  parseStartPayload,
  startPayload,
} from './connect-link.js';

const MIN = 60_000;
const NOW = new Date('2026-10-19T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const bytes = (n: number) => new Uint8Array(n).fill(255);

describe('token and start payload (ADR-0004)', () => {
  it('turns 32 bytes into 43 base64url characters', () => {
    const token = newConnectToken(bytes(32));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newConnectToken(new Uint8Array(32))).toBe('A'.repeat(43));
  });

  it('refuses anything but 32 bytes', () => {
    expect(() => newConnectToken(bytes(31))).toThrow();
    expect(() => newConnectToken(bytes(33))).toThrow();
  });

  it('builds the 47-character start payload', () => {
    const payload = startPayload(newConnectToken(bytes(32)));
    expect(payload).toMatch(/^tgi_[A-Za-z0-9_-]{43}$/);
    expect(payload).toHaveLength(47);
  });

  it('hashes to a 32-byte SHA-256 that differs per token', () => {
    const a = hashToken(newConnectToken(bytes(32)));
    expect(a).toHaveLength(32);
    expect(a.equals(hashToken(newConnectToken(new Uint8Array(32))))).toBe(false);
  });

  it('uses 10 minutes and 5 per 10 minutes', () => {
    expect(CONNECT_LINK_TTL_MS).toBe(10 * MIN);
    expect(CONNECT_LINK_WINDOW_MS).toBe(10 * MIN);
    expect(CONNECT_LINK_LIMIT).toBe(5);
  });
});

describe('parseStartPayload (AC-05, AC-11)', () => {
  const token = 'A'.repeat(43);

  it('reads the token of /start tgi_<43>', () => {
    expect(parseStartPayload(`/start tgi_${token}`)).toBe(token);
    expect(parseStartPayload(`/start@acme_bot tgi_${token}`)).toBe(token);
    expect(parseStartPayload(`  /start tgi_${token}  `)).toBe(token);
  });

  it('is null for a 42-character or 44-character token', () => {
    expect(parseStartPayload(`/start tgi_${'A'.repeat(42)}`)).toBeNull();
    expect(parseStartPayload(`/start tgi_${'A'.repeat(44)}`)).toBeNull();
  });

  it('is null for a campaign payload, a bare /start and other text', () => {
    expect(parseStartPayload('/start promo')).toBeNull();
    expect(parseStartPayload('/start')).toBeNull();
    expect(parseStartPayload(`tgi_${token}`)).toBeNull();
    expect(parseStartPayload(`hello /start tgi_${token}`)).toBeNull();
    expect(parseStartPayload(`/start tgi_${token} extra`)).toBeNull();
    expect(parseStartPayload(`/start abc_${token}`)).toBeNull();
    expect(parseStartPayload(`/startx tgi_${token}`)).toBeNull();
    expect(parseStartPayload('')).toBeNull();
  });

  it('round-trips with startPayload', () => {
    const t = newConnectToken(bytes(32));
    expect(parseStartPayload(`/start ${startPayload(t)}`)).toBe(t);
  });
});

describe('isUsable', () => {
  const link = { usedAt: null, replacedAt: null, expiresAt: new Date(NOW.getTime() + MIN) };

  it('is usable while unused, unreplaced and not expired', () => {
    expect(isUsable(link, NOW)).toBe(true);
  });

  it('is not usable once used, replaced or expired', () => {
    expect(isUsable({ ...link, usedAt: ago(MIN) }, NOW)).toBe(false);
    expect(isUsable({ ...link, replacedAt: ago(MIN) }, NOW)).toBe(false);
    expect(isUsable({ ...link, expiresAt: ago(1) }, NOW)).toBe(false);
  });

  it('expires exactly at expiresAt', () => {
    expect(isUsable({ ...link, expiresAt: NOW }, NOW)).toBe(false);
    expect(isUsable({ ...link, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
  });
});

describe('limitDecision (AC-13)', () => {
  it('allows with fewer than 5 links in the last 10 minutes', () => {
    expect(limitDecision([], NOW)).toEqual({ allowed: true });
    expect(limitDecision([ago(MIN), ago(2 * MIN), ago(3 * MIN), ago(4 * MIN)], NOW)).toEqual({
      allowed: true,
    });
  });

  it('refuses the 6th with the oldest counted link + 10 minutes as the retry time', () => {
    const oldest = ago(5.5 * MIN);
    const r = limitDecision([ago(MIN), ago(2 * MIN), ago(3 * MIN), ago(4 * MIN), oldest], NOW);
    expect(r).toEqual({
      allowed: false,
      retryAt: new Date(oldest.getTime() + 10 * MIN),
      retryAfterSeconds: 270,
    });
  });

  it('does not count links older than the window, including exactly 10 minutes', () => {
    const r = limitDecision(
      [ago(MIN), ago(2 * MIN), ago(3 * MIN), ago(4 * MIN), ago(10 * MIN), ago(11 * MIN)],
      NOW,
    );
    expect(r).toEqual({ allowed: true });
  });

  it('is independent of the order of the input', () => {
    const times = [ago(9 * MIN), ago(MIN), ago(5 * MIN), ago(2 * MIN), ago(3 * MIN)];
    const r = limitDecision(times, NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAt).toEqual(new Date(ago(9 * MIN).getTime() + 10 * MIN));
  });

  it('with more than 5 counted, waits until fewer than 5 remain', () => {
    const times = [ago(9 * MIN), ago(8 * MIN), ago(5 * MIN), ago(4 * MIN), ago(3 * MIN), ago(MIN)];
    const r = limitDecision(times, NOW);
    expect(r.allowed).toBe(false);
    // two must leave the window: the second-oldest (8 min ago) is the one that frees a slot
    if (!r.allowed) expect(r.retryAt).toEqual(new Date(ago(8 * MIN).getTime() + 10 * MIN));
  });

  it('never reports less than 1 second', () => {
    const edge = new Date(NOW.getTime() - 10 * MIN + 1);
    const r = limitDecision([edge, ago(MIN), ago(2 * MIN), ago(3 * MIN), ago(4 * MIN)], NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSeconds).toBe(1);
  });
});
