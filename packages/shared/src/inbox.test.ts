import { describe, expect, it } from 'vitest';
import {
  BotCannotReplyError,
  ConversationPage,
  Cursor,
  InboxBotStatus,
  LiveFrame,
  MediaUnavailableError,
  MessageKind,
  ReadMarkRequest,
  ReadState,
  ReplyBody,
  ReplyFailureReason,
  ReplyLimitReachedError,
  ReplyNotResendableError,
  ReplyResend,
  ReplySend,
  ReplyState,
  TeammateRepliedError,
  ThreadItem,
  ThreadPage,
  ThreadReply,
} from './inbox.js';

const W = '0198a000-0000-7000-8000-000000000001';
const C = '0198a000-0000-7000-8000-000000000002';
const M = '0198a000-0000-7000-8000-000000000003';
const R = '0198a000-0000-7000-8000-000000000004';
const K = '0198a000-0000-7000-8000-000000000005';
const A = '0198a000-0000-7000-8000-000000000006';
const T = '2026-10-18T10:20:12.000Z';

const author = { account_id: A, display_name: 'Olena' };
const bot = { workspace_id: W, state: 'needs_token', can_reply: false, receiving: false };

const reply = (over: Record<string, unknown> = {}) => ({
  type: 'reply',
  id: R,
  workspace_id: W,
  conversation_id: C,
  client_key: K,
  body: 'Hello',
  author,
  state: 'sent',
  failure_reason: null,
  position_at: T,
  sent_at: T,
  created_at: T,
  ...over,
});

const message = (over: Record<string, unknown> = {}) => ({
  type: 'message',
  id: M,
  workspace_id: W,
  conversation_id: C,
  kind: 'text',
  body: 'Hi',
  sent_at: T,
  received_at: T,
  edited_at: null,
  attachment: null,
  location: null,
  shared_contact: null,
  poll: null,
  ...over,
});

const conversation = {
  id: C,
  workspace_id: W,
  contact: { id: M, first_name: 'Ann', last_name: null, username: 'ann' },
  last_activity_at: T,
  last_item: { type: 'message', id: M, kind: 'photo', body: 'new bouquet?' },
  unread_count: 2,
  waiting_for_reply: true,
};

describe('Cursor', () => {
  it('accepts url-safe opaque cursors and rejects others', () => {
    expect(Cursor.safeParse('abc_DEF-123').success).toBe(true);
    expect(Cursor.safeParse('').success).toBe(false);
    expect(Cursor.safeParse('a'.repeat(201)).success).toBe(false);
    expect(Cursor.safeParse('has space').success).toBe(false);
  });
});

describe('ReplyBody (AC-07)', () => {
  it('accepts 1..4096 chars', () => {
    expect(ReplyBody.safeParse('x').success).toBe(true);
    expect(ReplyBody.safeParse('x'.repeat(4096)).success).toBe(true);
    expect(ReplyBody.safeParse('line1\nline2').success).toBe(true);
  });
  it('rejects a 4097-char body', () => {
    expect(ReplyBody.safeParse('x'.repeat(4097)).success).toBe(false);
  });
  it.each(['', '   ', '\n\n', ' \n\t '])('rejects blank body %j', (b) => {
    expect(ReplyBody.safeParse(b).success).toBe(false);
  });
});

describe('enums', () => {
  it('MessageKind has the 15 kinds', () => {
    expect(MessageKind.options).toHaveLength(15);
  });
  it('ReplyState and ReplyFailureReason', () => {
    expect([...ReplyState.options].sort()).toEqual(
      ['not_confirmed', 'not_delivered', 'sending', 'sent'].sort(),
    );
    expect(ReplyFailureReason.options).toHaveLength(7);
    expect(ReplyFailureReason.options).toContain('delivery_interrupted');
  });
});

