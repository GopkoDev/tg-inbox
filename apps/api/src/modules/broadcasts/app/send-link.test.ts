import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { RecipientState } from '../domain/recipient.js';
import { createReportSignals } from '../infra/signals.js';
import {
  fakeBroadcastJobs,
  fakeBroadcastRepo,
  fakeBroadcastSender,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeContactsApi,
  fakeConversationsApi,
  fakeRecipientRepo,
} from './fakes.js';
import type { BroadcastRecord, BroadcastSendOutcome } from './ports.js';
import { createSendLink } from './send-link.js';
import { createSettle } from './settle.js';

const T0 = new Date('2026-10-23T09:00:00Z');
const WS = newId();
const OWNER = newId();
const BOT = 7001n;

function setup() {
  const store = fakeBroadcastStore();
  const clock = fixedClock(T0);
  const transaction = fakeBroadcastTransaction(store);
  const broadcasts = fakeBroadcastRepo(store);
  const recipients = fakeRecipientRepo(store);
  const contacts = fakeContactsApi();
  const bots = fakeBroadcastSender(clock);
  const conversations = fakeConversationsApi();
  const jobs = fakeBroadcastJobs();
  const base = fakeBroadcastSignals(store);
  /** `<change>:<broadcast>` with the clock time of each publish. */
  const published: { what: string; at: number }[] = [];
  const signals = {
    async broadcastChanged(...args: Parameters<typeof base.broadcastChanged>) {
      published.push({ what: `${args[3]}:${args[2]}`, at: clock.now().getTime() });
      await base.broadcastChanged(...args);
    },
  };
  const settle = createSettle({ transaction, broadcasts, recipients, signals, jobs, clock });
  const link = createSendLink({
    transaction,
    broadcasts,
    recipients,
    contacts,
    bots,
    conversations,
    settle,
    reports: createReportSignals(signals, clock),
    jobs,
    clock,
    sleep: async (ms) => clock.advance(ms),
  });

  let nextUserId = 100n;
  /** A sending broadcast with one recipient per state, positions 1…n. */
  const broadcast = (
    states: RecipientState[],
    o: Partial<BroadcastRecord> & { launchedAt?: Date } = {},
  ) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      status: 'sending',
      version: 2,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: OWNER,
      lastChangedByAccountId: OWNER,
      lastChangedAt: T0,
      createdAt: T0,
      launchedAt: T0,
      launchedByAccountId: OWNER,
      launchTelegramBotId: BOT,
      audienceSize: states.length,
      blockedCount: 0,
      neverWroteCount: 0,
      recipientCount: states.length,
      stoppedAt: null,
      stoppedByAccountId: null,
      endedAt: null,
      endReason: null,
      ...o,
    };
    store.broadcasts.push(row);
    const rows = states.map((state, i) => {
      const contactId = newId();
      const r = {
        workspaceId: row.workspaceId,
        id: newId(),
        broadcastId: row.id,
        contactId,
        position: i + 1,
        telegramUserId: nextUserId++,
        state,
        failureReason: null,
        claimedAt: state === 'sending' ? new Date(T0.getTime() - 5_000) : null,
        outcomeAt: null,
        telegramMessageId: null,
      };
      store.recipients.push(r);
      contacts.contacts.set(row.workspaceId, [
        ...(contacts.contacts.get(row.workspaceId) ?? []),
        { id: contactId, firstName: 'Test User', tagIds: [], wroteTo: [BOT] },
      ]);
      return r;
    });
    return { row, rows };
  };
  const recipientsOf = (id: string) =>
    store.recipients.filter((r) => r.broadcastId === id).sort((a, b) => a.position - b.position);
  const statesOf = (id: string) => recipientsOf(id).map((r) => r.state);
  const rowOf = (id: string) => store.broadcasts.find((b) => b.id === id)!;
  const reportsOf = (id: string) => published.filter((p) => p.what === `report:${id}`);

  return {
    store,
    clock,
    contacts,
    bots,
    conversations,
    jobs,
    link,
    published,
    broadcast,
    recipientsOf,
    statesOf,
    rowOf,
    reportsOf,
  };
}

