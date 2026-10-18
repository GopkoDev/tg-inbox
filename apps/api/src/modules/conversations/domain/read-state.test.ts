import { describe, expect, it } from 'vitest';
import { raise, unreadFloor } from './read-state.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

describe('raise (AC-03, AC-15)', () => {
  it('advances to the proposed arrival when it is newer', () => {
    expect(raise(t(1), t(5), t(10))).toEqual(t(5));
  });

  it('keeps the stored value when the proposal is older', () => {
    expect(raise(t(5), t(1), t(10))).toEqual(t(5));
  });

  it('clamps a proposal in the future to the newest arrival', () => {
    expect(raise(t(1), t(99), t(10))).toEqual(t(10));
  });

  it('never lowers, equal values are stable', () => {
    expect(raise(t(5), t(5), t(10))).toEqual(t(5));
  });

  it('starts from no mark (null current)', () => {
    expect(raise(null, t(5), t(10))).toEqual(t(5));
    expect(raise(null, t(99), t(10))).toEqual(t(10));
  });
});

describe('unreadFloor', () => {
  it('uses active_since alone when the member has no mark', () => {
    expect(unreadFloor(null, t(3))).toEqual(t(3));
  });

  it('is the greater of mark and active_since', () => {
    expect(unreadFloor(t(8), t(3))).toEqual(t(8));
    expect(unreadFloor(t(2), t(3))).toEqual(t(3));
  });
});
