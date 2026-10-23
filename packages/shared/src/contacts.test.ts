import { describe, expect, it } from 'vitest';
import {
  ChangeOutcome,
  ContactPage,
  ContactProfile,
  ContactRow,
  ContactTag,
  ContactTagAdd,
  ContactTagAdded,
  ContactTagLimitReachedError,
  ContactTagRemove,
  ContactTagRemoved,
  ListContactsQuery,
  MemberTagSource,
  RawTagName,
  TagChangeLimitReachedError,
  TagCountChangedError,
  TagDelete,
  TagDeleted,
  TagFilterMode,
  TagHistoryEntry,
  TagHistoryKind,
  TagHistoryPage,
  TagHistorySource,
  TagLimitReachedError,
  TagList,
  TagMergeTargetChangedError,
  TagName,
  TagNameInvalidError,
  TagNameTakenError,
  TagNotFoundError,
  TagRef,
  TagRename,
  TagRenameResult,
  TagWithCount,
} from './index.js';

const W = '01920000-0000-7000-8000-000000000001';
const C1 = '01920000-0000-7000-8000-0000000000a1';
const C2 = '01920000-0000-7000-8000-0000000000a2';
const T1 = '01920000-0000-7000-8000-000000000301';
const T2 = '01920000-0000-7000-8000-000000000302';
const A = '01920000-0000-7000-8000-000000000101';
const H = '01920000-0000-7000-8000-000000000501';
const member = { account_id: A, display_name: 'Test Member' };
const at = '2026-10-19T09:58:11Z';

const ref = { id: T1, name: 'Kyiv' };
const contactTag = { ...ref, added_by: member, added_at: at };
const withCount = { ...ref, contact_count: 3 };
const row = {
  id: C1,
  workspace_id: W,
  first_name: 'Test',
  last_name: 'User',
  username: 'test_user_1',
  language_code: 'uk',
  first_wrote_at: '2026-09-02T08:14:00Z',
  last_wrote_at: at,
  tags: [ref, { id: T2, name: 'VIP' }],
};
const bareRow = {
  ...row,
  id: C2,
  last_name: null,
  username: null,
  language_code: null,
  first_wrote_at: null,
  last_wrote_at: null,
  tags: [],
};
const page = {
  workspace_id: W,
  filter: { q: null, mode: 'any', tag_ids: [] },
  items: [row, bareRow],
  has_prev: false,
  has_next: true,
  next_cursor: 'MjAyNi0xMC0xOFQxNzo0MDowM1p8MDE5Mg',
  matching_count: 120,
  total_count: 120,
  missing_tag_ids: [],
};
const entry = {
  id: H,
  kind: 'added',
  tag_id: T1,
  tag_name: 'Kyiv',
  merged_into_tag_id: null,
  merged_into_name: null,
  actor: member,
  source: 'profile',
  created_at: at,
};

describe('tag shapes', () => {
  it('TagName is non-empty text', () => {
    expect(TagName.safeParse('VIP').success).toBe(true);
    expect(TagName.safeParse('').success).toBe(false);
  });
  it('TagRef, ContactTag and TagWithCount parse and are strict', () => {
    expect(TagRef.parse(ref)).toEqual(ref);
    expect(TagRef.safeParse({ ...ref, extra: 1 }).success).toBe(false);
    expect(ContactTag.parse(contactTag)).toEqual(contactTag);
    expect(ContactTag.safeParse({ ...contactTag, added_by: undefined }).success).toBe(false);
    expect(TagWithCount.parse(withCount)).toEqual(withCount);
    expect(TagWithCount.safeParse({ ...withCount, contact_count: -1 }).success).toBe(false);
    expect(TagWithCount.safeParse({ ...withCount, contact_count: 1.5 }).success).toBe(false);
  });
  it('TagList holds at most 100 tags', () => {
    const items = Array.from({ length: 100 }, () => withCount);
    expect(TagList.safeParse({ workspace_id: W, items }).success).toBe(true);
    expect(TagList.safeParse({ workspace_id: W, items: [...items, withCount] }).success).toBe(
      false,
    );
  });
});

