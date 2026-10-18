import { describe, expect, it } from 'vitest';
import { isOverLimit, limitRetryAt } from './limit.js';

describe('per-member reply limit (AC-12b)', () => {
  it.each([
    [0, false],
    [29, false],
    [30, true],
    [31, true],
  ])('isOverLimit(%i) = %s', (count, over) => {
    expect(isOverLimit(count)).toBe(over);
  });

  it('frees up 60 s after the oldest counted attempt', () => {
    const oldest = new Date('2026-01-01T10:00:00.000Z');
    expect(limitRetryAt(oldest)).toEqual(new Date('2026-01-01T10:01:00.000Z'));
  });
});
