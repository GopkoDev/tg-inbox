import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { insertBroadcast, launchBroadcastFixture } from '../../../test/fixtures/broadcasts.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createMarkNeedsToken } from '../../bots/app/mark-needs-token.js';
import { BROADCAST_MESSAGES_PER_SECOND, createPacer } from '../../bots/app/pacer.js';
import { createSendBroadcastMessage } from '../../bots/app/send-broadcast-message.js';
import { createSendPauses, withPauseNotes } from '../../bots/app/send-pauses.js';
import { createBotRepo } from '../../bots/infra/bot-repo.js';
import { createBotSignals } from '../../bots/infra/bot-signals.js';
import { createTelegramGateway } from '../../bots/infra/telegram-gateway.js';
import { createTokenCipher } from '../../bots/infra/token-cipher.js';
import { createContactAudiences } from '../../contacts/app/audiences.js';
import { createContactReach } from '../../contacts/app/reach.js';
import { createAudienceQuery } from '../../contacts/infra/audience-query.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import { createReachRepo } from '../../contacts/infra/reach-repo.js';
import { createTagRepo } from '../../contacts/infra/tag-repo.js';
import { createReachSignals } from '../../contacts/infra/tag-signals.js';
import { createBroadcastItems } from '../../conversations/app/broadcast-items.js';
import { createBroadcastItemRepo } from '../../conversations/infra/broadcast-item-repo.js';
import { createConversationSignals } from '../../conversations/infra/conversation-signals.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createRecipientRepo } from '../infra/recipient-repo.js';
import { createBroadcastSignals, createReportSignals } from '../infra/signals.js';
import { createSendLink, type SendLink } from './send-link.js';
import { createSettle } from './settle.js';