describe('contact shapes', () => {
  it('TagFilterMode', () => {
    for (const m of ['any', 'all', 'none']) expect(TagFilterMode.safeParse(m).success).toBe(true);
    expect(TagFilterMode.safeParse('some').success).toBe(false);
  });
  it('ContactRow accepts a full row and a contact with nothing known', () => {
    expect(ContactRow.parse(row)).toEqual(row);
    expect(ContactRow.parse(bareRow)).toEqual(bareRow);
    expect(ContactRow.safeParse({ ...row, tags: Array(21).fill(ref) }).success).toBe(false);
    expect(ContactRow.safeParse({ ...row, username: undefined }).success).toBe(false);
  });
  it('ContactPage parses the first page, a filtered page and an empty one', () => {
    expect(ContactPage.parse(page)).toEqual(page);
    const filtered = {
      ...page,
      filter: { q: 'tes', mode: 'all', tag_ids: [T2] },
      items: [row],
      has_next: false,
      next_cursor: null,
      matching_count: 1,
      missing_tag_ids: [T1],
    };
    expect(ContactPage.parse(filtered)).toEqual(filtered);
    const empty = {
      ...page,
      items: [],
      has_next: false,
      next_cursor: null,
      matching_count: 0,
      total_count: 0,
    };
    expect(ContactPage.parse(empty)).toEqual(empty);
  });
  it('ContactPage refuses more than 50 rows, a bad cursor and a missing count', () => {
    expect(ContactPage.safeParse({ ...page, items: Array(51).fill(row) }).success).toBe(false);
    expect(ContactPage.safeParse({ ...page, next_cursor: 'has space' }).success).toBe(false);
    expect(ContactPage.safeParse({ ...page, total_count: undefined }).success).toBe(false);
  });
  it('ContactProfile carries tags with adder and time', () => {
    const profile = { ...row, tags: [contactTag] };
    expect(ContactProfile.parse(profile)).toEqual(profile);
    expect(ContactProfile.safeParse(row).success).toBe(false);
  });
});