describe('ThreadReply', () => {
  it('parses a sent reply and a not_delivered reply with a reason', () => {
    expect(ThreadReply.safeParse(reply()).success).toBe(true);
    expect(
      ThreadReply.safeParse(
        reply({ state: 'not_delivered', failure_reason: 'bot_not_working', sent_at: null }),
      ).success,
    ).toBe(true);
  });
  it('rejects a failure_reason with state sent', () => {
    expect(ThreadReply.safeParse(reply({ failure_reason: 'customer_blocked' })).success).toBe(
      false,
    );
  });
  it('rejects not_delivered without a failure_reason', () => {
    expect(ThreadReply.safeParse(reply({ state: 'not_delivered', sent_at: null })).success).toBe(
      false,
    );
  });
  it('rejects state sent without sent_at', () => {
    expect(ThreadReply.safeParse(reply({ sent_at: null })).success).toBe(false);
  });
  it('rejects unknown fields (additionalProperties: false)', () => {
    expect(ThreadReply.safeParse(reply({ extra: 1 })).success).toBe(false);
  });
});

describe('pages and items', () => {
  it('ThreadItem discriminates message and reply', () => {
    expect(ThreadItem.parse(message()).type).toBe('message');
    expect(ThreadItem.parse(reply()).type).toBe('reply');
    expect(ThreadItem.safeParse({ ...message(), type: 'other' }).success).toBe(false);
  });
  it('ThreadMessage carries location with venue, contact, poll and attachment', () => {
    const rich = message({
      kind: 'venue',
      location: { latitude: 50.4, longitude: 30.5, venue: { title: 'Shop', address: 'Main 1' } },
      shared_contact: { first_name: 'B', last_name: null, phone_number: '+380' },
      poll: { question: 'q', options: ['a', 'b'] },
      attachment: { file_name: null, mime_type: 'image/jpeg', file_size: 10 },
    });
    expect(ThreadItem.safeParse(rich).success).toBe(true);
    expect(
      ThreadItem.safeParse(message({ location: { latitude: 91, longitude: 0, venue: null } }))
        .success,
    ).toBe(false);
  });
  it('ConversationPage parses a list page with both last_item kinds', () => {
    const page = {
      workspace_id: W,
      items: [
        conversation,
        { ...conversation, last_item: { type: 'reply', id: R, body: 'Hello' } },
      ],
      has_prev: false,
      has_next: true,
      next_cursor: 'abc',
    };
    expect(ConversationPage.safeParse(page).success).toBe(true);
    expect(ConversationPage.safeParse({ ...page, next_cursor: null }).success).toBe(true);
    expect(ConversationPage.safeParse({ ...page, next_cursor: 'bad cursor' }).success).toBe(false);
  });
  it('ThreadPage has nullable read_through_at', () => {
    const page = {
      workspace_id: W,
      conversation_id: C,
      items: [message(), reply()],
      has_prev: false,
      has_next: false,
      prev_cursor: null,
      next_cursor: null,
      read_through_at: T,
    };
    expect(ThreadPage.safeParse(page).success).toBe(true);
    expect(ThreadPage.safeParse({ ...page, read_through_at: null }).success).toBe(true);
    const without: Record<string, unknown> = { ...page };
    delete without.read_through_at;
    expect(ThreadPage.safeParse(without).success).toBe(false);
  });
});

describe('requests', () => {
  it('ReplySend accepts null last_seen_reply_id and defaults confirm_teammate_reply', () => {
    const parsed = ReplySend.parse({ client_key: K, body: 'Hi', last_seen_reply_id: null });
    expect(parsed.confirm_teammate_reply).toBe(false);
  });
  it('ReplySend rejects blank and over-long bodies', () => {
    expect(
      ReplySend.safeParse({ client_key: K, body: '  ', last_seen_reply_id: null }).success,
    ).toBe(false);
    expect(
      ReplySend.safeParse({ client_key: K, body: 'x'.repeat(4097), last_seen_reply_id: null })
        .success,
    ).toBe(false);
  });
  it('ReplySend requires last_seen_reply_id and a uuid client_key', () => {
    expect(ReplySend.safeParse({ client_key: K, body: 'Hi' }).success).toBe(false);
    expect(
      ReplySend.safeParse({ client_key: 'nope', body: 'Hi', last_seen_reply_id: null }).success,
    ).toBe(false);
  });
  it('ReplyResend defaults confirm_duplicate_risk to false', () => {
    expect(ReplyResend.parse({}).confirm_duplicate_risk).toBe(false);
    expect(ReplyResend.parse({ confirm_duplicate_risk: true }).confirm_duplicate_risk).toBe(true);
  });
  it('ReadMarkRequest / ReadState', () => {
    expect(ReadMarkRequest.safeParse({ read_through_at: T }).success).toBe(true);
    expect(ReadMarkRequest.safeParse({ read_through_at: 'yesterday' }).success).toBe(false);
    expect(
      ReadState.safeParse({
        workspace_id: W,
        conversation_id: C,
        read_through_at: T,
        unread_count: 0,
      }).success,
    ).toBe(true);
  });
  it('InboxBotStatus (AC-13)', () => {
    expect(InboxBotStatus.safeParse(bot).success).toBe(true);
    expect(InboxBotStatus.safeParse({ ...bot, state: 'disconnected' }).success).toBe(false);
  });
});

