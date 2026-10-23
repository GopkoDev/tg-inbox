import { describe, expect, it } from 'vitest';
import {
  CHANGE_LIMIT,
  CHANGE_WINDOW_MS,
  activityKindFor,
  changeRetryAt,
  isValidActivity,
  limitReached,
  positionAt,
} from './activity.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

describe('activityKindFor (AC-09)', () => {
  it('assigned when there was no assignee', () => {
    expect(activityKindFor(null, 'a')).toBe('assigned');
  });
  it('reassigned when the assignee changes to another member', () => {
    expect(activityKindFor('a', 'b')).toBe('reassigned');
  });
  it('unassigned when the assignee is removed', () => {
    expect(activityKindFor('a', null)).toBe('unassigned');
  });
  it('none for an unchanged pair', () => {
    expect(activityKindFor('a', 'a')).toBeNull();
    expect(activityKindFor(null, null)).toBeNull();
  });
});

describe('isValidActivity (data-model CHECKs)', () => {
  const ok = (
    kind: Parameters<typeof isValidActivity>[0]['kind'],
    cause: Parameters<typeof isValidActivity>[0]['cause'],
    actor: string | null,
    previous: string | null,
    next: string | null,
  ) => isValidActivity({ kind, cause, actor, previous, next });

  it('accepts member entries with the right assignee pair', () => {
    expect(ok('assigned', 'member', 'm', null, 'a')).toBe(true);
    expect(ok('reassigned', 'member', 'm', 'a', 'b')).toBe(true);
    expect(ok('unassigned', 'member', 'm', 'a', null)).toBe(true);
    expect(ok('closed', 'member', 'm', null, null)).toBe(true);
    expect(ok('reopened', 'member', 'm', null, null)).toBe(true);
  });
  it('rejects a wrong assignee pair for the kind', () => {
    expect(ok('assigned', 'member', 'm', 'a', 'b')).toBe(false);
    expect(ok('assigned', 'member', 'm', null, null)).toBe(false);
    expect(ok('reassigned', 'member', 'm', 'a', 'a')).toBe(false);
    expect(ok('reassigned', 'member', 'm', null, 'a')).toBe(false);
    expect(ok('unassigned', 'member', 'm', null, null)).toBe(false);
    expect(ok('unassigned', 'member', 'm', 'a', 'b')).toBe(false);
    expect(ok('closed', 'member', 'm', 'a', null)).toBe(false);
    expect(ok('reopened', 'member', 'm', null, 'a')).toBe(false);
  });
  it('an actor is set exactly when the cause is member', () => {
    expect(ok('closed', 'member', null, null, null)).toBe(false);
    expect(ok('reopened', 'customer_wrote', 'm', null, null)).toBe(false);
    expect(ok('unassigned', 'member_deactivated', 'm', 'a', null)).toBe(false);
  });
  it('automatic causes only on their kinds', () => {
    expect(ok('reopened', 'customer_wrote', null, null, null)).toBe(true);
    expect(ok('reopened', 'reply_not_delivered', null, null, null)).toBe(true);
    expect(ok('unassigned', 'member_deactivated', null, 'a', null)).toBe(true);
    expect(ok('closed', 'customer_wrote', null, null, null)).toBe(false);
    expect(ok('assigned', 'member_deactivated', null, null, 'a')).toBe(false);
    expect(ok('reassigned', 'customer_wrote', null, 'a', 'b')).toBe(false);
    expect(ok('unassigned', 'customer_wrote', null, 'a', null)).toBe(false);
    expect(ok('reopened', 'member_deactivated', null, null, null)).toBe(false);
  });
});

describe('positionAt (AC-05)', () => {
  it('is the clock when it is later than the latest entry', () => {
    expect(positionAt(t(10), t(5))).toEqual(t(10));
  });
  it('is the latest entry when the clock is earlier', () => {
    expect(positionAt(t(3), t(5))).toEqual(t(5));
  });
  it('is the clock when there is no entry', () => {
    expect(positionAt(t(3), null)).toEqual(t(3));
  });
  it('equal values give that value', () => {
    expect(positionAt(t(5), t(5))).toEqual(t(5));
  });
});

describe('change limit (AC-12)', () => {
  it('is 60 per 60 seconds', () => {
    expect(CHANGE_LIMIT).toBe(60);
    expect(CHANGE_WINDOW_MS).toBe(60_000);
  });
  it('reached at 60 counted changes, not at 59', () => {
    expect(limitReached(59)).toBe(false);
    expect(limitReached(60)).toBe(true);
    expect(limitReached(61)).toBe(true);
  });
  it('retry_at is when the oldest counted change leaves the window', () => {
    expect(changeRetryAt(t(0))).toEqual(t(60));
    expect(changeRetryAt(t(7))).toEqual(new Date(t(7).getTime() + CHANGE_WINDOW_MS));
  });
});
