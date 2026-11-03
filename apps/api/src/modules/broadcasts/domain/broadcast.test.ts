import { describe, expect, it } from 'vitest';
import {
  BROADCAST_STATUSES,
  canDelete,
  canLaunch,
  canMove,
  canStop,
  isEditable,
  isStaleVersion,
  nextVersion,
  type BroadcastStatus,
  type DraftChange,
} from './broadcast.js';

const A = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01';
const B = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02';

describe('status machine (AC-09, AC-18)', () => {
  const legal: Array<[BroadcastStatus, BroadcastStatus]> = [
    ['draft', 'sending'],
    ['sending', 'sent'],
    ['sending', 'stopped'],
  ];
  it.each(
    BROADCAST_STATUSES.flatMap((from) => BROADCAST_STATUSES.map((to) => [from, to] as const)),
  )('%s -> %s', (from, to) => {
    const expected = legal.some(([f, t]) => f === from && t === to);
    expect(canMove(from, to)).toBe(expected);
  });
  it('only a draft is editable', () => {
    expect(BROADCAST_STATUSES.filter(isEditable)).toEqual(['draft']);
  });
});

describe('who may act (AC-07)', () => {
  it('a draft is deleted by its author or a business owner, by no one else', () => {
    expect(canDelete({ role: 'operator', accountId: A, authorId: A })).toBe(true);
    expect(canDelete({ role: 'owner', accountId: B, authorId: A })).toBe(true);
    expect(canDelete({ role: 'owner', accountId: A, authorId: A })).toBe(true);
    expect(canDelete({ role: 'operator', accountId: B, authorId: A })).toBe(false);
  });
  it('only a business owner launches and stops', () => {
    expect(canLaunch('owner')).toBe(true);
    expect(canLaunch('operator')).toBe(false);
    expect(canStop('owner')).toBe(true);
    expect(canStop('operator')).toBe(false);
  });
});

describe('version rule (AC-03, ADR-0005)', () => {
  it.each<[DraftChange[], number]>([
    [['name'], 5],
    [['text'], 5],
    [['name', 'text'], 5],
    [['kind'], 5],
    [['tags'], 5],
    [['group_add'], 4],
    [['group_remove'], 4],
    [['group_add', 'group_remove'], 4],
    [[], 4],
  ])('%j from version 4 -> %i', (changes, expected) => {
    expect(nextVersion(4, changes)).toBe(expected);
  });
  it('a save against another version than the current one is stale', () => {
    expect(isStaleVersion({ expected: 4, current: 4 })).toBe(false);
    expect(isStaleVersion({ expected: 3, current: 4 })).toBe(true);
    expect(isStaleVersion({ expected: 5, current: 4 })).toBe(true);
  });
});
