import { describe, expect, it } from 'vitest';
import {
  telegramEdit,
  telegramMyChatMember,
  telegramUpdate,
} from '../../../test/fixtures/telegram.js';
import { classifyUpdate, detectKind } from './inbound.js';

const DATE = 1791712800; // unix seconds
const connectedAt = new Date(DATE * 1000);
const opts = { connectedAt };

const message = (o: Partial<Parameters<typeof telegramUpdate>[0]> = {}) =>
  telegramUpdate({
    updateId: 900001,
    messageId: 42,
    date: DATE,
    chatId: 700001,
    text: 'Hello',
    ...o,
  });

describe('classifyUpdate — capture (AC-01, AC-09)', () => {
  it('captures a private text message from a human, normalised', () => {
    const update = message({ from: { last_name: 'Tester', language_code: 'uk' } });
    expect(classifyUpdate(update, opts)).toEqual({
      type: 'capture',
      message: {
        kind: 'text',
        body: 'Hello',
        sentAt: connectedAt,
        chatId: 700001n,
        messageId: 42n,
        sender: {
          telegramUserId: 700001n,
          firstName: 'Test User',
          lastName: 'Tester',
          username: 'test_user_700001',
          languageCode: 'uk',
        },
        raw: update.message,
      },
    });
  });

  it('fills absent profile fields with null', () => {
    const update = message();
    const from = update.message!.from as unknown as Record<string, unknown>;
    delete from.username;
    delete from.language_code;
    const result = classifyUpdate(update, opts);
    expect(result).toMatchObject({
      type: 'capture',
      message: { sender: { lastName: null, username: null, languageCode: null } },
    });
  });

  it('captures /start as text', () => {
    expect(classifyUpdate(message({ text: '/start' }), opts)).toMatchObject({
      type: 'capture',
      message: { kind: 'text', body: '/start' },
    });
  });

  it.each([
    'photo',
    'video',
    'animation',
    'voice',
    'audio',
    'video_note',
    'document',
    'sticker',
    'location',
    'venue',
    'contact',
    'poll',
    'dice',
  ])('marks a %s message with its kind', (kind) => {
    expect(classifyUpdate(message({ kind }), opts)).toMatchObject({
      type: 'capture',
      message: { kind },
    });
  });

  it('marks an unrecognised content type as other', () => {
    expect(classifyUpdate(message({ kind: 'other' }), opts)).toMatchObject({
      type: 'capture',
      message: { kind: 'other', body: null },
    });
  });

  it('keeps the caption as the body', () => {
    expect(classifyUpdate(message({ kind: 'photo', caption: 'Our bouquet' }), opts)).toMatchObject({
      type: 'capture',
      message: { kind: 'photo', body: 'Our bouquet' },
    });
  });

  it('leaves the body null for a photo without caption', () => {
    expect(classifyUpdate(message({ kind: 'photo' }), opts)).toMatchObject({
      message: { kind: 'photo', body: null },
    });
  });

  it('captures each album item as its own message', () => {
    const a = classifyUpdate(message({ kind: 'photo', messageId: 50, mediaGroupId: 'g' }), opts);
    const b = classifyUpdate(message({ kind: 'photo', messageId: 51, mediaGroupId: 'g' }), opts);
    expect(a).toMatchObject({ type: 'capture', message: { messageId: 50n } });
    expect(b).toMatchObject({ type: 'capture', message: { messageId: 51n } });
  });

  it('captures a message dated exactly at the capture epoch', () => {
    expect(classifyUpdate(message({ date: DATE }), opts).type).toBe('capture');
  });

  it('compares the epoch at Telegram second precision', () => {
    const epoch = new Date(DATE * 1000 + 999);
    expect(classifyUpdate(message({ date: DATE }), { connectedAt: epoch }).type).toBe('capture');
  });
});

