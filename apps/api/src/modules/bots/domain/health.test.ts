import { describe, expect, it } from 'vitest';
import { DUE_AFTER_MS, isDueForCheck } from './health.js';

const now = new Date('2026-10-11T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('isDueForCheck (AC-15 freshness budget)', () => {
  it('uses a 3-minute threshold', () => {
    expect(DUE_AFTER_MS).toBe(3 * 60_000);
  });

  it('is not due before 3 minutes', () => {
    expect(isDueForCheck(ago(3 * 60_000 - 1), now)).toBe(false);
  });

  it('is due exactly at 3 minutes', () => {
    expect(isDueForCheck(ago(3 * 60_000), now)).toBe(true);
  });

  it('is due after 3 minutes', () => {
    expect(isDueForCheck(ago(10 * 60_000), now)).toBe(true);
  });

  it('is not due for a check in the future (clock skew)', () => {
    expect(isDueForCheck(new Date(now.getTime() + 1000), now)).toBe(false);
  });
});