describe('send link against the fake Bot API (Postgres; AC-08, AC-11, AC-12, AC-14, AC-15, AC-16, AC-17)', () => {
  let database: TestDatabase;
  let db: Db;
  let fake: FakeTelegram;
  let link: SendLink;
  let recipients: ReturnType<typeof createRecipientRepo>;
  /** `broadcasts.send` links enqueued, as `<ws>` or `<ws>@<iso>`. */
  let links: string[] = [];
  /**
   * Recipient ids in the order the link claimed them. The turn is decided at the claim; the sends
   * then run up to 8 in flight, so their arrival order at the fake Bot API is not the turn order.
   */
  let claims: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    fake = await startFakeTelegram();
    const transaction = <T>(fn: (tx: Db) => Promise<T>) => db.transaction().execute(fn);
    const bots = createBotRepo(db, createTokenCipher(testBotKey));
    const reach = createContactReach({
      transaction,
      contacts: createContactRepo(db),
      reach: createReachRepo(db),
      signals: createReachSignals(),
    });
    const pauses = createSendPauses();
    const sender = createSendBroadcastMessage({
      bots: withPauseNotes(bots, pauses),
      pauses,
      telegram: createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 5 }),
      markNeedsToken: createMarkNeedsToken({
        bots,
        clock: systemClock,
        transaction,
        signals: createBotSignals(),
      }),
      clock: systemClock,
      pacer: createPacer({ perSecond: BROADCAST_MESSAGES_PER_SECOND }),
      reach,
    });
    const broadcasts = createBroadcastRepo(db);
    recipients = createRecipientRepo(db);
    const signals = createBroadcastSignals();
    const jobs = {
      // The pg-boss queue is wired by T24; this records each enqueue made in the transaction.
      async enqueueSendLink(_tx: Db, workspaceId: string, startAfter?: Date) {
        links.push(startAfter ? `${workspaceId}@${startAfter.toISOString()}` : workspaceId);
      },
      async enqueueBlockedShare() {},
    };
    const observed: typeof recipients = {
      ...recipients,
      async claim(workspaceId, id, at, tx) {
        const claimed = await recipients.claim(workspaceId, id, at, tx);
        if (claimed) claims.push(id);
        return claimed;
      },
    };
    link = createSendLink({
      transaction,
      broadcasts,
      recipients: observed,
      contacts: createContactAudiences({
        audiences: createAudienceQuery(db),
        tags: createTagRepo(db),
      }),
      bots: sender,
      conversations: createBroadcastItems({
        items: createBroadcastItemRepo(db),
        signals: createConversationSignals(),
        clock: systemClock,
      }),
      settle: createSettle({
        transaction,
        broadcasts,
        recipients,
        signals,
        jobs,
        clock: systemClock,
      }),
      reports: createReportSignals(signals, systemClock),
      jobs,
      clock: systemClock,
    });
  }, 120_000);

  afterAll(async () => {
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });

  beforeEach(() => {
    fake.reset();
    links = [];
    claims = [];
  });

  /** A workspace with its bot and `n` contacts who wrote to it, each with a conversation. */
  async function workspace(n: number) {
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const { bot, token } = await insertBot(db, { workspaceId });
    fake.bot(token).script({});
    const contacts: { id: string; chatId: bigint }[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = await insertContact(db, { workspaceId, reachForBot: bot.telegramBotId });
      await insertConversation(db, { workspaceId, contactId: id });
      const { telegram_user_id } = await db
        .selectFrom('contacts')
        .select('telegram_user_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      contacts.push({ id, chatId: BigInt(telegram_user_id) });
    }
    contacts.sort((a, b) => (a.id < b.id ? -1 : 1));
    const launch = async (ids: string[], launchedAt = new Date()) => {
      const id = await insertBroadcast(db, {
        workspaceId,
        authorAccountId: owner.accountId,
        text: 'New prices from Monday.',
      });
      const rows = await launchBroadcastFixture(db, {
        broadcast: id,
        launchedByAccountId: owner.accountId,
        telegramBotId: bot.telegramBotId,
        recipients: ids.map((contactId) => ({ contactId })),
        launchedAt,
      });
      return { id, rows };
    };
    return { workspaceId, bot, token, contacts, launch };
  }

  const sentChats = (token: string) =>
    fake
      .calls(token)
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.params.chat_id));

  const recipientRows = (workspaceId: string, broadcastId: string) =>
    db
      .selectFrom('broadcast_recipients')
      .select(['contact_id', 'state', 'failure_reason', 'claimed_at', 'outcome_at'])
      .where('workspace_id', '=', workspaceId)
      .where('broadcast_id', '=', broadcastId)
      .orderBy('position')
      .execute();

  const itemsOf = (workspaceId: string, broadcastId: string) =>
    db
      .selectFrom('broadcast_items')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('broadcast_id', '=', broadcastId)
      .execute();

  const statusOf = async (workspaceId: string, id: string) =>
    db
      .selectFrom('broadcasts')
      .select(['status', 'end_reason'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('AC-11, AC-15, AC-17: two broadcasts alternate; each recipient gets one plain-text message and a delivered item; both end sent', async () => {
    const w = await workspace(4);
    const ids = w.contacts.map((c) => c.id);
    const a = await w.launch(ids.slice(0, 2), new Date(Date.now() - 60_000));
    const b = await w.launch(ids.slice(2, 4));
    await link.runSendLink(w.workspaceId);
    // Turns alternate, oldest launch first: a's first, b's first, a's second, b's second.
    expect(claims).toEqual([a.rows[0]!.id, b.rows[0]!.id, a.rows[1]!.id, b.rows[1]!.id]);
    // Each of them reached Telegram exactly once.
    expect([...sentChats(w.token)].sort()).toEqual(w.contacts.map((c) => String(c.chatId)).sort());
    const sends = fake.calls(w.token).filter((c) => c.method === 'sendMessage');
    for (const s of sends) {
      expect(s.params.text).toBe('New prices from Monday.');
      expect(s.params.parse_mode).toBeUndefined();
    }
    for (const x of [a, b]) {
      expect((await recipientRows(w.workspaceId, x.id)).map((r) => r.state)).toEqual([
        'delivered',
        'delivered',
      ]);
      expect((await itemsOf(w.workspaceId, x.id)).map((i) => i.state)).toEqual([
        'delivered',
        'delivered',
      ]);
      expect(await statusOf(w.workspaceId, x.id)).toEqual({
        status: 'sent',
        end_reason: 'completed',
      });
    }
    expect(links).toEqual([]);
  });

  it('AC-11, AC-16: a send with no answer ends not confirmed with its item at the claim time and is never sent again', async () => {
    const w = await workspace(1);
    const x = await w.launch([w.contacts[0]!.id]);
    fake.bot(w.token).script({ sendMessage: [sendAnswers.resetAfterWrite()] });
    await link.runSendLink(w.workspaceId);
    const [r] = await recipientRows(w.workspaceId, x.id);
    expect(r).toMatchObject({ state: 'not_confirmed', failure_reason: null });
    const [item] = await itemsOf(w.workspaceId, x.id);
    expect(item).toMatchObject({ state: 'not_confirmed' });
    expect(item!.position_at).toEqual(r!.claimed_at);
    await link.runSendLink(w.workspaceId);
    expect(sentChats(w.token)).toHaveLength(1);
    expect((await statusOf(w.workspaceId, x.id)).status).toBe('sent');
  });

  it('AC-11, AC-16: a link killed between the claim and the answer — the next link resolves the recipient not confirmed with its item at the claim time, no send', async () => {
    const w = await workspace(2);
    const x = await w.launch(w.contacts.map((c) => c.id));
    const claimedAt = new Date(Date.now() - 30_000);
    expect(await recipients.claim(w.workspaceId, x.rows[0]!.id, claimedAt)).toBe(true);
    const summary = await link.runSendLink(w.workspaceId);
    expect(summary.staleResolved).toBe(1);
    const rows = await recipientRows(w.workspaceId, x.id);
    expect(rows.map((r) => r.state)).toEqual(['not_confirmed', 'delivered']);
    const items = await itemsOf(w.workspaceId, x.id);
    const stale = items.find((i) => i.state === 'not_confirmed')!;
    expect(stale.position_at).toEqual(claimedAt);
    expect(sentChats(w.token)).toEqual([String(w.contacts[1]!.chatId)]);
  });

  it('AC-15: a 429 puts the recipient back to waiting and delays the successor to the pause end', async () => {
    const w = await workspace(3);
    const x = await w.launch(w.contacts.map((c) => c.id));
    fake.bot(w.token).script({ sendMessage: [sendAnswers.tooMany(30)] });
    await link.runSendLink(w.workspaceId);
    const rows = await recipientRows(w.workspaceId, x.id);
    // The scripted 429 answers the first send to reach Telegram (sends run 8 in flight).
    const limited = w.contacts.find((c) => String(c.chatId) === sentChats(w.token)[0])!;
    expect(rows.find((r) => r.contact_id === limited.id)).toMatchObject({
      state: 'waiting',
      claimed_at: null,
    });
    expect(rows.every((r) => r.state === 'waiting' || r.state === 'delivered')).toBe(true);
    const { send_paused_until } = await db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('workspace_id', '=', w.workspaceId)
      .executeTakeFirstOrThrow();
    expect(links).toEqual([`${w.workspaceId}@${send_paused_until!.toISOString()}`]);
    expect((await statusOf(w.workspaceId, x.id)).status).toBe('sending');
    // No recipient is sent twice.
    const chats = sentChats(w.token);
    expect(new Set(chats).size).toBe(chats.length);
  });

  it('AC-12: a refused text aborts — every recipient not reached fails with text_refused, the broadcast is sent, nothing more goes out', async () => {
    const w = await workspace(3);
    const x = await w.launch(w.contacts.map((c) => c.id));
    fake.bot(w.token).script({ sendMessage: [sendAnswers.textTooLong()] });
    await link.runSendLink(w.workspaceId);
    const rows = await recipientRows(w.workspaceId, x.id);
    // Up to 8 sends are in flight, so the refused one is whichever reached Telegram first.
    expect(rows.filter((r) => r.failure_reason === 'text_refused').length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          r.state === 'delivered' || (r.state === 'failed' && r.failure_reason === 'text_refused'),
      ),
    ).toBe(true);
    expect(rows.some((r) => r.state === 'waiting' || r.state === 'sending')).toBe(false);
    expect(await statusOf(w.workspaceId, x.id)).toEqual({
      status: 'sent',
      end_reason: 'text_refused',
    });
    const after = sentChats(w.token).length;
    await link.runSendLink(w.workspaceId);
    expect(sentChats(w.token)).toHaveLength(after);
    expect(links).toEqual([]);
  });

  it('AC-14: a recipient blocked before their turn gets blocked with no send and no item; one who unblocked is sent it', async () => {
    const w = await workspace(1);
    const blockedId = await insertContact(db, { workspaceId: w.workspaceId });
    await insertReach(db, {
      workspaceId: w.workspaceId,
      contactId: blockedId,
      telegramBotId: w.bot.telegramBotId,
      wroteAt: new Date('2026-10-01'),
      blockedAt: new Date('2026-10-20'),
    });
    await insertConversation(db, { workspaceId: w.workspaceId, contactId: blockedId });
    const reached = w.contacts[0]!;
    const x = await w.launch([blockedId, reached.id]);
    await link.runSendLink(w.workspaceId);
    const rows = await recipientRows(w.workspaceId, x.id);
    expect(rows.map((r) => [r.contact_id, r.state]).sort()).toEqual(
      [
        [blockedId, 'blocked'],
        [reached.id, 'delivered'],
      ].sort(),
    );
    expect(sentChats(w.token)).toEqual([String(reached.chatId)]);
    const { id: conversationId } = await db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', w.workspaceId)
      .where('contact_id', '=', reached.id)
      .executeTakeFirstOrThrow();
    expect((await itemsOf(w.workspaceId, x.id)).map((i) => i.conversation_id)).toEqual([
      conversationId,
    ]);
  });

  it("AC-08: a link sends only its own workspace's broadcasts through its own bot", async () => {
    const a = await workspace(1);
    const b = await workspace(1);
    await a.launch([a.contacts[0]!.id]);
    const other = await b.launch([b.contacts[0]!.id]);
    await link.runSendLink(a.workspaceId);
    expect(sentChats(a.token)).toHaveLength(1);
    expect(sentChats(b.token)).toEqual([]);
    expect((await recipientRows(b.workspaceId, other.id))[0]!.state).toBe('waiting');
  });
});