describe('error envelopes', () => {
  const env = (code: string, details: unknown) => ({ error: { code, message: 'm', details } });
  it('BotCannotReplyError (AC-13)', () => {
    expect(BotCannotReplyError.safeParse(env('BOT_CANNOT_REPLY', { bot })).success).toBe(true);
    expect(BotCannotReplyError.safeParse(env('TEAMMATE_REPLIED', { bot })).success).toBe(false);
  });
  it('TeammateRepliedError (AC-16)', () => {
    const d = { reply: { id: R, author, position_at: T } };
    expect(TeammateRepliedError.safeParse(env('TEAMMATE_REPLIED', d)).success).toBe(true);
    expect(TeammateRepliedError.safeParse(env('TEAMMATE_REPLIED', {})).success).toBe(false);
  });
  it('ReplyNotResendableError (AC-11)', () => {
    expect(
      ReplyNotResendableError.safeParse(env('REPLY_NOT_RESENDABLE', { reply: reply() })).success,
    ).toBe(true);
  });
  it('ReplyLimitReachedError (AC-12b) is fixed at 30 per 60 s', () => {
    const ok = { limit: 30, window_seconds: 60, retry_at: T };
    expect(ReplyLimitReachedError.safeParse(env('REPLY_LIMIT_REACHED', ok)).success).toBe(true);
    expect(
      ReplyLimitReachedError.safeParse(env('REPLY_LIMIT_REACHED', { ...ok, limit: 10 })).success,
    ).toBe(false);
  });
  it('MediaUnavailableError (AC-05) takes the four reasons', () => {
    for (const reason of ['bot_not_connected', 'bot_not_working', 'file_too_large', 'file_gone']) {
      expect(MediaUnavailableError.safeParse(env('MEDIA_UNAVAILABLE', { reason })).success).toBe(
        true,
      );
    }
    expect(
      MediaUnavailableError.safeParse(env('MEDIA_UNAVAILABLE', { reason: 'nope' })).success,
    ).toBe(false);
  });
});

describe('LiveFrame', () => {
  it('parses conversation.changed, bot.changed and resync', () => {
    const base = { v: 1, workspace_id: W };
    expect(
      LiveFrame.safeParse({
        ...base,
        type: 'conversation.changed',
        conversation_id: C,
        item: { type: 'message', id: M },
        change: 'created',
      }).success,
    ).toBe(true);
    expect(
      LiveFrame.safeParse({
        ...base,
        type: 'conversation.changed',
        conversation_id: C,
        item: null,
        change: 'read',
      }).success,
    ).toBe(true);
    expect(LiveFrame.safeParse({ ...base, type: 'bot.changed' }).success).toBe(true);
    expect(LiveFrame.safeParse({ ...base, type: 'resync' }).success).toBe(true);
  });
  it('ignores unknown extra fields', () => {
    const r = LiveFrame.safeParse({ type: 'resync', v: 1, workspace_id: W, future: true });
    expect(r.success).toBe(true);
  });
  it('reports an unknown type as unparseable without throwing', () => {
    expect(() => LiveFrame.safeParse({ type: 'brand.new', v: 1, workspace_id: W })).not.toThrow();
    expect(LiveFrame.safeParse({ type: 'brand.new', v: 1, workspace_id: W }).success).toBe(false);
  });
  it('requires workspace_id and rejects a null item for a non-read change', () => {
    expect(LiveFrame.safeParse({ type: 'resync', v: 1 }).success).toBe(false);
    expect(
      LiveFrame.safeParse({
        type: 'conversation.changed',
        v: 1,
        workspace_id: W,
        conversation_id: C,
        item: null,
        change: 'created',
      }).success,
    ).toBe(false);
  });
});
