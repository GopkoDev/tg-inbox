import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { RecipientState } from '../domain/recipient.js';
import {
  fakeBroadcastJobs,
  fakeBroadcastRepo,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeRecipientRepo,
} from './fakes.js';
import type { BroadcastRecord } from './ports.js';
import { createSettle } from './settle.js';

const LAUNCHED = new Date('2026-10-23T09:00:00Z');
const NOW = new Date('2026-10-23T09:10:00Z');
const IN_48H = new Date(NOW.getTime() + 48 * 3_600_000);
const WS = newId();
const OWNER = newId();

function settleSetup() {
  const store = fakeBroadcastStore();
  const jobs = fakeBroadcastJobs();
  const logs: Array<{ obj: object; msg: string }> = [];
  const settle = createSettle({
    transaction: fakeBroadcastTransaction(store),
    broadcasts: fakeBroadcastRepo(store),
    recipients: fakeRecipientRepo(store),
    signals: fakeBroadcastSignals(store),
    jobs,
    clock: fixedClock(NOW),
    logger: { info: (obj, msg) => logs.push({ obj, msg }) },
  });

  /** A sending broadcast with recipients in these states. */
  const sending = (states: RecipientState[], o: Partial<BroadcastRecord> = {}) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Spring prices',
      text: 'Hello',
      status: 'sending',
      version: 2,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: OWNER,
      lastChangedByAccountId: OWNER,
      lastChangedAt: LAUNCHED,
      createdAt: LAUNCHED,
      launchedAt: LAUNCHED,
      launchedByAccountId: OWNER,
      launchTelegramBotId: 1n,
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
    states.forEach((state, i) =>
      store.recipients.push({
        workspaceId: WS,
        id: newId(),
        broadcastId: row.id,
        contactId: newId(),
        position: i + 1,
        telegramUserId: BigInt(i + 1),
        state,
        failureReason: state === 'failed' ? 'account_gone' : null,
        claimedAt: state === 'sending' || state === 'delivered' ? LAUNCHED : null,
        outcomeAt: state === 'waiting' || state === 'sending' ? null : LAUNCHED,
        telegramMessageId: state === 'delivered' ? 1n : null,
      }),
    );
    return row;
  };

  const statesOf = (id: string) =>
    store.recipients
      .filter((r) => r.broadcastId === id)
      .sort((x, y) => x.position - y.position)
      .map((r) => (r.failureReason ? `${r.state}:${r.failureReason}` : r.state));
  const rowOf = (id: string) => store.broadcasts.find((b) => b.id === id)!;

  return { store, jobs, logs, settle, sending, statesOf, rowOf };
}

describe('abort (AC-12)', () => {
  it.each(['text_refused', 'bot_stopped'] as const)(
    '%s fails every waiting recipient with that reason, keeps the in-flight ones, and ends the broadcast sent',
    async (reason) => {
      const h = settleSetup();
      const b = h.sending(['delivered', 'sending', 'waiting', 'waiting', 'failed']);
      expect(await h.settle.abort(WS, b.id, reason)).toBe(true);
      expect(h.statesOf(b.id)).toEqual([
        'delivered',
        'sending',
        `failed:${reason}`,
        `failed:${reason}`,
        'failed:account_gone',
      ]);
      expect(h.rowOf(b.id)).toMatchObject({ status: 'sent', endedAt: NOW, endReason: reason });
      expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
      expect(h.jobs.jobs).toEqual([`${WS}:${b.id}@${IN_48H.toISOString()}`]);
      expect(h.logs).toEqual([
        {
          msg: 'broadcast.ended',
          obj: expect.objectContaining({
            workspace_id: WS,
            broadcast_id: b.id,
            end_reason: reason,
            launch_to_finish_ms: 10 * 60_000,
            totals: expect.objectContaining({ failed: 3, delivered: 1, sending: 1 }),
          }),
        },
      ]);
    },
  );

  it('leaves a broadcast stopped meanwhile alone', async () => {
    const h = settleSetup();
    const b = h.sending(['stopped'], {
      status: 'stopped',
      stoppedAt: NOW,
      stoppedByAccountId: OWNER,
      endedAt: NOW,
      endReason: 'stopped',
    });
    expect(await h.settle.abort(WS, b.id, 'text_refused')).toBe(false);
    expect(h.rowOf(b.id).status).toBe('stopped');
    expect(h.statesOf(b.id)).toEqual(['stopped']);
    expect(h.store.signals).toEqual([]);
    expect(h.jobs.jobs).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it('a foreign or unknown broadcast is left alone', async () => {
    const h = settleSetup();
    const b = h.sending(['waiting'], { workspaceId: newId() });
    expect(await h.settle.abort(WS, b.id, 'bot_stopped')).toBe(false);
    expect(await h.settle.abort(WS, newId(), 'bot_stopped')).toBe(false);
    expect(h.rowOf(b.id).status).toBe('sending');
  });
});

describe('finishIfDone (AC-11)', () => {
  it('marks the broadcast sent with completed when nothing waits and nothing is in flight', async () => {
    const h = settleSetup();
    const b = h.sending(['delivered', 'blocked', 'failed', 'not_confirmed']);
    expect(await h.settle.finishIfDone(WS, b.id)).toBe(true);
    expect(h.rowOf(b.id)).toMatchObject({ status: 'sent', endedAt: NOW, endReason: 'completed' });
    expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
    expect(h.jobs.jobs).toHaveLength(1);
  });

  it.each([['waiting'], ['sending']] as const)(
    'does nothing while a recipient is %s',
    async (state) => {
      const h = settleSetup();
      const b = h.sending(['delivered', state]);
      expect(await h.settle.finishIfDone(WS, b.id)).toBe(false);
      expect(h.rowOf(b.id).status).toBe('sending');
      expect(h.store.signals).toEqual([]);
    },
  );

  it('never finishes a stopped broadcast', async () => {
    const h = settleSetup();
    const b = h.sending(['delivered'], {
      status: 'stopped',
      stoppedAt: NOW,
      stoppedByAccountId: OWNER,
      endedAt: NOW,
      endReason: 'stopped',
    });
    expect(await h.settle.finishIfDone(WS, b.id)).toBe(false);
    expect(h.rowOf(b.id).endReason).toBe('stopped');
  });
});
