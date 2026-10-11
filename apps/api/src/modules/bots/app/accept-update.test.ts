import { describe, expect, it } from 'vitest';
import { telegramEdit, telegramUpdate } from '../../../test/fixtures/telegram.js';
import { createAcceptUpdate, type CaptureLog } from './accept-update.js';
import { fakeBotRepo, fakeConversationsApi } from './fakes.js';
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
  const accept = createAcceptUpdate({ bots, conversations });
  return { bots, conversations, lines, log, accept };
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
});
