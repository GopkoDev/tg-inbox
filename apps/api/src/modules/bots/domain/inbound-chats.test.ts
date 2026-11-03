import { describe, expect, it } from 'vitest';
import { telegramMyChatMember, telegramUpdate } from '../../../test/fixtures/telegram.js';
import { classifyUpdate } from './inbound.js';

const DATE = 1791712800;
const connectedAt = new Date(DATE * 1000);
const opts = { connectedAt, botUsername: 'acme_bot' };
const CODE = 'tgp_Ab12-xyZ_9';

const chatMsg = (chatType: 'group' | 'supergroup' | 'channel', text?: string) =>
  telegramUpdate({
    updateId: 1,
    messageId: 42,
    date: DATE,
    chatId: -100123,
    chatType,
    ...(text !== undefined && { text }),
  });

describe('classifyUpdate — destination_code (AC-01)', () => {
  it.each(['group', 'supergroup'] as const)('/connect with a code in a %s', (chatType) => {
    expect(classifyUpdate(chatMsg(chatType, `/connect ${CODE}`), opts)).toEqual({
      type: 'destination_code',
      chatId: -100123n,
      kind: chatType,
      title: 'Test Group',
      username: null,
      messageId: 42n,
      code: CODE,
    });
  });

  it('/connect@<our bot> with a code is ours', () => {
    expect(classifyUpdate(chatMsg('group', `/connect@acme_bot ${CODE}`), opts)).toMatchObject({
      type: 'destination_code',
      code: CODE,
    });
  });

  it('a bare /connect is ours even when the bot username is known', () => {
    expect(classifyUpdate(chatMsg('supergroup', `/connect ${CODE}`), opts).type).toBe(
      'destination_code',
    );
  });

  it('/connect@<another bot> is not ours', () => {
    expect(classifyUpdate(chatMsg('group', `/connect@other_bot ${CODE}`), opts).type).toBe(
      'ignore',
    );
  });

  it('a channel post whose text contains a code', () => {
    expect(classifyUpdate(chatMsg('channel', `here: ${CODE} thanks`), opts)).toEqual({
      type: 'destination_code',
      chatId: -100123n,
      kind: 'channel',
      title: 'Test Group',
      username: null,
      messageId: 42n,
      code: CODE,
    });
  });

  it.each([
    ['/connect without a code', 'group', '/connect'],
    ['/connect with a non-code argument', 'group', '/connect hello'],
    ['a plain group message with a code but no command', 'group', `hi ${CODE}`],
    ['a plain group message', 'supergroup', 'hello everyone'],
    ['a channel post without a code', 'channel', 'News today'],
  ] as const)('%s is ignored', (_n, chatType, text) => {
    expect(classifyUpdate(chatMsg(chatType, text), opts).type).toBe('ignore');
  });

  it('carries the chat username when the chat has one', () => {
    const update = chatMsg('channel', CODE) as unknown as {
      channel_post: { chat: Record<string, unknown> };
    };
    update.channel_post.chat.username = 'acme_news';
    expect(classifyUpdate(update, opts)).toMatchObject({ username: 'acme_news' });
  });
});

describe('classifyUpdate — chat_migrated / chat_renamed', () => {
  it('migrate_to_chat_id in a group', () => {
    const update = chatMsg('group') as unknown as { message: Record<string, unknown> };
    update.message.migrate_to_chat_id = -1009999;
    expect(classifyUpdate(update, opts)).toEqual({
      type: 'chat_migrated',
      chatId: -100123n,
      newChatId: -1009999n,
    });
  });

  it.each(['group', 'supergroup', 'channel'] as const)('new_chat_title in a %s', (chatType) => {
    const update = chatMsg(chatType) as unknown as Record<string, Record<string, unknown>>;
    const msg = update.message ?? update.channel_post!;
    delete msg.text;
    msg.new_chat_title = 'Renamed';
    expect(classifyUpdate(update, opts)).toEqual({
      type: 'chat_renamed',
      chatId: -100123n,
      title: 'Renamed',
    });
  });
});

describe('classifyUpdate — chat_membership (AC-02)', () => {
  const member = (
    chatType: 'group' | 'supergroup' | 'channel',
    newMember: Record<string, unknown>,
  ) => {
    const update = telegramMyChatMember({
      updateId: 5,
      fromId: 7,
      date: DATE + 3,
      status: 'member',
      chatType,
    }) as unknown as { my_chat_member: { new_chat_member: Record<string, unknown> } };
    update.my_chat_member.new_chat_member = {
      ...update.my_chat_member.new_chat_member,
      ...newMember,
    };
    return update;
  };

  it('a channel admin who may post', () => {
    expect(
      classifyUpdate(member('channel', { status: 'administrator', can_post_messages: true }), opts),
    ).toEqual({
      type: 'chat_membership',
      chatId: -1000000007n,
      kind: 'channel',
      title: 'Test Group',
      username: null,
      status: 'administrator',
      canPost: true,
      date: new Date((DATE + 3) * 1000),
    });
  });

  it('a channel admin without the right to post cannot post', () => {
    expect(
      classifyUpdate(
        member('channel', { status: 'administrator', can_post_messages: false }),
        opts,
      ),
    ).toMatchObject({ type: 'chat_membership', canPost: false });
  });

  it('a group member can post; a restricted one without can_send_messages cannot', () => {
    expect(classifyUpdate(member('group', { status: 'member' }), opts)).toMatchObject({
      type: 'chat_membership',
      kind: 'group',
      canPost: true,
    });
    expect(
      classifyUpdate(
        member('supergroup', { status: 'restricted', can_send_messages: false }),
        opts,
      ),
    ).toMatchObject({ type: 'chat_membership', kind: 'supergroup', canPost: false });
  });

  it('removed from a chat: canPost false', () => {
    expect(classifyUpdate(member('group', { status: 'kicked' }), opts)).toMatchObject({
      type: 'chat_membership',
      status: 'kicked',
      canPost: false,
    });
  });

  it('a private my_chat_member is still a reach change (unchanged)', () => {
    expect(
      classifyUpdate(
        telegramMyChatMember({ updateId: 6, fromId: 9, date: DATE, status: 'kicked' }),
        opts,
      ),
    ).toMatchObject({ type: 'reach', blocked: true });
  });
});

describe('classifyUpdate — nothing from a destination is captured (AC-17)', () => {
  it.each(['group', 'supergroup', 'channel'] as const)(
    'an ordinary %s message is ignored, never a capture',
    (chatType) => {
      const result = classifyUpdate(chatMsg(chatType, 'busy chatter'), opts);
      expect(result.type).toBe('ignore');
    },
  );

  it('an edited group message is ignored', () => {
    const update = {
      update_id: 3,
      edited_message: {
        ...(chatMsg('group', 'x') as unknown as { message: object }).message,
        edit_date: DATE + 1,
      },
    };
    expect(classifyUpdate(update, opts).type).toBe('ignore');
  });
});
