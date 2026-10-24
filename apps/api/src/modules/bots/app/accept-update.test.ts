import { describe, expect, it } from 'vitest';
import {
  telegramEdit,
  telegramMyChatMember,
  telegramUpdate,
} from '../../../test/fixtures/telegram.js';
import { createAcceptUpdate, type CaptureLog } from './accept-update.js';
import { fakeBotRepo, fakeContactsReach, fakeConversationsApi, fakeInterceptor } from './fakes.js';
import { at, botRow } from './harness.js';

const BOT = botRow().id;
const SECRET = 'stored-secret';
// Capture epoch at(0) = 2026-10-11T10:00:00Z; Telegram dates are seconds.
const EPOCH_S = Math.floor(at(0).getTime() / 1000);

function setup(rows = [botRow()]) {
  const bots = fakeBotRepo();
  bots.rows.push(...rows);
  const conversations = fakeConversationsApi();
  const lines: { fields: Record<string, unknown>; msg: string }[] = [];
  const log: CaptureLog = { info: (fields, msg) => lines.push({ fields, msg }) };
  const interceptor = fakeInterceptor();
  const reach = fakeContactsReach();
  const accept = createAcceptUpdate({ bots, conversations, interceptor, reach });
  return { bots, conversations, interceptor, reach, lines, log, accept };
}

const update = (o: Partial<Parameters<typeof telegramUpdate>[0]> = {}) =>
  telegramUpdate({ updateId: 900001, messageId: 42, date: EPOCH_S + 10, text: 'Hi', ...o });

describe('acceptUpdate', () => {
  it('captures a private message for the bot workspace (AC-07)', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).toBe('captured');
    expect(h.conversations.captured).toHaveLength(1);
    expect(h.conversations.captured[0]).toMatchObject({
      workspaceId: 'ws-a',
      message: { kind: 'text', body: 'Hi', chatId: 700001n, messageId: 42n },
    });
  });

  it('hands capture the Telegram id of the bot the message came to (ADR-0002)', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, update(), h.log);
    expect(h.conversations.captured[0]!.message.telegramBotId).toBe(100001n);
  });

  it('a redelivery is already_present (AC-11)', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, update(), h.log);
    expect(await h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).toBe('already_present');
  });

  it('keeps the kind of a non-text message (AC-09)', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, update({ kind: 'voice' }), h.log);
    expect(h.conversations.captured[0]!.message.kind).toBe('voice');
  });

  it('applies an edit (AC-10)', async () => {
    const h = setup();
    const edit = telegramEdit({
      updateId: 900002,
      messageId: 42,
      date: EPOCH_S + 10,
      editDate: EPOCH_S + 70,
      text: 'Fixed',
    });
    expect(await h.accept.acceptUpdate(BOT, SECRET, edit, h.log)).toBe('edited');
    expect(h.conversations.edits[0]).toMatchObject({
      workspaceId: 'ws-a',
      edit: { body: 'Fixed', messageId: 42n, updateId: 900002n },
    });
  });

  it.each([
    ['a wrong secret', BOT, 'wrong'],
    ['no secret', BOT, undefined],
    ['an unknown bot id', '0199a000-0000-7000-8000-00000000ffff', SECRET],
    ['a non-UUID bot id', 'not-a-uuid', SECRET],
  ])('%s → unauthorized, nothing captured (AC-14)', async (_case, botId, secret) => {
    const h = setup();
    expect(await h.accept.acceptUpdate(botId, secret, update(), h.log)).toBe('unauthorized');
    expect(h.conversations.captured).toHaveLength(0);
    expect(h.lines.at(-1)!.fields).toEqual({ botId, outcome: 'unauthorized' });
  });

  it('the secret of bot A sent to bot B is unauthorized', async () => {
    const b = botRow({
      id: '0199a000-0000-7000-8000-000000000002',
      workspaceId: 'ws-b',
      telegramBotId: 2n,
      webhookSecret: 'secret-b',
    });
    const h = setup([botRow(), b]);
    expect(await h.accept.acceptUpdate(b.id, SECRET, update(), h.log)).toBe('unauthorized');
    expect(h.conversations.captured).toHaveLength(0);
  });

  it.each([
    ['a group message', { chatType: 'group' as const }, 'not_private'],
    ['a bot sender', { fromIsBot: true }, 'bot_sender'],
    ['a business message', { businessConnectionId: 'bc1' }, 'business'],
    ['a message before the capture epoch', { date: EPOCH_S - 1 }, 'before_epoch'],
  ])('%s → ignored (AC-12)', async (_case, o, reason) => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, update(o), h.log)).toBe(`ignored:${reason}`);
    expect(h.conversations.captured).toHaveLength(0);
  });

  it.each([
    ['not an object', 'nope'],
    ['no update_id', { message: {} }],
  ])('a body that is %s → ignored:malformed', async (_case, body) => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, body, h.log)).toBe('ignored:malformed');
  });

  it.each(['needs_token', 'taken_over'] as const)(
    'a %s bot with the right secret still captures',
    async (state) => {
      const h = setup([botRow({ state })]);
      expect(await h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).toBe('captured');
    },
  );

  it('logs carry bot id, workspace id, update id and outcome only — never text, token or secret', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, update({ text: 'very private words' }), h.log);
    await h.accept.acceptUpdate(BOT, SECRET, update({ chatType: 'group', updateId: 7 }), h.log);
    expect(h.lines.map((l) => l.fields)).toEqual([
      { botId: BOT, workspaceId: 'ws-a', updateId: 900001, outcome: 'captured' },
      {
        botId: BOT,
        workspaceId: 'ws-a',
        updateId: 7,
        outcome: 'ignored',
        reason: 'not_private',
      },
    ]);
    const printed = JSON.stringify(h.lines);
    expect(printed).not.toContain('very private words');
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain(botRow().token!);
  });

  it('a database error propagates (the route answers 500, Telegram redelivers)', async () => {
    const h = setup();
    h.conversations.captureInbound = async () => {
      throw new Error('db down');
    };
    await expect(h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).rejects.toThrow('db down');
  });

  describe('the inbound interceptor (ADR-0003, AC-04, AC-11)', () => {
    it('asks about every private human message before capturing, with the bot and the sender', async () => {
      const h = setup();
      await h.accept.acceptUpdate(BOT, SECRET, update({ text: 'Hi', fromId: 770001 }), h.log);
      expect(h.interceptor.calls).toEqual([
        {
          workspaceId: 'ws-a',
          telegramBotId: botRow().telegramBotId,
          from: {
            telegramUserId: 770001n,
            firstName: 'Test User',
            lastName: null,
            username: 'test_user_770001',
            languageCode: 'en',
          },
          kind: 'text',
          text: 'Hi',
          edited: false,
        },
      ]);
      expect(h.conversations.captured).toHaveLength(1);
    });

    it('a consumed message is not captured and the webhook still answers normally', async () => {
      const h = setup();
      h.interceptor.answer = 'consumed';
      expect(await h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).toBe('consumed');
      expect(h.conversations.captured).toHaveLength(0);
      expect(h.lines.at(-1)!.fields).toMatchObject({ outcome: 'consumed' });
    });

    it('a consumed edit is not applied, and the interceptor sees the editor and the caption', async () => {
      const h = setup();
      h.interceptor.answer = 'consumed';
      const edit = telegramEdit({
        updateId: 900003,
        messageId: 42,
        date: EPOCH_S + 10,
        editDate: EPOCH_S + 70,
        kind: 'photo',
        caption: 'new caption',
        fromId: 770002,
      });
      expect(await h.accept.acceptUpdate(BOT, SECRET, edit, h.log)).toBe('consumed');
      expect(h.conversations.edits).toHaveLength(0);
      expect(h.interceptor.calls[0]).toMatchObject({
        from: { telegramUserId: 770002n },
        kind: 'photo',
        text: 'new caption',
        edited: true,
      });
    });

    it('is not asked about ignored updates (group, bot sender, before the epoch)', async () => {
      const h = setup();
      await h.accept.acceptUpdate(BOT, SECRET, update({ chatType: 'group' }), h.log);
      await h.accept.acceptUpdate(BOT, SECRET, update({ fromIsBot: true }), h.log);
      await h.accept.acceptUpdate(BOT, SECRET, update({ date: EPOCH_S - 100 }), h.log);
      expect(h.interceptor.calls).toEqual([]);
    });

    it('a failing interceptor propagates: nothing captured, Telegram redelivers', async () => {
      const h = setup();
      h.interceptor.fail = true;
      await expect(h.accept.acceptUpdate(BOT, SECRET, update(), h.log)).rejects.toThrow();
      expect(h.conversations.captured).toHaveLength(0);
    });
  });
});

