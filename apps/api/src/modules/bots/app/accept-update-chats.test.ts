import { describe, expect, it } from 'vitest';
import { telegramMyChatMember, telegramUpdate } from '../../../test/fixtures/telegram.js';
import { createAcceptUpdate, type CaptureLog } from './accept-update.js';
import { fakeBotRepo, fakeContactsReach, fakeConversationsApi, fakeInterceptor } from './fakes.js';
import { at, botRow } from './harness.js';
import type { ChatEventsPort } from './ports.js';

const BOT = botRow().id;
const SECRET = 'stored-secret';
const EPOCH_S = Math.floor(at(0).getTime() / 1000);
const CODE = 'tgp_Ab12xyZ9';

function setup() {
  const bots = fakeBotRepo();
  bots.rows.push(botRow());
  const conversations = fakeConversationsApi();
  const interceptor = fakeInterceptor();
  const reach = fakeContactsReach();
  const events: { name: string; arg: Record<string, unknown> }[] = [];
  const record = (name: string) => async (arg: never) => {
    events.push({ name, arg: arg as Record<string, unknown> });
  };
  const chatEvents: ChatEventsPort = {
    onDestinationCode: record('onDestinationCode'),
    onChatMembership: record('onChatMembership'),
    onChatMigrated: record('onChatMigrated'),
    onChatRenamed: record('onChatRenamed'),
  };
  const lines: { fields: Record<string, unknown>; msg: string }[] = [];
  const log: CaptureLog = { info: (fields, msg) => lines.push({ fields, msg }) };
  const accept = createAcceptUpdate({ bots, conversations, interceptor, reach, chatEvents });
  return { conversations, interceptor, reach, events, lines, log, accept };
}

const post = (chatType: 'group' | 'supergroup' | 'channel', text: string) =>
  telegramUpdate({
    updateId: 11,
    messageId: 42,
    date: EPOCH_S + 10,
    chatId: -100123,
    chatType,
    text,
  });

describe('acceptUpdate — group and channel updates (AC-01, AC-02, AC-17)', () => {
  it('hands a /connect code to the port with the workspace and bot, before capture', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, post('group', `/connect ${CODE}`), h.log)).toBe(
      'destination_code',
    );
    expect(h.events).toEqual([
      {
        name: 'onDestinationCode',
        arg: expect.objectContaining({
          workspaceId: 'ws-a',
          telegramBotId: 100001n,
          chatId: -100123n,
          kind: 'group',
          messageId: 42n,
          code: CODE,
        }),
      },
    ]);
    expect(h.interceptor.calls).toEqual([]);
    expect(h.conversations.captured).toEqual([]);
  });

  it('a channel post with a code is a destination code', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, post('channel', CODE), h.log)).toBe(
      'destination_code',
    );
    expect(h.events[0]).toMatchObject({ name: 'onDestinationCode', arg: { kind: 'channel' } });
  });

  it('hands a group my_chat_member to onChatMembership, not to reach', async () => {
    const h = setup();
    const update = telegramMyChatMember({
      updateId: 12,
      fromId: 7,
      date: EPOCH_S + 5,
      status: 'member',
      chatType: 'supergroup',
    });
    expect(await h.accept.acceptUpdate(BOT, SECRET, update, h.log)).toBe('chat_membership');
    expect(h.events).toMatchObject([
      {
        name: 'onChatMembership',
        arg: { workspaceId: 'ws-a', telegramBotId: 100001n, kind: 'supergroup', canPost: true },
      },
    ]);
    expect(h.reach.changes).toEqual([]);
  });

  it('hands a migration and a rename to their port methods', async () => {
    const h = setup();
    const migrated = post('group', '') as unknown as { message: Record<string, unknown> };
    delete migrated.message.text;
    migrated.message.migrate_to_chat_id = -1009999;
    expect(await h.accept.acceptUpdate(BOT, SECRET, migrated, h.log)).toBe('chat_migrated');
    const renamed = post('channel', '') as unknown as { channel_post: Record<string, unknown> };
    delete renamed.channel_post.text;
    renamed.channel_post.new_chat_title = 'New';
    expect(await h.accept.acceptUpdate(BOT, SECRET, renamed, h.log)).toBe('chat_renamed');
    expect(h.events.map((e) => e.name)).toEqual(['onChatMigrated', 'onChatRenamed']);
    expect(h.events[0]!.arg).toMatchObject({ chatId: -100123n, newChatId: -1009999n });
    expect(h.events[1]!.arg).toMatchObject({ chatId: -100123n, title: 'New' });
  });

  it('an ordinary group message calls nothing and captures nothing', async () => {
    const h = setup();
    const outcome = await h.accept.acceptUpdate(BOT, SECRET, post('group', 'chatter'), h.log);
    expect(outcome.startsWith('ignored:')).toBe(true);
    expect(h.events).toEqual([]);
    expect(h.interceptor.calls).toEqual([]);
    expect(h.conversations.captured).toEqual([]);
  });

  it('/connect@another_bot is ignored (its username is not this bot)', async () => {
    const h = setup();
    const outcome = await h.accept.acceptUpdate(
      BOT,
      SECRET,
      post('group', `/connect@other_bot ${CODE}`),
      h.log,
    );
    expect(outcome.startsWith('ignored:')).toBe(true);
    expect(h.events).toEqual([]);
  });

  it('/connect@<this bot> is accepted using the stored bot username', async () => {
    const h = setup();
    expect(
      await h.accept.acceptUpdate(
        BOT,
        SECRET,
        post('group', `/connect@old_name_bot ${CODE}`),
        h.log,
      ),
    ).toBe('destination_code');
  });

  it('logs never carry the code, title or chat id', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, post('group', `/connect ${CODE}`), h.log);
    const printed = JSON.stringify(h.lines);
    expect(printed).not.toContain(CODE);
    expect(printed).not.toContain('Test Group');
    expect(printed).not.toContain('100123');
  });

  it('a private message is still captured (private path unchanged)', async () => {
    const h = setup();
    const update = telegramUpdate({ updateId: 13, messageId: 1, date: EPOCH_S + 10, text: 'Hi' });
    expect(await h.accept.acceptUpdate(BOT, SECRET, update, h.log)).toBe('captured');
    expect(h.events).toEqual([]);
  });
});
