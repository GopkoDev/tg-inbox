import { describe, expect, it } from 'vitest';
import {
  CONTACTS_PAGE_SIZE,
  MEMBER_KINDS,
  OWNER_KINDS,
  TAGS_PER_CONTACT,
  TAGS_PER_WORKSPACE,
  TAG_CHANGES_PER_WINDOW,
  TAG_CHANGE_WINDOW_MS,
  TAG_HISTORY_PAGE_SIZE,
  canAddToContact,
  canCreateTag,
  deletedEntryFor,
  mergeLink,
  mergedEntryFor,
  rateLimitDecision,
  sourceIsValidFor,
} from './tags.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 19, 10, 0, s));

describe('limits', () => {
  it('declares the numbers of the spec', () => {
    expect(TAGS_PER_WORKSPACE).toBe(100);
    expect(TAGS_PER_CONTACT).toBe(20);
    expect(TAG_CHANGES_PER_WINDOW).toBe(60);
    expect(TAG_CHANGE_WINDOW_MS).toBe(60_000);
    expect(CONTACTS_PAGE_SIZE).toBe(50);
    expect(TAG_HISTORY_PAGE_SIZE).toBe(50);
  });
  it('a workspace can create a tag at 99 but not at 100 (AC-08)', () => {
    expect(canCreateTag(0)).toBe(true);
    expect(canCreateTag(99)).toBe(true);
    expect(canCreateTag(100)).toBe(false);
    expect(canCreateTag(101)).toBe(false);
  });
  it('a contact can take a tag at 19 but not at 20 (AC-08)', () => {
    expect(canAddToContact(0)).toBe(true);
    expect(canAddToContact(19)).toBe(true);
    expect(canAddToContact(20)).toBe(false);
  });
});

describe('rateLimitDecision (AC-15)', () => {
  it('allows 59 counted changes and none', () => {
    expect(rateLimitDecision(0, null, t(0))).toEqual({ allowed: true });
    expect(rateLimitDecision(59, t(1), t(30))).toEqual({ allowed: true });
  });
  it('refuses at 60 with retryAt = oldest + 60 s and whole seconds rounded up', () => {
    expect(rateLimitDecision(60, t(10), t(46))).toEqual({
      allowed: false,
      retryAt: t(70),
      retryAfterSeconds: 24,
    });
    const d = rateLimitDecision(60, t(10), new Date(t(46).getTime() + 200));
    expect(d).toMatchObject({ allowed: false, retryAfterSeconds: 24 });
  });
  it('keeps the retry time between 1 and 60 seconds', () => {
    expect(rateLimitDecision(60, t(0), t(0))).toMatchObject({ retryAfterSeconds: 60 });
    expect(rateLimitDecision(60, t(0), new Date(t(60).getTime() - 1))).toMatchObject({
      retryAfterSeconds: 1,
    });
    // the oldest entry is already out of the window: still at least one second
    expect(rateLimitDecision(60, t(0), t(90))).toMatchObject({ retryAfterSeconds: 1 });
  });
  it('treats more than 60 like 60', () => {
    expect(rateLimitDecision(75, t(5), t(6))).toMatchObject({ allowed: false, retryAt: t(65) });
  });
});

describe('history kinds and sources', () => {
  it('splits member and owner kinds', () => {
    expect(MEMBER_KINDS).toEqual(['added', 'removed']);
    expect(OWNER_KINDS).toEqual(['merged', 'deleted']);
  });
  it('member kinds go with inbox / profile, owner kinds with settings only', () => {
    for (const kind of MEMBER_KINDS) {
      expect(sourceIsValidFor(kind, 'inbox')).toBe(true);
      expect(sourceIsValidFor(kind, 'profile')).toBe(true);
      expect(sourceIsValidFor(kind, 'settings')).toBe(false);
    }
    for (const kind of OWNER_KINDS) {
      expect(sourceIsValidFor(kind, 'settings')).toBe(true);
      expect(sourceIsValidFor(kind, 'inbox')).toBe(false);
      expect(sourceIsValidFor(kind, 'profile')).toBe(false);
    }
  });
});

describe('mergeLink (AC-09)', () => {
  const merged = { addedAt: t(10), addedBy: 'acc-merged' };
  const target = { addedAt: t(20), addedBy: 'acc-target' };
  it('re-points the merged link unchanged when the contact carried only the merged tag', () => {
    expect(mergeLink(merged, null)).toEqual(merged);
  });
  it('keeps the earlier link when the contact carried both: merged older', () => {
    expect(mergeLink(merged, target)).toEqual(merged);
  });
  it('keeps the earlier link when the contact carried both: target older', () => {
    expect(mergeLink(target, merged)).toEqual(merged);
    expect(mergeLink({ addedAt: t(30), addedBy: 'x' }, target)).toEqual(target);
  });
  it('keeps the target link on a tie', () => {
    const same = { addedAt: t(10), addedBy: 'acc-other' };
    expect(mergeLink(merged, same)).toEqual(same);
  });
});

describe('history entry builders', () => {
  const base = {
    contactId: 'c1',
    tagId: 'tag-a',
    tagName: 'Loyal',
    actorAccountId: 'owner',
    createdAt: t(1),
  };
  it('mergedEntryFor names the target and comes from settings', () => {
    expect(mergedEntryFor({ ...base, mergedInto: { tagId: 'tag-b', name: 'VIP' } })).toEqual({
      contactId: 'c1',
      tagId: 'tag-a',
      tagName: 'Loyal',
      kind: 'merged',
      mergedInto: { tagId: 'tag-b', name: 'VIP' },
      actorAccountId: 'owner',
      source: 'settings',
      createdAt: t(1),
    });
  });
  it('deletedEntryFor has no target and comes from settings', () => {
    const e = deletedEntryFor(base);
    expect(e).toEqual({
      contactId: 'c1',
      tagId: 'tag-a',
      tagName: 'Loyal',
      kind: 'deleted',
      mergedInto: null,
      actorAccountId: 'owner',
      source: 'settings',
      createdAt: t(1),
    });
    expect(sourceIsValidFor(e.kind, e.source)).toBe(true);
  });
});
