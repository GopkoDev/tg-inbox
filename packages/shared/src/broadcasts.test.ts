import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import * as shared from './index.js';
import {
  AudienceFingerprint,
  Broadcast,
  BroadcastAudienceSave,
  BroadcastChangedFrame,
  BroadcastFieldsSave,
  BroadcastRecipient,
  ContactChangedFrame,
  ContactRow,
  ConversationChangedFrame,
  DraftBreakdown,
  LaunchBreakdown,
  LaunchedBroadcast,
  LiveFrame,
  ThreadBroadcastItem,
  ThreadItem,
} from './index.js';

const W = '01920000-0000-7000-8000-000000000001';
const B = '01920000-0000-7000-8000-000000000501';
const C = '01920000-0000-7000-8000-0000000000c1';
const T1 = '01920000-0000-7000-8000-000000000302';
const T2 = '01920000-0000-7000-8000-000000000303';
const I = '01920000-0000-7000-8000-000000000701';
const member = { account_id: '01920000-0000-7000-8000-0000000000b1', display_name: 'Test User' };
const at = '2026-10-23T09:00:00Z';

const schemaNamed = (name: string) => {
  const schema = (shared as unknown as Record<string, z.ZodType | undefined>)[name];
  if (!schema) throw new Error(`no schema ${name}`);
  return schema;
};