describe('acceptUpdate — my_chat_member blocks (ADR-0003, AC-14)', () => {
  const blockUpdate = (status: string, o: { chatType?: 'private' | 'group' } = {}) =>
    telegramMyChatMember({ updateId: 900020, fromId: 700001, date: EPOCH_S + 30, status, ...o });

  it('a private kicked records a block for this bot, before the interceptor and capture', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, blockUpdate('kicked'), h.log)).toBe('reach');
    expect(h.reach.changes).toEqual([
      {
        workspaceId: 'ws-a',
        telegramBotId: 100001n,
        telegramUserId: 700001n,
        blocked: true,
        at: new Date((EPOCH_S + 30) * 1000),
      },
    ]);
    // Never a message: no interceptor call, no capture, no edit.
    expect(h.interceptor.calls).toEqual([]);
    expect(h.conversations.captured).toEqual([]);
    expect(h.conversations.edits).toEqual([]);
  });

  it('a private member records an unblock', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, SECRET, blockUpdate('member'), h.log)).toBe('reach');
    expect(h.reach.changes).toMatchObject([{ blocked: false, telegramUserId: 700001n }]);
    expect(h.interceptor.calls).toEqual([]);
  });

  it('a group my_chat_member is ignored and records nothing', async () => {
    const h = setup();
    expect(
      await h.accept.acceptUpdate(BOT, SECRET, blockUpdate('kicked', { chatType: 'group' }), h.log),
    ).toBe('ignored:not_private');
    expect(h.reach.changes).toEqual([]);
    expect(h.interceptor.calls).toEqual([]);
  });

  it('logs ids and the outcome only — never the user id', async () => {
    const h = setup();
    await h.accept.acceptUpdate(BOT, SECRET, blockUpdate('kicked'), h.log);
    const line = JSON.stringify(h.lines.at(-1));
    expect(h.lines.at(-1)!.fields).toMatchObject({
      botId: BOT,
      workspaceId: 'ws-a',
      outcome: 'reach',
    });
    expect(line).not.toContain('700001');
  });

  it('a wrong secret records nothing', async () => {
    const h = setup();
    expect(await h.accept.acceptUpdate(BOT, 'wrong', blockUpdate('kicked'), h.log)).toBe(
      'unauthorized',
    );
    expect(h.reach.changes).toEqual([]);
  });

  it('a failing contacts write propagates (Telegram redelivers)', async () => {
    const h = setup();
    h.reach.fail = true;
    await expect(
      h.accept.acceptUpdate(BOT, SECRET, blockUpdate('kicked'), h.log),
    ).rejects.toThrow();
  });
});