describe('ListContactsQuery', () => {
  it('defaults mode to any and reads one or many tag ids', () => {
    expect(ListContactsQuery.parse({})).toEqual({ mode: 'any' });
    expect(ListContactsQuery.parse({ tag: T1 }).tag).toEqual([T1]);
    expect(ListContactsQuery.parse({ tag: [T1, T2], mode: 'all', q: 'x', after: 'abc' })).toEqual({
      tag: [T1, T2],
      mode: 'all',
      q: 'x',
      after: 'abc',
    });
  });
  it('caps q at 200 and tag at 100', () => {
    expect(ListContactsQuery.safeParse({ q: 'a'.repeat(201) }).success).toBe(false);
    expect(ListContactsQuery.safeParse({ q: 'a'.repeat(200) }).success).toBe(true);
    expect(ListContactsQuery.safeParse({ tag: Array(101).fill(T1) }).success).toBe(false);
    expect(ListContactsQuery.safeParse({ tag: ['nope'] }).success).toBe(false);
  });
  it('refuses mode none together with a tag, pointing at the tag field', () => {
    const r = ListContactsQuery.safeParse({ mode: 'none', tag: [T1] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['tag']);
    expect(ListContactsQuery.safeParse({ mode: 'none' }).success).toBe(true);
  });
});

describe('tag history', () => {
  it('kinds and sources', () => {
    for (const k of ['added', 'removed', 'merged', 'deleted'])
      expect(TagHistoryKind.safeParse(k).success).toBe(true);
    expect(TagHistoryKind.safeParse('renamed').success).toBe(false);
    for (const s of ['inbox', 'profile', 'settings'])
      expect(TagHistorySource.safeParse(s).success).toBe(true);
    expect(TagHistorySource.safeParse('api').success).toBe(false);
  });
  it('TagHistoryEntry parses an addition and a merge, and keeps the merge pair together', () => {
    expect(TagHistoryEntry.parse(entry)).toEqual(entry);
    const merged = {
      ...entry,
      kind: 'merged',
      source: 'settings',
      merged_into_tag_id: T2,
      merged_into_name: 'VIP',
    };
    expect(TagHistoryEntry.parse(merged)).toEqual(merged);
    expect(TagHistoryEntry.safeParse({ ...entry, tag_name: '' }).success).toBe(false);
    expect(TagHistoryEntry.safeParse({ ...entry, merged_into_tag_id: T2 }).success).toBe(false);
  });
  it('TagHistoryPage', () => {
    const p = {
      workspace_id: W,
      contact_id: C1,
      items: [entry],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    };
    expect(TagHistoryPage.parse(p)).toEqual(p);
    expect(TagHistoryPage.safeParse({ ...p, items: Array(51).fill(entry) }).success).toBe(false);
  });
});

describe('requests', () => {
  it('MemberTagSource refuses settings', () => {
    expect(MemberTagSource.safeParse('inbox').success).toBe(true);
    expect(MemberTagSource.safeParse('profile').success).toBe(true);
    expect(MemberTagSource.safeParse('settings').success).toBe(false);
  });
  it('RawTagName is 1 to 1000 characters', () => {
    expect(RawTagName.safeParse('x').success).toBe(true);
    expect(RawTagName.safeParse('').success).toBe(false);
    expect(RawTagName.safeParse('x'.repeat(1001)).success).toBe(false);
  });
  it('ContactTagAdd takes exactly one of tag_id and name', () => {
    expect(ContactTagAdd.safeParse({ tag_id: T1, source: 'inbox' }).success).toBe(true);
    expect(ContactTagAdd.safeParse({ name: ' vip ', source: 'profile' }).success).toBe(true);
    expect(ContactTagAdd.safeParse({ tag_id: T1, name: 'x', source: 'inbox' }).success).toBe(false);
    expect(ContactTagAdd.safeParse({ source: 'inbox' }).success).toBe(false);
    expect(ContactTagAdd.safeParse({ tag_id: T1, source: 'settings' }).success).toBe(false);
    expect(ContactTagAdd.safeParse({ tag_id: T1 }).success).toBe(false);
  });
  it('ContactTagRemove, TagRename and TagDelete', () => {
    expect(ContactTagRemove.parse({ source: 'inbox' })).toEqual({ source: 'inbox' });
    expect(ContactTagRemove.safeParse({ source: 'settings' }).success).toBe(false);
    expect(TagRename.parse({ name: 'Gold' })).toEqual({ name: 'Gold' });
    expect(TagRename.parse({ name: 'Gold', merge_into_tag_id: T2 }).merge_into_tag_id).toBe(T2);
    expect(TagRename.safeParse({ name: '' }).success).toBe(false);
    expect(TagDelete.parse({ expected_count: 0 })).toEqual({ expected_count: 0 });
    expect(TagDelete.safeParse({ expected_count: -1 }).success).toBe(false);
    expect(TagDelete.safeParse({}).success).toBe(false);
  });
});

describe('answers', () => {
  it('ChangeOutcome', () => {
    expect(ChangeOutcome.safeParse('recorded').success).toBe(true);
    expect(ChangeOutcome.safeParse('unchanged').success).toBe(true);
    expect(ChangeOutcome.safeParse('done').success).toBe(false);
  });
  it('ContactTagAdded and ContactTagRemoved', () => {
    const added = {
      workspace_id: W,
      contact_id: C1,
      outcome: 'recorded',
      tag: ref,
      tag_created: true,
      tags: [contactTag],
    };
    expect(ContactTagAdded.parse(added)).toEqual(added);
    expect(ContactTagAdded.safeParse({ ...added, tag_created: undefined }).success).toBe(false);
    const removed = { workspace_id: W, contact_id: C1, outcome: 'unchanged', tags: [] };
    expect(ContactTagRemoved.parse(removed)).toEqual(removed);
    expect(
      ContactTagRemoved.safeParse({ ...removed, tags: Array(21).fill(contactTag) }).success,
    ).toBe(false);
  });
  it('TagRenameResult and TagDeleted', () => {
    for (const outcome of ['renamed', 'merged', 'unchanged']) {
      const r = {
        workspace_id: W,
        outcome,
        tag: withCount,
        merged_tag_id: outcome === 'merged' ? T2 : null,
      };
      expect(TagRenameResult.parse(r)).toEqual(r);
    }
    expect(
      TagRenameResult.safeParse({
        workspace_id: W,
        outcome: 'gone',
        tag: withCount,
        merged_tag_id: null,
      }).success,
    ).toBe(false);
    const d = { workspace_id: W, tag_id: T1, removed_from_count: 3 };
    expect(TagDeleted.parse(d)).toEqual(d);
  });
});

describe('tag refusals', () => {
  const env = (code: string, details: unknown) => ({ error: { code, message: 'm', details } });
  it('TAG_NAME_INVALID names the field and the bounds', () => {
    const body = env('TAG_NAME_INVALID', { field: 'name', min_length: 1, max_length: 32 });
    expect(TagNameInvalidError.safeParse(body).success).toBe(true);
    expect(
      TagNameInvalidError.safeParse(
        env('TAG_NAME_INVALID', { field: 'name', min_length: 1, max_length: 33 }),
      ).success,
    ).toBe(false);
  });
  it('TAG_LIMIT_REACHED and CONTACT_TAG_LIMIT_REACHED carry their limits', () => {
    expect(TagLimitReachedError.safeParse(env('TAG_LIMIT_REACHED', { limit: 100 })).success).toBe(
      true,
    );
    expect(TagLimitReachedError.safeParse(env('TAG_LIMIT_REACHED', { limit: 20 })).success).toBe(
      false,
    );
    expect(
      ContactTagLimitReachedError.safeParse(env('CONTACT_TAG_LIMIT_REACHED', { limit: 20 }))
        .success,
    ).toBe(true);
    expect(
      ContactTagLimitReachedError.safeParse(env('CONTACT_TAG_LIMIT_REACHED', { limit: 100 }))
        .success,
    ).toBe(false);
  });
  it('TAG_NOT_FOUND echoes the tag id', () => {
    expect(TagNotFoundError.safeParse(env('TAG_NOT_FOUND', { tag_id: T1 })).success).toBe(true);
    expect(TagNotFoundError.safeParse(env('TAG_NOT_FOUND', { tag_id: 'x' })).success).toBe(false);
  });
  it('TAG_NAME_TAKEN and TAG_COUNT_CHANGED carry the tag with its count', () => {
    expect(TagNameTakenError.safeParse(env('TAG_NAME_TAKEN', { tag: withCount })).success).toBe(
      true,
    );
    expect(TagNameTakenError.safeParse(env('TAG_NAME_TAKEN', {})).success).toBe(false);
    expect(
      TagCountChangedError.safeParse(env('TAG_COUNT_CHANGED', { tag: withCount })).success,
    ).toBe(true);
    expect(TagCountChangedError.safeParse(env('TAG_COUNT_CHANGED', { tag: ref })).success).toBe(
      false,
    );
  });
  it('TAG_MERGE_TARGET_CHANGED carries the holder or null', () => {
    expect(
      TagMergeTargetChangedError.safeParse(
        env('TAG_MERGE_TARGET_CHANGED', { name_holder: withCount }),
      ).success,
    ).toBe(true);
    expect(
      TagMergeTargetChangedError.safeParse(env('TAG_MERGE_TARGET_CHANGED', { name_holder: null }))
        .success,
    ).toBe(true);
    expect(TagMergeTargetChangedError.safeParse(env('TAG_MERGE_TARGET_CHANGED', {})).success).toBe(
      false,
    );
  });
  it('TAG_CHANGE_LIMIT_REACHED carries 60 / 60 and the retry time', () => {
    const d = { limit: 60, window_seconds: 60, retry_at: '2026-10-19T10:21:14Z' };
    expect(TagChangeLimitReachedError.safeParse(env('TAG_CHANGE_LIMIT_REACHED', d)).success).toBe(
      true,
    );
    expect(
      TagChangeLimitReachedError.safeParse(env('TAG_CHANGE_LIMIT_REACHED', { ...d, limit: 30 }))
        .success,
    ).toBe(false);
    expect(
      TagChangeLimitReachedError.safeParse(
        env('TAG_CHANGE_LIMIT_REACHED', { ...d, retry_at: 'soon' }),
      ).success,
    ).toBe(false);
  });
  it('a refusal with another code is rejected', () => {
    expect(TagLimitReachedError.safeParse(env('TAG_NOT_FOUND', { limit: 100 })).success).toBe(
      false,
    );
  });
});
