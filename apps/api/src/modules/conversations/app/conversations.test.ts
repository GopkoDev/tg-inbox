import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { fakeContactRepo, fakeReachRepo, fakeReachSignals } from '../../contacts/app/fakes.js';
import {
  createConversations,
  type InboundEdit,
  type InboundMessage,
  type Transaction,
} from './conversations.js';
import {
  fakeActivityRepo,
  fakeConversationRepo,
  fakeConversationSignals,
  fakeMessageRepo,
} from './fakes.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

const message = (o: Partial<InboundMessage> = {}): InboundMessage => ({
  chatId: 700001n,
  messageId: 1n,
  kind: 'text',
  body: 'Hello',
  sentAt: at(1),
  telegramBotId: 9401n,
  sender: {
    telegramUserId: 700001n,
    firstName: 'Olena',
    lastName: null,
    username: 'olena',
    languageCode: 'uk',
  },
  raw: { message_id: 1, text: 'Hello' },
  ...o,
});

const edit = (o: Partial<InboundEdit> = {}): InboundEdit => ({
  chatId: 700001n,
  messageId: 1n,
  body: 'Fixed',
  editedAt: at(60),
  updateId: 10n,
  raw: { message_id: 1, text: 'Fixed', edit_date: 60 },
  ...o,
});

function setup() {
  const clock = fixedClock(at(100));
  const contactRepo = fakeContactRepo();
  const contacts = createContacts({
    repo: contactRepo,
    reach: fakeReachRepo(),
    signals: fakeReachSignals(),
    clock,
  });
  const conversations = fakeConversationRepo();
  const messages = fakeMessageRepo();
  const signals = fakeConversationSignals();
  const activities = fakeActivityRepo();
  const tx = { marker: 'tx' } as never;
  const transaction = vi.fn(<T>(fn: (t: never) => Promise<T>) => fn(tx));
  const useCases = createConversations({
    transaction: transaction as unknown as Transaction,
    conversations,
    messages,
    activities,
    contacts,
    signals,
    clock,
  });
  return {
    activities,
    clock,
    contactRepo,
    conversations,
    messages,
    signals,
    transaction,
    tx,
    useCases,
  };
}