describe('classifyUpdate — ignore (AC-12)', () => {
  it.each([
    ['group', { chatType: 'group' as const }, 'not_private'],
    ['supergroup', { chatType: 'supergroup' as const }, 'not_private'],
    ['channel', { chatType: 'channel' as const }, 'unsupported_update'],
    ['bot sender', { fromIsBot: true }, 'bot_sender'],
    ['business message', { businessConnectionId: 'bc-1' }, 'business'],
    ['message before the capture epoch', { date: DATE - 1 }, 'before_epoch'],
  ])('ignores a %s', (_name, o, reason) => {
    expect(classifyUpdate(message(o), opts)).toEqual({ type: 'ignore', reason });
  });

  it('ignores a group message from a bot as not private', () => {
    expect(classifyUpdate(message({ chatType: 'group', fromIsBot: true }), opts)).toEqual({
      type: 'ignore',
      reason: 'not_private',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an object without update_id', { message: {} }],
    ['a message without chat', { update_id: 1, message: { message_id: 1, date: DATE } }],
    [
      'a message with a non-numeric id',
      { update_id: 1, message: { message_id: 'x', date: DATE, chat: { id: 1, type: 'private' } } },
    ],
    [
      'a private message without sender',
      { update_id: 1, message: { message_id: 1, date: DATE, chat: { id: 1, type: 'private' } } },
    ],
  ])('ignores %s as malformed', (_name, body) => {
    expect(classifyUpdate(body, opts)).toEqual({ type: 'ignore', reason: 'malformed' });
  });

  it('ignores update types outside allowed_updates', () => {
    expect(classifyUpdate({ update_id: 1, callback_query: { id: 'q' } }, opts)).toEqual({
      type: 'ignore',
      reason: 'unsupported_update',
    });
  });
});

describe('classifyUpdate — edits (AC-10, AC-09 live location)', () => {
  it('turns an edited text into an edit with its edit time and update id', () => {
    const edit = telegramEdit({
      updateId: 900005,
      messageId: 42,
      chatId: 700001,
      date: DATE,
      editDate: DATE + 60,
      text: 'Fixed',
    });
    expect(classifyUpdate(edit, opts)).toEqual({
      type: 'edit',
      edit: {
        chatId: 700001n,
        messageId: 42n,
        body: 'Fixed',
        editedAt: new Date((DATE + 60) * 1000),
        updateId: 900005n,
        raw: (edit as unknown as { edited_message: Record<string, unknown> }).edited_message,
      },
      sender: {
        telegramUserId: 700001n,
        firstName: 'Test User',
        lastName: null,
        username: 'test_user_700001',
        languageCode: 'en',
      },
    });
  });

  it('uses the caption of an edited media message', () => {
    const edit = telegramEdit({
      updateId: 7,
      messageId: 43,
      date: DATE,
      editDate: DATE + 1,
      kind: 'photo',
      caption: 'New caption',
    });
    expect(classifyUpdate(edit, opts)).toMatchObject({
      type: 'edit',
      edit: { body: 'New caption' },
    });
  });

  it('ignores a live-location update (no text, no caption)', () => {
    const live = telegramEdit({
      updateId: 8,
      messageId: 44,
      date: DATE,
      editDate: DATE + 30,
      liveLocation: true,
    });
    expect(classifyUpdate(live, opts)).toEqual({ type: 'ignore', reason: 'no_text' });
  });

  it('applies the same filter to edits', () => {
    const group = telegramEdit({
      updateId: 9,
      messageId: 45,
      date: DATE,
      editDate: DATE + 1,
      chatType: 'group',
      text: 'x',
    });
    expect(classifyUpdate(group, opts)).toEqual({ type: 'ignore', reason: 'not_private' });
    const business = telegramEdit({
      updateId: 10,
      messageId: 46,
      date: DATE,
      editDate: DATE + 1,
      businessConnectionId: 'bc',
      text: 'x',
    });
    expect(classifyUpdate(business, opts)).toEqual({ type: 'ignore', reason: 'business' });
  });

  it('applies an edit that removes a caption: the body becomes null (AC-10)', () => {
    const edit = telegramEdit({
      updateId: 12,
      messageId: 48,
      date: DATE,
      editDate: DATE + 5,
      kind: 'photo',
    });
    expect(classifyUpdate(edit, opts)).toMatchObject({
      type: 'edit',
      edit: { messageId: 48n, body: null },
    });
  });

  it('an edit made after connecting again applies to a message captured before (AC-10, AC-19)', () => {
    const edit = telegramEdit({
      updateId: 14,
      messageId: 50,
      date: DATE - 86_400,
      editDate: DATE + 10,
      text: 'Edited after reconnect',
    });
    expect(classifyUpdate(edit, opts)).toMatchObject({
      type: 'edit',
      edit: { body: 'Edited after reconnect' },
    });
  });

  it('an edit made before the capture epoch is ignored', () => {
    const edit = telegramEdit({
      updateId: 15,
      messageId: 51,
      date: DATE - 86_400,
      editDate: DATE - 1,
      text: 'Edited while disconnected',
    });
    expect(classifyUpdate(edit, opts)).toEqual({ type: 'ignore', reason: 'before_epoch' });
  });

  it('treats an edit without edit_date as malformed', () => {
    const edit = telegramEdit({
      updateId: 11,
      messageId: 47,
      date: DATE,
      editDate: DATE + 1,
      text: 'x',
    });
    delete (edit.edited_message as unknown as Record<string, unknown>).edit_date;
    expect(classifyUpdate(edit, opts)).toEqual({ type: 'ignore', reason: 'malformed' });
  });
});

describe('detectKind', () => {
  it('prefers venue over its twin location and animation over its twin document', () => {
    expect(detectKind({ venue: {}, location: {} })).toBe('venue');
    expect(detectKind({ animation: {}, document: {} })).toBe('animation');
  });

  it('falls back to other', () => {
    expect(detectKind({ giveaway: {} })).toBe('other');
  });
});

describe('classifyUpdate — my_chat_member blocks (ADR-0003, AC-14)', () => {
  const member = (o: Partial<Parameters<typeof telegramMyChatMember>[0]> = {}) =>
    telegramMyChatMember({
      updateId: 900010,
      fromId: 700001,
      date: DATE + 30,
      status: 'kicked',
      ...o,
    });

  it('a private kicked is a block of the sender at the update date', () => {
    expect(classifyUpdate(member(), opts)).toEqual({
      type: 'reach',
      telegramUserId: 700001n,
      blocked: true,
      at: new Date((DATE + 30) * 1000),
    });
  });

  it('a private member is an unblock', () => {
    expect(classifyUpdate(member({ status: 'member' }), opts)).toEqual({
      type: 'reach',
      telegramUserId: 700001n,
      blocked: false,
      at: new Date((DATE + 30) * 1000),
    });
  });

  it('is a reach fact even when dated before the capture epoch (the newest fact wins later)', () => {
    expect(classifyUpdate(member({ date: DATE - 3600 }), opts)).toMatchObject({
      type: 'reach',
      blocked: true,
    });
  });

  it.each(['group', 'supergroup', 'channel'] as const)('ignores a %s chat', (chatType) => {
    expect(classifyUpdate(member({ chatType }), opts)).toEqual({
      type: 'ignore',
      reason: 'not_private',
    });
  });

  it.each(['administrator', 'left', 'restricted', 'creator'])('ignores the status %s', (status) => {
    expect(classifyUpdate(member({ status }), opts)).toEqual({
      type: 'ignore',
      reason: 'unsupported_status',
    });
  });

  it.each([
    [
      'no chat',
      {
        update_id: 1,
        my_chat_member: { date: DATE, from: { id: 1 }, new_chat_member: { status: 'kicked' } },
      },
    ],
    [
      'no sender',
      {
        update_id: 1,
        my_chat_member: {
          date: DATE,
          chat: { id: 1, type: 'private' },
          new_chat_member: { status: 'kicked' },
        },
      },
    ],
    [
      'no date',
      {
        update_id: 1,
        my_chat_member: {
          chat: { id: 1, type: 'private' },
          from: { id: 1 },
          new_chat_member: { status: 'kicked' },
        },
      },
    ],
    [
      'no new member',
      {
        update_id: 1,
        my_chat_member: { date: DATE, chat: { id: 1, type: 'private' }, from: { id: 1 } },
      },
    ],
    ['a non-object', { update_id: 1, my_chat_member: 'x' }],
  ])('ignores %s as malformed', (_name, body) => {
    expect(classifyUpdate(body, opts)).toEqual({ type: 'ignore', reason: 'malformed' });
  });
});