const answer = (o: BroadcastSendOutcome) => o;

describe('runSendLink (AC-08, AC-11, AC-12, AC-14, AC-15, AC-16, AC-17)', () => {
  it('AC-11, AC-17: sends each waiting recipient once in position order with the frozen text, records delivered with its item at the answer time, then finishes the broadcast', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['waiting', 'waiting', 'waiting']);
    const summary = await h.link.runSendLink(WS);

    expect(h.bots.sends).toEqual(
      rows.map((r) => ({
        workspaceId: WS,
        telegramBotId: BOT,
        chatId: r.telegramUserId,
        text: 'New prices from Monday.',
      })),
    );
    expect(h.statesOf(row.id)).toEqual(['delivered', 'delivered', 'delivered']);
    expect(h.conversations.items).toEqual(
      rows.map((r, i) => ({
        workspaceId: WS,
        contactId: r.contactId,
        broadcastId: row.id,
        state: 'delivered',
        positionAt: h.bots.answeredAt[i],
        telegramMessageId: h.recipientsOf(row.id)[i]!.telegramMessageId,
      })),
    );
    expect(h.rowOf(row.id)).toMatchObject({ status: 'sent', endReason: 'completed' });
    expect(h.published.filter((p) => p.what === `status:${row.id}`)).toHaveLength(1);
    expect(h.reportsOf(row.id).length).toBeGreaterThanOrEqual(1);
    // Nothing still sends: no successor.
    expect(h.jobs.links).toEqual([]);
    expect(summary).toMatchObject({ claimed: 3, outcomes: { delivered: 3 }, successor: null });
  });

  it('AC-15: two sending broadcasts take turns, oldest launch first', async () => {
    const h = setup();
    const a = h.broadcast(['waiting', 'waiting', 'waiting'], {
      launchedAt: new Date(T0.getTime() - 60_000),
    });
    const b = h.broadcast(['waiting', 'waiting']);
    await h.link.runSendLink(WS);
    const chat = (x: { rows: { telegramUserId: bigint }[] }, i: number) =>
      x.rows[i]!.telegramUserId;
    expect(h.bots.sends.map((s) => s.chatId)).toEqual([
      chat(a, 0),
      chat(b, 0),
      chat(a, 1),
      chat(b, 1),
      chat(a, 2),
    ]);
    expect(h.rowOf(a.row.id).status).toBe('sent');
    expect(h.rowOf(b.row.id).status).toBe('sent');
  });

  it('AC-11, AC-14: a recipient blocked at their turn gets blocked with no send and no item; one blocked only for another bot is sent', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['waiting', 'waiting']);
    const contacts = h.contacts.contacts.get(WS)!;
    contacts.find((c) => c.id === rows[0]!.contactId)!.blocked = new Map([[BOT, T0]]);
    contacts.find((c) => c.id === rows[1]!.contactId)!.blocked = new Map([[999n, T0]]);
    await h.link.runSendLink(WS);
    expect(h.bots.sends.map((s) => s.chatId)).toEqual([rows[1]!.telegramUserId]);
    expect(h.statesOf(row.id)).toEqual(['blocked', 'delivered']);
    expect(h.conversations.items.map((i) => i.contactId)).toEqual([rows[1]!.contactId]);
  });

  it('AC-11, AC-16: each answer decides one outcome; only delivered and not confirmed get an item, not confirmed at the claim time', async () => {
    const h = setup();
    const { row, rows } = h.broadcast([
      'waiting',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
    const chats = rows.map((r) => r.telegramUserId);
    h.bots.script.set(chats[0]!, answer({ outcome: 'blocked' }));
    h.bots.script.set(chats[1]!, answer({ outcome: 'account_gone' }));
    h.bots.script.set(chats[2]!, answer({ outcome: 'chat_not_found' }));
    h.bots.script.set(chats[3]!, answer({ outcome: 'telegram_error' }));
    h.bots.script.set(chats[4]!, answer({ outcome: 'not_confirmed' }));
    h.bots.advanceOnSend = 100;
    await h.link.runSendLink(WS);
    const got = h.recipientsOf(row.id);
    expect(got.map((r) => [r.state, r.failureReason])).toEqual([
      ['blocked', null],
      ['failed', 'account_gone'],
      ['failed', 'chat_not_found'],
      ['failed', 'telegram_error'],
      ['not_confirmed', null],
      ['delivered', null],
    ]);
    expect(h.conversations.items.map((i) => [i.contactId, i.state])).toEqual([
      [rows[4]!.contactId, 'not_confirmed'],
      [rows[5]!.contactId, 'delivered'],
    ]);
    // Not confirmed sits at its claim time, which is before its (advanced) answer time.
    const notConfirmed = h.conversations.items[0]!;
    expect(notConfirmed.positionAt).toEqual(got[4]!.claimedAt);
    expect(notConfirmed.positionAt.getTime()).toBeLessThan(h.bots.answeredAt[4]!.getTime());
    expect(h.bots.sends).toHaveLength(6);
    expect(h.rowOf(row.id).status).toBe('sent');
  });

  it('AC-15: a rate limit puts the recipient back to waiting, stops the link and delays the successor to the pause end', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['waiting', 'waiting', 'waiting', 'waiting']);
    const until = new Date(T0.getTime() + 30_000);
    h.bots.script.set(
      rows[0]!.telegramUserId,
      answer({ outcome: 'rate_limited', retryAfter: until }),
    );
    const summary = await h.link.runSendLink(WS);
    const got = h.recipientsOf(row.id);
    expect(got[0]).toMatchObject({ state: 'waiting', claimedAt: null });
    // No recipient is sent twice and none is skipped: every one is delivered once or still waiting.
    expect(got.every((r) => r.state === 'waiting' || r.state === 'delivered')).toBe(true);
    const chats = h.bots.sends.map((s) => s.chatId);
    expect(new Set(chats).size).toBe(chats.length);
    expect(h.rowOf(row.id).status).toBe('sending');
    expect(h.jobs.links).toEqual([`${WS}@${until.toISOString()}`]);
    expect(summary.successor).toEqual({ startAfter: until });
  });

  it("AC-15: the bot's send pause seen by bots also requeues and delays the successor", async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['waiting']);
    const until = new Date(T0.getTime() + 5_000);
    h.bots.script.set(rows[0]!.telegramUserId, answer({ outcome: 'paused', until }));
    await h.link.runSendLink(WS);
    expect(h.statesOf(row.id)).toEqual(['waiting']);
    expect(h.jobs.links).toEqual([`${WS}@${until.toISOString()}`]);
  });

  it('AC-12: a refused text aborts — the recipient and every waiting one fail with text_refused, the broadcast is sent, nothing more is sent', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['delivered', 'waiting', 'waiting', 'waiting']);
    h.bots.script.set(rows[1]!.telegramUserId, answer({ outcome: 'text_refused' }));
    await h.link.runSendLink(WS);
    const got = h.recipientsOf(row.id);
    expect(got[1]).toMatchObject({ state: 'failed', failureReason: 'text_refused' });
    expect(got.some((r) => r.state === 'waiting' || r.state === 'sending')).toBe(false);
    expect(
      got
        .slice(2)
        .every(
          (r) =>
            r.state === 'delivered' || (r.state === 'failed' && r.failureReason === 'text_refused'),
        ),
    ).toBe(true);
    expect(h.rowOf(row.id)).toMatchObject({ status: 'sent', endReason: 'text_refused' });
    expect(h.jobs.links).toEqual([]);
    expect(h.conversations.items.every((i) => i.state === 'delivered')).toBe(true);
  });

  it('AC-12: a replaced or lost bot aborts with bot_stopped', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['waiting', 'waiting']);
    h.bots.script.set(rows[0]!.telegramUserId, answer({ outcome: 'bot_changed' }));
    h.bots.script.set(rows[1]!.telegramUserId, answer({ outcome: 'bot_unavailable' }));
    await h.link.runSendLink(WS);
    expect(h.recipientsOf(row.id).map((r) => [r.state, r.failureReason])).toEqual([
      ['failed', 'bot_stopped'],
      ['failed', 'bot_stopped'],
    ]);
    expect(h.rowOf(row.id)).toMatchObject({ status: 'sent', endReason: 'bot_stopped' });
  });

  it('ADR-0008: at most 8 sends are in flight at once', async () => {
    const h = setup();
    const { row } = h.broadcast(Array<RecipientState>(20).fill('waiting'));
    h.bots.holdAll = true;
    const running = h.link.runSendLink(WS);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.bots.sends).toHaveLength(8);
    h.bots.release();
    await running;
    expect(h.bots.maxInFlight).toBe(8);
    expect(h.statesOf(row.id).every((s) => s === 'delivered')).toBe(true);
  });

  it('ADR-0007: the link stops claiming after 20 s and asks for a successor while anything still waits', async () => {
    const h = setup();
    const { row } = h.broadcast(Array<RecipientState>(12).fill('waiting'));
    h.bots.advanceOnSend = 3_000;
    const summary = await h.link.runSendLink(WS);
    expect(summary.claimed).toBe(7);
    expect(h.statesOf(row.id).filter((s) => s === 'waiting')).toHaveLength(5);
    expect(h.rowOf(row.id).status).toBe('sending');
    expect(h.jobs.links).toEqual([WS]);
    expect(summary.successor).toEqual({ startAfter: null });
  });

  it('AC-11, AC-16: a recipient left sending by a dead link becomes not confirmed with its item at the claim time and is never sent again', async () => {
    const h = setup();
    const { row, rows } = h.broadcast(['sending', 'waiting']);
    const summary = await h.link.runSendLink(WS);
    expect(summary.staleResolved).toBe(1);
    expect(h.statesOf(row.id)).toEqual(['not_confirmed', 'delivered']);
    expect(h.bots.sends.map((s) => s.chatId)).toEqual([rows[1]!.telegramUserId]);
    expect(h.conversations.items[0]).toEqual({
      workspaceId: WS,
      contactId: rows[0]!.contactId,
      broadcastId: row.id,
      state: 'not_confirmed',
      positionAt: rows[0]!.claimedAt,
      telegramMessageId: null,
    });
    expect(h.reportsOf(row.id)[0]!.at).toBe(T0.getTime());
  });

  it('ADR-0011: report signals go out at most once per second per broadcast, and the last one is never lost', async () => {
    const h = setup();
    const { row } = h.broadcast(Array<RecipientState>(30).fill('waiting'));
    h.bots.advanceOnSend = 100;
    await h.link.runSendLink(WS);
    const times = h.reportsOf(row.id).map((p) => p.at);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('AC-08: only the workspace’s own broadcasts are sent, each with its launch Telegram bot', async () => {
    const h = setup();
    const own = h.broadcast(['waiting']);
    const other = h.broadcast(['waiting'], { workspaceId: newId(), launchTelegramBotId: 8002n });
    await h.link.runSendLink(WS);
    expect(h.bots.sends).toEqual([
      expect.objectContaining({
        workspaceId: WS,
        telegramBotId: BOT,
        chatId: own.rows[0]!.telegramUserId,
      }),
    ]);
    expect(h.statesOf(other.row.id)).toEqual(['waiting']);
  });
});