describe('conversations use cases', () => {
  it('a first message creates the contact, the conversation and the message (AC-07)', async () => {
    const { contactRepo, conversations, messages, useCases, transaction } = setup();
    expect(await useCases.captureInbound('ws-a', message())).toBe('captured');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(contactRepo.rows).toMatchObject([
      { workspaceId: 'ws-a', telegramUserId: 700001n, firstName: 'Olena', username: 'olena' },
    ]);
    expect(conversations.rows).toMatchObject([
      { workspaceId: 'ws-a', contactId: contactRepo.rows[0]!.id, telegramChatId: 700001n },
    ]);
    expect(messages.rows).toEqual([
      {
        id: expect.any(String),
        workspaceId: 'ws-a',
        conversationId: conversations.rows[0]!.id,
        telegramMessageId: 1n,
        kind: 'text',
        body: 'Hello',
        telegramMessage: { message_id: 1, text: 'Hello' },
        sentAt: at(1),
        receivedAt: at(100),
        editedAt: null,
        editUpdateId: null,
      },
    ]);
  });

  it('passes the one transaction handle to every write', async () => {
    const tx = { marker: 'tx' } as never;
    const contacts = { upsertFromProfile: vi.fn(async () => ({ contactId: 'c1', created: true })) };
    const conversations = fakeConversationRepo();
    const messages = fakeMessageRepo();
    const upsert = vi.spyOn(conversations, 'upsert');
    const insert = vi.spyOn(messages, 'insertOnce');
    const useCases = createConversations({
      transaction: (fn) => fn(tx),
      conversations,
      messages,
      activities: fakeActivityRepo(),
      contacts: contacts as never,
      signals: fakeConversationSignals(),
      clock: fixedClock(at(100)),
    });
    await useCases.captureInbound('ws-a', message());
    expect(contacts.upsertFromProfile).toHaveBeenCalledWith(
      'ws-a',
      message().sender,
      at(1),
      9401n,
      tx,
    );
    expect(upsert.mock.calls[0]![3]).toBe(tx);
    expect(insert.mock.calls[0]![3]).toBe(tx);
  });

  it('a later message joins the conversation and refreshes the profile (AC-08, AC-19)', async () => {
    const { contactRepo, conversations, messages, useCases } = setup();
    await useCases.captureInbound('ws-a', message());
    await useCases.captureInbound(
      'ws-a',
      message({
        messageId: 2n,
        sentAt: at(2),
        sender: { ...message().sender, firstName: 'Olena K', username: 'olena_k' },
      }),
    );
    expect(contactRepo.rows).toHaveLength(1);
    expect(contactRepo.rows[0]).toMatchObject({ firstName: 'Olena K', username: 'olena_k' });
    expect(conversations.rows).toHaveLength(1);
    expect(messages.rows.map((m) => m.telegramMessageId)).toEqual([1n, 2n]);
  });

  describe('the waiting period (AC-07, AC-08)', () => {
    it('a message into a conversation that is not waiting starts a message period at its arrival', async () => {
      const { conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      expect(conversations.rows[0]!.waiting).toEqual({ since: at(100), startedBy: 'message' });
    });

    it('a further message keeps the period start', async () => {
      const { clock, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      clock.set(at(400));
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(conversations.rows[0]!.waiting).toEqual({ since: at(100), startedBy: 'message' });
    });

    it('a duplicate redelivery starts nothing', async () => {
      const { conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      conversations.rows[0]!.waiting = null;
      await useCases.captureInbound('ws-a', message());
      expect(conversations.rows[0]!.waiting).toBeNull();
    });

    it('a message after a sent reply starts a new period, at its arrival and not at Telegram date', async () => {
      const { clock, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      const row = conversations.rows[0]!;
      row.lastReplySentAt = at(200);
      row.waiting = null;
      clock.set(at(900));
      await useCases.captureInbound('ws-a', message({ messageId: 2n, sentAt: at(5) }));
      expect(row.waiting).toEqual({ since: at(900), startedBy: 'message' });
    });

    it('a message into a closed conversation reopens it with a message period at its arrival', async () => {
      const { clock, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      const row = conversations.rows[0]!;
      row.status = 'closed';
      row.waiting = null;
      clock.set(at(300));
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(row).toMatchObject({
        status: 'open',
        waiting: { since: at(300), startedBy: 'message' },
      });
    });
  });

  it('a redelivery is already_present and stored once (AC-11)', async () => {
    const { messages, useCases } = setup();
    await useCases.captureInbound('ws-a', message());
    expect(await useCases.captureInbound('ws-a', message())).toBe('already_present');
    expect(messages.rows).toHaveLength(1);
  });

  it('keeps kind and caption of non-text messages (AC-09)', async () => {
    const { messages, useCases } = setup();
    await useCases.captureInbound(
      'ws-a',
      message({ messageId: 5n, kind: 'photo', body: 'A rose', raw: { photo: [] } }),
    );
    expect(messages.rows[0]).toMatchObject({ kind: 'photo', body: 'A rose' });
  });

  it('a database error propagates (the webhook answers 500 and Telegram redelivers)', async () => {
    const { messages, useCases } = setup();
    vi.spyOn(messages, 'insertOnce').mockRejectedValueOnce(new Error('db down'));
    await expect(useCases.captureInbound('ws-a', message())).rejects.toThrow('db down');
  });

  describe('applyEdit (AC-10)', () => {
    it('replaces the text of a captured message', async () => {
      const { messages, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      expect(await useCases.applyEdit('ws-a', edit())).toBe('applied');
      expect(messages.rows[0]).toMatchObject({
        body: 'Fixed',
        editedAt: at(60),
        editUpdateId: 10n,
        telegramMessage: { message_id: 1, text: 'Fixed', edit_date: 60 },
      });
    });

    it('an older edit arriving later does not win', async () => {
      const { messages, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      await useCases.applyEdit('ws-a', edit({ body: 'Second', editedAt: at(70), updateId: 11n }));
      expect(await useCases.applyEdit('ws-a', edit({ body: 'First' }))).toBe('not_later');
      expect(messages.rows[0]!.body).toBe('Second');
    });

    it('an edit of a chat with no conversation is not_found and keeps nothing', async () => {
      const { conversations, messages, useCases } = setup();
      expect(await useCases.applyEdit('ws-a', edit())).toBe('not_found');
      expect(conversations.rows).toHaveLength(0);
      expect(messages.rows).toHaveLength(0);
    });

    it('an edit of a message not captured is not_found; the original later keeps its text', async () => {
      const { messages, useCases } = setup();
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(await useCases.applyEdit('ws-a', edit({ messageId: 1n }))).toBe('not_found');
      await useCases.captureInbound('ws-a', message());
      expect(messages.rows.find((m) => m.telegramMessageId === 1n)!.body).toBe('Hello');
    });

    it('is scoped by workspace', async () => {
      const { useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      expect(await useCases.applyEdit('ws-b', edit())).toBe('not_found');
    });
  });

  describe('list columns and live signals (AC-01, AC-15)', () => {
    it('a first message stamps arrival and activity with its arrival, and signals created', async () => {
      const { conversations, messages, signals, useCases, tx } = setup();
      await useCases.captureInbound('ws-a', message());
      expect(conversations.rows[0]).toMatchObject({
        lastMessageReceivedAt: at(100),
        lastActivityAt: at(100),
        lastReplySentAt: null,
      });
      expect(signals.sent).toEqual([
        {
          tx,
          workspaceId: 'ws-a',
          conversationId: conversations.rows[0]!.id,
          messageId: messages.rows[0]!.id,
          change: 'created',
        },
      ]);
    });

    it('a later message moves arrival and activity forward; sent_at never matters', async () => {
      const { clock, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      clock.set(at(300));
      await useCases.captureInbound('ws-a', message({ messageId: 2n, sentAt: at(2) }));
      expect(conversations.rows[0]).toMatchObject({
        lastMessageReceivedAt: at(300),
        lastActivityAt: at(300),
      });
    });

    it('a late redelivery (older Telegram time, new id) arrives now and moves the row', async () => {
      const { clock, conversations, useCases, signals } = setup();
      await useCases.captureInbound('ws-a', message({ messageId: 5n, sentAt: at(50) }));
      clock.set(at(400));
      await useCases.captureInbound('ws-a', message({ messageId: 3n, sentAt: at(30) }));
      expect(conversations.rows[0]!.lastMessageReceivedAt).toEqual(at(400));
      expect(signals.sent.map((s) => s.change)).toEqual(['created', 'created']);
    });

    it('activity is the later of arrival and the last sent reply', async () => {
      const { clock, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      conversations.rows[0]!.lastReplySentAt = at(500);
      conversations.rows[0]!.lastActivityAt = at(500);
      clock.set(at(300));
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(conversations.rows[0]).toMatchObject({
        lastMessageReceivedAt: at(300),
        lastActivityAt: at(500),
      });
    });

    it('a duplicate update changes no column and sends no signal', async () => {
      const { clock, conversations, signals, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      clock.set(at(900));
      await useCases.captureInbound('ws-a', message());
      expect(conversations.rows[0]!.lastMessageReceivedAt).toEqual(at(100));
      expect(signals.sent).toHaveLength(1);
    });

    it('an applied edit signals edited and leaves arrival and activity alone', async () => {
      const { clock, conversations, messages, signals, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      clock.set(at(700));
      await useCases.applyEdit('ws-a', edit());
      expect(conversations.rows[0]).toMatchObject({
        lastMessageReceivedAt: at(100),
        lastActivityAt: at(100),
      });
      expect(signals.sent[1]).toMatchObject({
        change: 'edited',
        conversationId: conversations.rows[0]!.id,
        messageId: messages.rows[0]!.id,
      });
    });

    it('a stale edit and an edit of nothing send no signal', async () => {
      const { signals, useCases } = setup();
      await useCases.applyEdit('ws-a', edit());
      await useCases.captureInbound('ws-a', message());
      await useCases.applyEdit('ws-a', edit({ editedAt: at(70), updateId: 11n }));
      await useCases.applyEdit('ws-a', edit());
      expect(signals.sent.map((s) => s.change)).toEqual(['created', 'edited']);
    });
  });

  it('lastMessageReceivedAt and hasConversations read the workspace only', async () => {
    const { clock, useCases } = setup();
    expect(await useCases.lastMessageReceivedAt('ws-a')).toBeNull();
    expect(await useCases.hasConversations('ws-a')).toBe(false);
    await useCases.captureInbound('ws-a', message());
    clock.set(at(200));
    await useCases.captureInbound('ws-a', message({ messageId: 2n }));
    expect(await useCases.lastMessageReceivedAt('ws-a')).toEqual(at(200));
    expect(await useCases.hasConversations('ws-a')).toBe(true);
    expect(await useCases.hasConversations('ws-b')).toBe(false);
    expect(await useCases.lastMessageReceivedAt('ws-b')).toBeNull();
  });

  describe('a customer message into a closed conversation (AC-06, AC-07)', () => {
    async function closedConversation() {
      const s = setup();
      await s.useCases.captureInbound('ws-a', message());
      const row = s.conversations.rows[0]!;
      row.status = 'closed';
      row.assigneeAccountId = 'acc-1';
      row.stateVersion = 4;
      s.clock.set(at(300));
      return { ...s, row };
    }

    it('raises the customer message counter for every newly captured message', async () => {
      const { conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      await useCases.captureInbound('ws-a', message({ messageId: 2n })); // duplicate
      expect(conversations.rows[0]!.customerMessageSeq).toBe(2);
    });

    it('reopens it with the same assignee, one reopened/customer_wrote entry at the arrival and its signal', async () => {
      const { row, activities, signals, useCases, tx } = await closedConversation();
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(row).toMatchObject({ status: 'open', assigneeAccountId: 'acc-1', stateVersion: 5 });
      expect(activities.rows).toEqual([
        expect.objectContaining({
          workspaceId: 'ws-a',
          conversationId: row.id,
          kind: 'reopened',
          cause: 'customer_wrote',
          actorAccountId: null,
          previousAssigneeAccountId: null,
          newAssigneeAccountId: null,
          positionAt: at(300),
        }),
      ]);
      expect(signals.activities).toEqual([
        { tx, workspaceId: 'ws-a', conversationId: row.id, activityId: activities.rows[0]!.id },
      ]);
    });

    it('a late redelivery reopens by its arrival: the line sits at the arrival time', async () => {
      const { row, activities, useCases } = await closedConversation();
      await useCases.captureInbound('ws-a', message({ messageId: 0n, sentAt: at(-50) }));
      expect(row.status).toBe('open');
      expect(activities.rows[0]!.positionAt).toEqual(at(300));
    });

    it('a duplicate redelivery does not reopen, count or signal', async () => {
      const { row, activities, signals, useCases } = await closedConversation();
      row.customerMessageSeq = 1;
      await useCases.captureInbound('ws-a', message());
      expect(row).toMatchObject({ status: 'closed', stateVersion: 4, customerMessageSeq: 1 });
      expect(activities.rows).toHaveLength(0);
      expect(signals.activities).toHaveLength(0);
    });

    it('an edit does not reopen', async () => {
      const { row, activities, useCases } = await closedConversation();
      await useCases.applyEdit('ws-a', edit());
      expect(row).toMatchObject({ status: 'closed', stateVersion: 4 });
      expect(activities.rows).toHaveLength(0);
    });

    it('a message into an open conversation records no change', async () => {
      const { activities, conversations, useCases } = setup();
      await useCases.captureInbound('ws-a', message());
      await useCases.captureInbound('ws-a', message({ messageId: 2n }));
      expect(conversations.rows[0]!.stateVersion).toBe(0);
      expect(activities.rows).toHaveLength(0);
    });
  });
});
