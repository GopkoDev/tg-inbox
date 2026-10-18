import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { fakeContactRepo } from '../../contacts/app/fakes.js';
import {
  createConversations,
  type InboundEdit,
  type InboundMessage,
  type Transaction,
} from './conversations.js';
import { fakeConversationRepo, fakeMessageRepo } from './fakes.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

const message = (o: Partial<InboundMessage> = {}): InboundMessage => ({
  chatId: 700001n,
  messageId: 1n,
  kind: 'text',
  body: 'Hello',
  sentAt: at(1),
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
  const contacts = createContacts({ repo: contactRepo, clock });
  const conversations = fakeConversationRepo();
  const messages = fakeMessageRepo();
  const tx = { marker: 'tx' } as never;
  const transaction = vi.fn(<T>(fn: (t: never) => Promise<T>) => fn(tx));
  const useCases = createConversations({
    transaction: transaction as unknown as Transaction,
    conversations,
    messages,
    contacts,
    clock,
  });
  return { clock, contactRepo, conversations, messages, transaction, tx, useCases };
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
      contacts: contacts as never,
      clock: fixedClock(at(100)),
    });
    await useCases.captureInbound('ws-a', message());
    expect(contacts.upsertFromProfile).toHaveBeenCalledWith('ws-a', message().sender, at(1), tx);
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
});