describe('broadcasts contract examples (openapi.yaml)', () => {
  it.each(CONTRACT_EXAMPLES)('%s parses as %s', (_label, schema, value) => {
    const parsed = schemaNamed(schema).safeParse(value);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('broadcasts constants', () => {
  it('a fingerprint is 64 lowercase hex characters', () => {
    expect(AudienceFingerprint.safeParse('a'.repeat(64)).success).toBe(true);
    expect(AudienceFingerprint.safeParse('a'.repeat(63)).success).toBe(false);
    expect(AudienceFingerprint.safeParse('A'.repeat(64)).success).toBe(false);
  });
});

describe('BroadcastRecipient', () => {
  const recipient = {
    id: I,
    position: 1,
    contact: { id: C, first_name: 'Test', last_name: null, username: null },
    state: 'failed',
    failure_reason: 'account_gone',
    outcome_at: at,
  };
  it('a failed recipient carries a reason, no other does', () => {
    expect(BroadcastRecipient.safeParse(recipient).success).toBe(true);
    expect(BroadcastRecipient.safeParse({ ...recipient, failure_reason: null }).success).toBe(
      false,
    );
    expect(
      BroadcastRecipient.safeParse({
        ...recipient,
        state: 'delivered',
        failure_reason: 'account_gone',
      }).success,
    ).toBe(false);
  });
  it('a waiting or in-flight recipient has no outcome time; an outcome has one', () => {
    const waiting = { ...recipient, state: 'waiting', failure_reason: null, outcome_at: null };
    expect(BroadcastRecipient.safeParse(waiting).success).toBe(true);
    expect(BroadcastRecipient.safeParse({ ...waiting, outcome_at: at }).success).toBe(false);
    expect(
      BroadcastRecipient.safeParse({ ...waiting, state: 'delivered', outcome_at: null }).success,
    ).toBe(false);
  });
});

describe('breakdowns', () => {
  it('a draft breakdown adds up when reach is known, and reach is null without a bot', () => {
    expect(DraftBreakdown.safeParse({ audience_size: 5, reach: null }).success).toBe(true);
    const reach = { blocked_count: 1, never_wrote_count: 1, reachable_count: 3 };
    expect(DraftBreakdown.safeParse({ audience_size: 5, reach }).success).toBe(true);
    expect(DraftBreakdown.safeParse({ audience_size: 6, reach }).success).toBe(false);
  });
  it('a launch breakdown adds up', () => {
    const b = { audience_size: 3, blocked_count: 1, never_wrote_count: 2, recipient_count: 0 };
    expect(LaunchBreakdown.safeParse(b).success).toBe(true);
    expect(LaunchBreakdown.safeParse({ ...b, audience_size: 4 }).success).toBe(false);
  });
});

describe('LaunchedBroadcast', () => {
  const launched = {
    id: B,
    workspace_id: W,
    status: 'sending',
    name: 'Test broadcast 1',
    text: 'Hello',
    author: member,
    last_changed_by: member,
    last_changed_at: at,
    created_at: at,
    audience: { kind: 'group' },
    launched_by: member,
    launched_at: at,
    launch_breakdown: {
      audience_size: 1,
      blocked_count: 0,
      never_wrote_count: 0,
      recipient_count: 1,
    },
    stopped_by: null,
    stopped_at: null,
    ended_at: null,
    end_reason: null,
    totals: {
      waiting: 1,
      sending: 0,
      delivered: 0,
      blocked: 0,
      failed: 0,
      not_confirmed: 0,
      stopped: 0,
    },
    not_reached_count: 0,
  };
  it('parses as a Broadcast by its status', () => {
    expect(Broadcast.parse(launched)).toEqual(launched);
  });
  it('names who stopped it exactly when stopped, and ends exactly when not sending', () => {
    expect(LaunchedBroadcast.safeParse({ ...launched, stopped_by: member }).success).toBe(false);
    expect(LaunchedBroadcast.safeParse({ ...launched, ended_at: at }).success).toBe(false);
    expect(
      LaunchedBroadcast.safeParse({
        ...launched,
        status: 'sent',
        ended_at: at,
        end_reason: 'completed',
      }).success,
    ).toBe(true);
    expect(
      LaunchedBroadcast.safeParse({
        ...launched,
        status: 'sent',
        ended_at: at,
        end_reason: 'stopped',
      }).success,
    ).toBe(false);
    expect(
      LaunchedBroadcast.safeParse({
        ...launched,
        status: 'stopped',
        stopped_by: member,
        stopped_at: at,
        ended_at: at,
        end_reason: 'stopped',
      }).success,
    ).toBe(true);
  });
  it('a launched text is never empty and at most 4096 UTF-16 units', () => {
    expect(LaunchedBroadcast.safeParse({ ...launched, text: '' }).success).toBe(false);
    expect(
      LaunchedBroadcast.safeParse({ ...launched, text: '\u{1F600}'.repeat(2048) }).success,
    ).toBe(true);
    expect(
      LaunchedBroadcast.safeParse({ ...launched, text: '\u{1F600}'.repeat(2049) }).success,
    ).toBe(false);
  });
});

describe('requests', () => {
  it('a fields save needs a name or a text', () => {
    expect(BroadcastFieldsSave.safeParse({ expected_version: 1 }).success).toBe(false);
    expect(BroadcastFieldsSave.safeParse({ expected_version: 1, name: 'x' }).success).toBe(true);
    expect(BroadcastFieldsSave.safeParse({ expected_version: 0, text: 'x' }).success).toBe(false);
  });
  it('a tag audience refuses "no tags" with tags, a tag both ways and a repeated tag, naming the field', () => {
    const base = {
      expected_version: 1,
      kind: 'tags',
      mode: 'any',
      tag_ids: [T1],
      exclude_tag_ids: [],
    };
    expect(BroadcastAudienceSave.safeParse(base).success).toBe(true);
    const none = BroadcastAudienceSave.safeParse({ ...base, mode: 'none' });
    expect(none.error?.issues[0]?.path).toEqual(['tag_ids']);
    const noneExcluding = BroadcastAudienceSave.safeParse({
      ...base,
      mode: 'none',
      tag_ids: [],
      exclude_tag_ids: [T2],
    });
    expect(noneExcluding.error?.issues[0]?.path).toEqual(['tag_ids']);
    const both = BroadcastAudienceSave.safeParse({ ...base, exclude_tag_ids: [T1] });
    expect(both.error?.issues[0]?.path).toEqual(['exclude_tag_ids']);
    expect(BroadcastAudienceSave.safeParse({ ...base, tag_ids: [T1, T1] }).success).toBe(false);
    expect(
      BroadcastAudienceSave.safeParse({ expected_version: 1, kind: 'group', mode: 'any' }).success,
    ).toBe(false);
  });
});

describe('ContactRow', () => {
  const row = {
    id: C,
    workspace_id: W,
    first_name: 'Test',
    last_name: null,
    username: null,
    language_code: null,
    first_wrote_at: null,
    last_wrote_at: null,
    tags: [],
  };
  it('requires blocked_since (nullable)', () => {
    expect(ContactRow.safeParse({ ...row, blocked_since: null }).success).toBe(true);
    expect(ContactRow.safeParse({ ...row, blocked_since: at }).success).toBe(true);
    expect(ContactRow.safeParse(row).success).toBe(false);
  });
});

describe('ThreadBroadcastItem', () => {
  const item = {
    type: 'broadcast',
    id: I,
    workspace_id: W,
    conversation_id: C,
    broadcast_id: B,
    broadcast_name: 'Test broadcast 1',
    text: 'Hello',
    launched_by: member,
    state: 'not_confirmed',
    position_at: at,
  };
  it('is a thread item kind', () => {
    expect(ThreadItem.parse(item)).toEqual(item);
    expect(ThreadBroadcastItem.safeParse({ ...item, state: 'failed' }).success).toBe(false);
  });
});

describe('live frames', () => {
  it('broadcast.changed carries ids and one of the five change kinds', () => {
    for (const change of ['draft', 'group', 'status', 'report', 'deleted']) {
      const frame = { type: 'broadcast.changed', v: 1, workspace_id: W, broadcast_id: B, change };
      expect(LiveFrame.parse(frame)).toEqual(frame);
    }
    expect(
      BroadcastChangedFrame.safeParse({
        type: 'broadcast.changed',
        v: 1,
        workspace_id: W,
        broadcast_id: B,
        change: 'renamed',
      }).success,
    ).toBe(false);
  });
  it('contact.changed gains reach', () => {
    const frame = {
      type: 'contact.changed',
      v: 1,
      workspace_id: W,
      contact_id: C,
      change: 'reach',
    };
    expect(ContactChangedFrame.parse(frame)).toEqual(frame);
    expect(ContactChangedFrame.safeParse({ ...frame, change: 'blocked' }).success).toBe(false);
  });
  it('conversation.changed carries a broadcast item only as created', () => {
    const frame = {
      type: 'conversation.changed',
      v: 1,
      workspace_id: W,
      conversation_id: C,
      item: { type: 'broadcast', id: I },
      change: 'created',
    };
    expect(LiveFrame.parse(frame)).toEqual(frame);
    expect(ConversationChangedFrame.safeParse({ ...frame, change: 'edited' }).success).toBe(false);
    expect(ConversationChangedFrame.safeParse({ ...frame, change: 'state' }).success).toBe(false);
  });
});

// Every `examples` value of the broadcasts contract (docs/features/broadcasts/contracts/openapi.yaml),
// copied verbatim with the schema it must parse through.
export const CONTRACT_EXAMPLES = [
  [
    '/broadcasts/get 200 \u2014 withBroadcasts',
    'BroadcastList',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      items: [
        {
          id: '01920000-0000-7000-8000-000000000502',
          name: 'Test broadcast 2',
          status: 'draft',
          audience_kind: 'tags',
          audience_size: 38,
          author: {
            account_id: '01920000-0000-7000-8000-0000000000b2',
            display_name: 'Test User 2',
          },
          last_changed_by: {
            account_id: '01920000-0000-7000-8000-0000000000b2',
            display_name: 'Test User 2',
          },
          last_changed_at: '2026-10-23T09:12:00Z',
          launched_at: null,
          ended_at: null,
        },
        {
          id: '01920000-0000-7000-8000-000000000501',
          name: 'Test broadcast 1',
          status: 'sending',
          audience_kind: 'tags',
          audience_size: 38,
          author: {
            account_id: '01920000-0000-7000-8000-0000000000b2',
            display_name: 'Test User 2',
          },
          last_changed_by: {
            account_id: '01920000-0000-7000-8000-0000000000b1',
            display_name: 'Test User',
          },
          last_changed_at: '2026-10-23T09:00:00Z',
          launched_at: '2026-10-23T09:00:00Z',
          ended_at: null,
        },
      ],
    },
  ],
  [
    '/broadcasts/get 200 \u2014 empty',
    'BroadcastList',
    { workspace_id: '01920000-0000-7000-8000-000000000001', items: [] },
  ],
  ['/broadcasts/post request \u2014 example', 'BroadcastCreate', { name: 'Test broadcast 1' }],
  [
    '/broadcasts/post 201 \u2014 example',
    'BroadcastDraft',
    {
      id: '01920000-0000-7000-8000-000000000503',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 1,
      name: 'Test broadcast 1',
      text: '',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T09:20:00Z',
      created_at: '2026-10-23T09:20:00Z',
      audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] },
      breakdown: {
        audience_size: 120,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 118 },
      },
    },
  ],
  [
    '/broadcasts/post 400 \u2014 nameTooLong',
    'BroadcastNameInvalidError',
    {
      error: {
        code: 'BROADCAST_NAME_INVALID',
        message: 'A name must be 1 to 80 characters',
        details: { field: 'name', min_length: 1, max_length: 80 },
      },
    },
  ],
  [
    '/broadcasts/post 400 \u2014 textTooLong',
    'BroadcastTextInvalidError',
    {
      error: {
        code: 'BROADCAST_TEXT_INVALID',
        message: 'The text must be 1 to 4096 characters as Telegram counts them',
        details: { field: 'text', min_length: 1, max_length: 4096, length: 4101 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/get 200 \u2014 draftTagAudience',
    'Broadcast',
    {
      id: '01920000-0000-7000-8000-000000000502',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 4,
      name: 'Test broadcast 2',
      text: 'New prices from Monday.',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T09:12:00Z',
      created_at: '2026-10-23T09:05:00Z',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [
          { tag_id: '01920000-0000-7000-8000-000000000302', name: 'VIP', kind: 'include' },
          { tag_id: '01920000-0000-7000-8000-000000000303', name: 'Staff', kind: 'exclude' },
        ],
        dropped_tags: [
          { tag_id: '01920000-0000-7000-8000-000000000399', name: 'Test tag', kind: 'include' },
        ],
      },
      breakdown: {
        audience_size: 38,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/get 200 \u2014 draftGroupNoBot',
    'Broadcast',
    {
      id: '01920000-0000-7000-8000-000000000504',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 2,
      name: 'Test broadcast 4',
      text: 'Hello',
      author: { account_id: '01920000-0000-7000-8000-0000000000b1', display_name: 'Test User' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T09:30:00Z',
      created_at: '2026-10-23T09:25:00Z',
      audience: { kind: 'group', size: 14 },
      breakdown: { audience_size: 14, reach: null },
    },
  ],
  [
    '/broadcasts/{broadcastId}/get 200 \u2014 sending',
    'Broadcast',
    {
      id: '01920000-0000-7000-8000-000000000501',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'sending',
      name: 'Test broadcast 1',
      text: 'New prices from Monday.',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b1',
        display_name: 'Test User',
      },
      last_changed_at: '2026-10-23T09:00:00Z',
      created_at: '2026-10-22T16:00:00Z',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [
          { tag_id: '01920000-0000-7000-8000-000000000302', name: 'VIP', kind: 'include' },
          { tag_id: '01920000-0000-7000-8000-000000000303', name: 'Staff', kind: 'exclude' },
        ],
      },
      launched_by: {
        account_id: '01920000-0000-7000-8000-0000000000b1',
        display_name: 'Test User',
      },
      launched_at: '2026-10-23T09:00:00Z',
      launch_breakdown: {
        audience_size: 38,
        blocked_count: 2,
        never_wrote_count: 0,
        recipient_count: 36,
      },
      stopped_by: null,
      stopped_at: null,
      ended_at: null,
      end_reason: null,
      totals: {
        waiting: 20,
        sending: 2,
        delivered: 12,
        blocked: 1,
        failed: 1,
        not_confirmed: 0,
        stopped: 0,
      },
      not_reached_count: 0,
    },
  ],
  [
    '/broadcasts/{broadcastId}/save/post request \u2014 example',
    'BroadcastFieldsSave',
    { expected_version: 3, text: 'New prices from Monday.' },
  ],
  [
    '/broadcasts/{broadcastId}/save/post 200 \u2014 example',
    'BroadcastDraft',
    {
      id: '01920000-0000-7000-8000-000000000502',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 4,
      name: 'Test broadcast 2',
      text: 'New prices from Monday.',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T09:12:00Z',
      created_at: '2026-10-23T09:05:00Z',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [{ tag_id: '01920000-0000-7000-8000-000000000302', name: 'VIP', kind: 'include' }],
        dropped_tags: [],
      },
      breakdown: {
        audience_size: 40,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 38 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/save/post 400 \u2014 emptyText',
    'BroadcastTextInvalidError',
    {
      error: {
        code: 'BROADCAST_TEXT_INVALID',
        message: 'The text must be 1 to 4096 characters as Telegram counts them',
        details: { field: 'text', min_length: 1, max_length: 4096, length: 0 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post request \u2014 tagAudience',
    'BroadcastAudienceSave',
    {
      expected_version: 2,
      kind: 'tags',
      mode: 'any',
      tag_ids: ['01920000-0000-7000-8000-000000000302'],
      exclude_tag_ids: ['01920000-0000-7000-8000-000000000303'],
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post request \u2014 switchFromGroup',
    'BroadcastAudienceSave',
    {
      expected_version: 5,
      kind: 'tags',
      mode: 'any',
      tag_ids: [],
      exclude_tag_ids: [],
      expected_group_size: 14,
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post request \u2014 toGroup',
    'BroadcastAudienceSave',
    { expected_version: 3, kind: 'group' },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 200 \u2014 example',
    'BroadcastDraft',
    {
      id: '01920000-0000-7000-8000-000000000502',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 3,
      name: 'Test broadcast 2',
      text: 'New prices from Monday.',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T09:10:00Z',
      created_at: '2026-10-23T09:05:00Z',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [
          { tag_id: '01920000-0000-7000-8000-000000000302', name: 'VIP', kind: 'include' },
          { tag_id: '01920000-0000-7000-8000-000000000303', name: 'Staff', kind: 'exclude' },
        ],
        dropped_tags: [],
      },
      breakdown: {
        audience_size: 38,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 400 \u2014 noneWithTags',
    'ErrorEnvelope',
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: '"No tags" cannot be combined with chosen or left-out tags',
        details: { field: 'tag_ids' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 400 \u2014 bothWays',
    'ErrorEnvelope',
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A tag cannot be both chosen and left out',
        details: { field: 'exclude_tag_ids' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 404 \u2014 tagGone',
    'TagNotFoundError',
    {
      error: {
        code: 'TAG_NOT_FOUND',
        message: 'This tag no longer exists',
        details: { tag_id: '01920000-0000-7000-8000-000000000399' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 404 \u2014 broadcastNotFound',
    'ErrorEnvelope',
    { error: { code: 'NOT_FOUND', message: 'Not found' } },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 409 \u2014 groupChanged',
    'BroadcastGroupChangedError',
    {
      error: {
        code: 'BROADCAST_GROUP_CHANGED',
        message: 'The group changed — it now holds 15 contacts',
        details: { group_size: 15 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/audience/post 409 \u2014 notADraft',
    'BroadcastNotADraftError',
    {
      error: {
        code: 'BROADCAST_NOT_A_DRAFT',
        message: 'This broadcast was launched and can no longer be changed',
        details: { broadcast_id: '01920000-0000-7000-8000-000000000502', status: 'sending' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/get 200 \u2014 example',
    'BroadcastGroupPage',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      broadcast_id: '01920000-0000-7000-8000-000000000504',
      size: 14,
      items: [
        {
          contact: {
            id: '01920000-0000-7000-8000-0000000000a1',
            first_name: 'Test',
            last_name: 'User',
            username: 'test_user_1',
            tags: [{ id: '01920000-0000-7000-8000-000000000304', name: 'Wholesale' }],
            blocked_since: '2026-10-20T11:00:00Z',
          },
          added_by: {
            account_id: '01920000-0000-7000-8000-0000000000b2',
            display_name: 'Test User 2',
          },
          added_at: '2026-10-23T09:31:00Z',
        },
      ],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/membership/get 200 \u2014 example',
    'BroadcastGroupMembership',
    {
      broadcast_id: '01920000-0000-7000-8000-000000000504',
      contact_ids: ['01920000-0000-7000-8000-0000000000a1'],
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/post request \u2014 example',
    'BroadcastGroupAdd',
    { contact_id: '01920000-0000-7000-8000-0000000000a1' },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/post 200 \u2014 added',
    'BroadcastGroupChange',
    { broadcast_id: '01920000-0000-7000-8000-000000000504', outcome: 'added', group_size: 2 },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/post 200 \u2014 alreadyThere',
    'BroadcastGroupChange',
    { broadcast_id: '01920000-0000-7000-8000-000000000504', outcome: 'unchanged', group_size: 2 },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/post 404 \u2014 example',
    'ErrorEnvelope',
    { error: { code: 'NOT_FOUND', message: 'Not found' } },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/{contactId}/remove/post 200 \u2014 example',
    'BroadcastGroupChange',
    { broadcast_id: '01920000-0000-7000-8000-000000000504', outcome: 'removed', group_size: 13 },
  ],
  [
    '/broadcasts/{broadcastId}/group/contacts/{contactId}/remove/post 409 \u2014 example',
    'BroadcastNotADraftError',
    {
      error: {
        code: 'BROADCAST_NOT_A_DRAFT',
        message: 'This broadcast was launched and can no longer be changed',
        details: { broadcast_id: '01920000-0000-7000-8000-000000000504', status: 'sending' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/matching/get 200 \u2014 example',
    'BroadcastGroupMatching',
    {
      broadcast_id: '01920000-0000-7000-8000-000000000504',
      matching_count: 14,
      already_in_group_count: 1,
      to_add_count: 13,
      can_add: 9986,
      missing_tag_ids: [],
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/matching/get 400 \u2014 example',
    'ErrorEnvelope',
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: '"No tags" cannot be combined with chosen tags',
        details: { field: 'tag' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/add-matching/post request \u2014 example',
    'BroadcastGroupAddMatching',
    {
      q: 'kyiv',
      mode: 'any',
      tag_ids: ['01920000-0000-7000-8000-000000000304'],
      expected_count: 13,
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/add-matching/post 200 \u2014 asCounted',
    'BroadcastGroupMatchingAdded',
    {
      broadcast_id: '01920000-0000-7000-8000-000000000504',
      expected_count: 13,
      added_count: 13,
      group_size: 14,
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/add-matching/post 200 \u2014 changedMeanwhile',
    'BroadcastGroupMatchingAdded',
    {
      broadcast_id: '01920000-0000-7000-8000-000000000504',
      expected_count: 13,
      added_count: 12,
      group_size: 13,
    },
  ],
  [
    '/broadcasts/{broadcastId}/group/add-matching/post 400 \u2014 example',
    'ErrorEnvelope',
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: '"No tags" cannot be combined with chosen tags',
        details: { field: 'tag_ids' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/delete/post 200 \u2014 example',
    'BroadcastDeleted',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      broadcast_id: '01920000-0000-7000-8000-000000000502',
    },
  ],
  [
    '/broadcasts/{broadcastId}/delete/post 403 \u2014 accessRemoved',
    'ErrorEnvelope',
    { error: { code: 'ACCESS_REMOVED', message: 'Your access to this workspace was removed' } },
  ],
  [
    '/broadcasts/{broadcastId}/delete/post 403 \u2014 notAuthor',
    'ErrorEnvelope',
    {
      error: { code: 'FORBIDDEN', message: 'A draft is deleted by its author or a business owner' },
    },
  ],
  [
    '/broadcasts/{broadcastId}/delete/post 409 \u2014 example',
    'BroadcastNotADraftError',
    {
      error: {
        code: 'BROADCAST_NOT_A_DRAFT',
        message: 'This broadcast was launched and can no longer be changed',
        details: { broadcast_id: '01920000-0000-7000-8000-000000000501', status: 'sent' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/duplicate/post request \u2014 draft',
    'BroadcastDuplicate',
    { audience: 'same' },
  ],
  [
    '/broadcasts/{broadcastId}/duplicate/post request \u2014 notReached',
    'BroadcastDuplicate',
    { audience: 'not_reached', include_not_confirmed: true },
  ],
  [
    '/broadcasts/{broadcastId}/duplicate/post 201 \u2014 example',
    'BroadcastDraft',
    {
      id: '01920000-0000-7000-8000-000000000505',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      status: 'draft',
      version: 1,
      name: 'Copy of Test broadcast 1',
      text: 'New prices from Monday.',
      author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
      last_changed_by: {
        account_id: '01920000-0000-7000-8000-0000000000b2',
        display_name: 'Test User 2',
      },
      last_changed_at: '2026-10-23T10:00:00Z',
      created_at: '2026-10-23T10:00:00Z',
      audience: { kind: 'group', size: 2 },
      breakdown: {
        audience_size: 2,
        reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 2 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/duplicate/post 400 \u2014 example',
    'ErrorEnvelope',
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: '"Same tags" needs a broadcast sent to a tag audience',
        details: { field: 'audience' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/duplicate/post 409 \u2014 example',
    'BroadcastNotEndedError',
    {
      error: {
        code: 'BROADCAST_NOT_ENDED',
        message: 'Available once the broadcast has ended',
        details: { broadcast_id: '01920000-0000-7000-8000-000000000501', status: 'sending' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch-confirmation/get 200 \u2014 example',
    'LaunchConfirmation',
    {
      broadcast_id: '01920000-0000-7000-8000-000000000502',
      version: 4,
      name: 'Test broadcast 2',
      text: 'New prices from Monday.',
      breakdown: { audience_size: 38, blocked_count: 2, never_wrote_count: 0, recipient_count: 36 },
      fingerprint: '9f2c4b0e7d1a6c3f5e8b2d4a6c1e3f5a7b9d0c2e4f6a8b1c3d5e7f9a0b2c4d6e',
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch/post request \u2014 example',
    'BroadcastLaunch',
    {
      expected_version: 4,
      fingerprint: '9f2c4b0e7d1a6c3f5e8b2d4a6c1e3f5a7b9d0c2e4f6a8b1c3d5e7f9a0b2c4d6e',
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch/post 200 \u2014 example',
    'BroadcastLaunched',
    {
      outcome: 'launched',
      broadcast: {
        id: '01920000-0000-7000-8000-000000000502',
        workspace_id: '01920000-0000-7000-8000-000000000001',
        status: 'sending',
        name: 'Test broadcast 2',
        text: 'New prices from Monday.',
        author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
        last_changed_by: {
          account_id: '01920000-0000-7000-8000-0000000000b1',
          display_name: 'Test User',
        },
        last_changed_at: '2026-10-23T10:05:00Z',
        created_at: '2026-10-23T09:05:00Z',
        audience: {
          kind: 'tags',
          mode: 'any',
          tags: [
            { tag_id: '01920000-0000-7000-8000-000000000302', name: 'VIP', kind: 'include' },
            { tag_id: '01920000-0000-7000-8000-000000000303', name: 'Staff', kind: 'exclude' },
          ],
        },
        launched_by: {
          account_id: '01920000-0000-7000-8000-0000000000b1',
          display_name: 'Test User',
        },
        launched_at: '2026-10-23T10:05:00Z',
        launch_breakdown: {
          audience_size: 38,
          blocked_count: 2,
          never_wrote_count: 0,
          recipient_count: 36,
        },
        stopped_by: null,
        stopped_at: null,
        ended_at: null,
        end_reason: null,
        totals: {
          waiting: 36,
          sending: 0,
          delivered: 0,
          blocked: 0,
          failed: 0,
          not_confirmed: 0,
          stopped: 0,
        },
        not_reached_count: 0,
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch/post 400 \u2014 example',
    'BroadcastTextInvalidError',
    {
      error: {
        code: 'BROADCAST_TEXT_INVALID',
        message: 'Write the text before launching',
        details: { field: 'text', min_length: 1, max_length: 4096, length: 0 },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch/post 409 \u2014 audienceChanged',
    'BroadcastAudienceChangedError',
    {
      error: {
        code: 'BROADCAST_AUDIENCE_CHANGED',
        message: 'The contacts this broadcast would reach changed — check and confirm again',
        details: {
          confirmation: {
            broadcast_id: '01920000-0000-7000-8000-000000000502',
            version: 4,
            name: 'Test broadcast 2',
            text: 'New prices from Monday.',
            breakdown: {
              audience_size: 38,
              blocked_count: 2,
              never_wrote_count: 0,
              recipient_count: 36,
            },
            fingerprint: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
          },
        },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/launch/post 409 \u2014 needsBot',
    'BroadcastNeedsWorkingBotError',
    {
      error: {
        code: 'BROADCAST_NEEDS_WORKING_BOT',
        message: 'Launching needs a working bot',
        details: { bot_state: 'needs_token' },
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/stop/post 200 \u2014 example',
    'BroadcastStopped',
    {
      outcome: 'stopped',
      broadcast: {
        id: '01920000-0000-7000-8000-000000000501',
        workspace_id: '01920000-0000-7000-8000-000000000001',
        status: 'stopped',
        name: 'Test broadcast 1',
        text: 'New prices from Monday.',
        author: { account_id: '01920000-0000-7000-8000-0000000000b2', display_name: 'Test User 2' },
        last_changed_by: {
          account_id: '01920000-0000-7000-8000-0000000000b1',
          display_name: 'Test User',
        },
        last_changed_at: '2026-10-23T09:03:00Z',
        created_at: '2026-10-22T16:00:00Z',
        audience: { kind: 'group' },
        launched_by: {
          account_id: '01920000-0000-7000-8000-0000000000b1',
          display_name: 'Test User',
        },
        launched_at: '2026-10-23T09:00:00Z',
        launch_breakdown: {
          audience_size: 3000,
          blocked_count: 0,
          never_wrote_count: 0,
          recipient_count: 3000,
        },
        stopped_by: {
          account_id: '01920000-0000-7000-8000-0000000000b1',
          display_name: 'Test User',
        },
        stopped_at: '2026-10-23T09:03:00Z',
        ended_at: '2026-10-23T09:03:00Z',
        end_reason: 'stopped',
        totals: {
          waiting: 0,
          sending: 2,
          delivered: 1190,
          blocked: 6,
          failed: 2,
          not_confirmed: 0,
          stopped: 1800,
        },
        not_reached_count: 1800,
      },
    },
  ],
  [
    '/broadcasts/{broadcastId}/recipients/get 200 \u2014 example',
    'BroadcastRecipientPage',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      broadcast_id: '01920000-0000-7000-8000-000000000501',
      state: null,
      items: [
        {
          id: '01920000-0000-7000-8000-000000000601',
          position: 1,
          contact: {
            id: '01920000-0000-7000-8000-0000000000a1',
            first_name: 'Test',
            last_name: 'User',
            username: 'test_user_1',
          },
          state: 'delivered',
          failure_reason: null,
          outcome_at: '2026-10-23T09:00:01Z',
        },
        {
          id: '01920000-0000-7000-8000-000000000602',
          position: 2,
          contact: {
            id: '01920000-0000-7000-8000-0000000000a2',
            first_name: 'Test User 2',
            last_name: null,
            username: null,
          },
          state: 'failed',
          failure_reason: 'account_gone',
          outcome_at: '2026-10-23T09:00:01Z',
        },
        {
          id: '01920000-0000-7000-8000-000000000603',
          position: 3,
          contact: {
            id: '01920000-0000-7000-8000-0000000000a3',
            first_name: 'Test User 3',
            last_name: null,
            username: 'test_user_3',
          },
          state: 'waiting',
          failure_reason: null,
          outcome_at: null,
        },
      ],
      has_prev: false,
      has_next: true,
      next_cursor: 'cG9zfDUw',
    },
  ],
  [
    '/inbox/conversations/{conversationId}/broadcast-items/{broadcastItemId}/get 200 \u2014 example',
    'ThreadBroadcastItem',
    {
      type: 'broadcast',
      id: '01920000-0000-7000-8000-000000000701',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      conversation_id: '01920000-0000-7000-8000-0000000000c1',
      broadcast_id: '01920000-0000-7000-8000-000000000501',
      broadcast_name: 'Test broadcast 1',
      text: 'New prices from Monday.',
      launched_by: {
        account_id: '01920000-0000-7000-8000-0000000000b1',
        display_name: 'Test User',
      },
      state: 'delivered',
      position_at: '2026-10-23T09:00:01Z',
    },
  ],
  [
    '/inbox/conversations/{conversationId}/items/get 200 \u2014 example',
    'ThreadPage',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      conversation_id: '01920000-0000-7000-8000-0000000000c1',
      items: [
        {
          type: 'broadcast',
          id: '01920000-0000-7000-8000-000000000701',
          workspace_id: '01920000-0000-7000-8000-000000000001',
          conversation_id: '01920000-0000-7000-8000-0000000000c1',
          broadcast_id: '01920000-0000-7000-8000-000000000501',
          broadcast_name: 'Test broadcast 1',
          text: 'New prices from Monday.',
          launched_by: {
            account_id: '01920000-0000-7000-8000-0000000000b1',
            display_name: 'Test User',
          },
          state: 'delivered',
          position_at: '2026-10-23T09:00:01Z',
        },
        {
          type: 'message',
          id: '01920000-0000-7000-8000-0000000000e2',
          workspace_id: '01920000-0000-7000-8000-000000000001',
          conversation_id: '01920000-0000-7000-8000-0000000000c1',
          kind: 'text',
          body: 'Is the VIP price for roses too?',
          sent_at: '2026-10-23T09:04:00Z',
          received_at: '2026-10-23T09:04:01Z',
          edited_at: null,
          attachment: null,
          location: null,
          shared_contact: null,
          poll: null,
        },
      ],
      has_prev: true,
      has_next: false,
      prev_cursor: 'MjAyNi0xMC0yM1QwOTowMDowMVp8YnwwMTky',
      next_cursor: null,
      read_through_at: '2026-10-23T09:04:01Z',
      newest_reply_id: null,
    },
  ],
  [
    '/contacts/get 200 \u2014 example',
    'ContactPage',
    {
      workspace_id: '01920000-0000-7000-8000-000000000001',
      filter: { q: null, mode: 'any', tag_ids: [] },
      items: [
        {
          id: '01920000-0000-7000-8000-0000000000a1',
          workspace_id: '01920000-0000-7000-8000-000000000001',
          first_name: 'Test',
          last_name: 'User',
          username: 'test_user_1',
          language_code: 'uk',
          first_wrote_at: '2026-09-02T08:14:00Z',
          last_wrote_at: '2026-10-19T09:58:11Z',
          tags: [{ id: '01920000-0000-7000-8000-000000000302', name: 'VIP' }],
          blocked_since: '2026-10-20T11:00:00Z',
        },
      ],
      has_prev: false,
      has_next: false,
      next_cursor: null,
      matching_count: 1,
      total_count: 1,
      missing_tag_ids: [],
    },
  ],
  [
    '/contacts/{contactId}/get 200 \u2014 example',
    'ContactProfile',
    {
      id: '01920000-0000-7000-8000-0000000000a1',
      workspace_id: '01920000-0000-7000-8000-000000000001',
      first_name: 'Test',
      last_name: 'User',
      username: 'test_user_1',
      language_code: 'uk',
      first_wrote_at: '2026-09-02T08:14:00Z',
      last_wrote_at: '2026-10-19T09:58:11Z',
      tags: [],
      blocked_since: '2026-10-20T11:00:00Z',
    },
  ],
  [
    'BroadcastNotFound \u2014 example',
    'ErrorEnvelope',
    { error: { code: 'NOT_FOUND', message: 'Not found' } },
  ],
  [
    'DraftSaveConflict \u2014 draftChanged',
    'BroadcastDraftChangedError',
    {
      error: {
        code: 'BROADCAST_DRAFT_CHANGED',
        message: 'A teammate changed this draft — check their version and apply your change again',
        details: {
          draft: {
            id: '01920000-0000-7000-8000-000000000502',
            workspace_id: '01920000-0000-7000-8000-000000000001',
            status: 'draft',
            version: 4,
            name: 'Test broadcast 2',
            text: 'New prices from Monday!',
            author: {
              account_id: '01920000-0000-7000-8000-0000000000b2',
              display_name: 'Test User 2',
            },
            last_changed_by: {
              account_id: '01920000-0000-7000-8000-0000000000b1',
              display_name: 'Test User',
            },
            last_changed_at: '2026-10-23T09:11:00Z',
            created_at: '2026-10-23T09:05:00Z',
            audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] },
            breakdown: {
              audience_size: 120,
              reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 118 },
            },
          },
        },
      },
    },
  ],
  [
    'DraftSaveConflict \u2014 notADraft',
    'BroadcastNotADraftError',
    {
      error: {
        code: 'BROADCAST_NOT_A_DRAFT',
        message: 'This broadcast was launched and can no longer be changed',
        details: { broadcast_id: '01920000-0000-7000-8000-000000000502', status: 'sending' },
      },
    },
  ],
  [
    'GroupWriteConflict \u2014 tooLarge',
    'BroadcastAudienceTooLargeError',
    {
      error: {
        code: 'BROADCAST_AUDIENCE_TOO_LARGE',
        message: "A broadcast's audience can hold at most 10 000 contacts — 10 more can be added",
        details: { limit: 10000, audience_size: 9990, can_add: 10 },
      },
    },
  ],
  [
    'BroadcastOwnerRouteForbidden \u2014 accessRemoved',
    'ErrorEnvelope',
    { error: { code: 'ACCESS_REMOVED', message: 'Your access to this workspace was removed' } },
  ],
  [
    'BroadcastOwnerRouteForbidden \u2014 ownerOnly',
    'ErrorEnvelope',
    {
      error: { code: 'OWNER_ONLY', message: 'Only a business owner launches and stops broadcasts' },
    },
  ],
  [
    'LaunchTextInvalid \u2014 example',
    'BroadcastTextInvalidError',
    {
      error: {
        code: 'BROADCAST_TEXT_INVALID',
        message: 'Write the text before launching',
        details: { field: 'text', min_length: 1, max_length: 4096, length: 0 },
      },
    },
  ],
  [
    'LaunchRefused \u2014 noBot',
    'BroadcastNeedsWorkingBotError',
    {
      error: {
        code: 'BROADCAST_NEEDS_WORKING_BOT',
        message: 'Launching needs a working bot — connect it in Settings — Bot',
        details: { bot_state: 'not_connected' },
      },
    },
  ],
  [
    'LaunchRefused \u2014 tooLarge',
    'BroadcastAudienceTooLargeError',
    {
      error: {
        code: 'BROADCAST_AUDIENCE_TOO_LARGE',
        message: "A broadcast's audience can hold at most 10 000 contacts",
        details: { limit: 10000, audience_size: 10420, can_add: 0 },
      },
    },
  ],
  [
    'LaunchRefused \u2014 nobodyReachable',
    'BroadcastNoReachableContactError',
    {
      error: {
        code: 'BROADCAST_NO_REACHABLE_CONTACT',
        message: 'This audience has no reachable contact',
        details: {
          breakdown: {
            audience_size: 3,
            blocked_count: 1,
            never_wrote_count: 2,
            recipient_count: 0,
          },
        },
      },
    },
  ],
  [
    'LaunchLimitReached \u2014 example',
    'BroadcastLaunchLimitReachedError',
    {
      error: {
        code: 'BROADCAST_LAUNCH_LIMIT_REACHED',
        message:
          'A workspace can launch at most 10 broadcasts in 24 hours — the next launch is possible at 14:20',
        details: { limit: 10, window_hours: 24, next_launch_at: '2026-10-24T14:20:00Z' },
      },
    },
  ],
] as const;
