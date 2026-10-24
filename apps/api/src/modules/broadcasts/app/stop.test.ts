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
  fakeWorkspacesApi,
} from './fakes.js';
import type { BroadcastRecord, BroadcastView } from './ports.js';
import { createSettle } from './settle.js';
import { createStopBroadcast } from './stop.js';

const LAUNCHED = new Date('2026-10-23T09:00:00Z');
const NOW = new Date('2026-10-23T09:10:00Z');
const WS = newId();
const OWNER = newId();
const OPERATOR = newId();
const owner = { accountId: OWNER, role: 'owner' as const };

function setup() {
  const store = fakeBroadcastStore();
  const jobs = fakeBroadcastJobs();
  const workspaces = fakeWorkspacesApi();
  workspaces.active.add(`${WS}:${OWNER}`);
  workspaces.active.add(`${WS}:${OPERATOR}`);
  const transaction = fakeBroadcastTransaction(store);
  const broadcasts = fakeBroadcastRepo(store);
  const recipients = fakeRecipientRepo(store);
  const signals = fakeBroadcastSignals(store);
  const clock = fixedClock(NOW);
  const settle = createSettle({ transaction, broadcasts, recipients, signals, jobs, clock });
  const views: BroadcastView = {
    async broadcastView(workspaceId, id) {
      const b = store.broadcasts.find((x) => x.workspaceId === workspaceId && x.id === id)!;
      return { id: b.id, status: b.status } as never;
    },
  };
  const stop = createStopBroadcast({
    transaction,
    broadcasts,
    workspaces,
    settle,
    views,
  });

  const broadcast = (states: RecipientState[], o: Partial<BroadcastRecord> = {}) => {
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
        failureReason: null,
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
      .map((r) => r.state);
  const rowOf = (id: string) => store.broadcasts.find((b) => b.id === id)!;

  return { store, jobs, workspaces, stop, broadcast, statesOf, rowOf };
}

describe('stopBroadcast (AC-18)', () => {
  it('an owner stops: waiting → stopped, in-flight kept, the broadcast stopped with who and when', async () => {
    const h = setup();
    const b = h.broadcast(['delivered', 'sending', 'waiting', 'waiting']);
    const got = await h.stop.stopBroadcast(WS, owner, b.id);
    expect(got).toEqual({ outcome: 'stopped', broadcast: { id: b.id, status: 'stopped' } });
    expect(h.statesOf(b.id)).toEqual(['delivered', 'sending', 'stopped', 'stopped']);
    expect(h.rowOf(b.id)).toMatchObject({
      status: 'stopped',
      stoppedAt: NOW,
      stoppedByAccountId: OWNER,
      endedAt: NOW,
      endReason: 'stopped',
    });
    expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
    expect(h.jobs.jobs).toHaveLength(1);
    expect(h.workspaces.locks).toEqual([`members:${OWNER}`]);
  });

  it('an operator is refused as owner only and nothing changes', async () => {
    const h = setup();
    const b = h.broadcast(['waiting']);
    await expect(
      h.stop.stopBroadcast(WS, { accountId: OPERATOR, role: 'operator' }, b.id),
    ).rejects.toMatchObject({ code: 'OWNER_ONLY' });
    expect(h.rowOf(b.id).status).toBe('sending');
  });

  it('an owner deactivated meanwhile gets access removed and nothing changes', async () => {
    const h = setup();
    h.workspaces.active.delete(`${WS}:${OWNER}`);
    const b = h.broadcast(['waiting']);
    await expect(h.stop.stopBroadcast(WS, owner, b.id)).rejects.toMatchObject({
      code: 'ACCESS_REMOVED',
    });
    expect(h.statesOf(b.id)).toEqual(['waiting']);
  });

  it('nothing waiting (the last outcome came first) answers unchanged and the broadcast ends sent', async () => {
    const h = setup();
    const b = h.broadcast(['delivered', 'blocked']);
    expect(await h.stop.stopBroadcast(WS, owner, b.id)).toEqual({
      outcome: 'unchanged',
      broadcast: { id: b.id, status: 'sent' },
    });
    expect(h.rowOf(b.id)).toMatchObject({ endReason: 'completed', stoppedByAccountId: null });
  });

  it('nothing waiting but a send in flight answers unchanged and keeps it sending', async () => {
    const h = setup();
    const b = h.broadcast(['delivered', 'sending']);
    expect((await h.stop.stopBroadcast(WS, owner, b.id)).outcome).toBe('unchanged');
    expect(h.rowOf(b.id).status).toBe('sending');
    expect(h.store.signals).toEqual([]);
  });

  it('a second stop, an ended broadcast or a draft answer unchanged with no second signal or job', async () => {
    const h = setup();
    const b = h.broadcast(['waiting']);
    await h.stop.stopBroadcast(WS, owner, b.id);
    expect((await h.stop.stopBroadcast(WS, owner, b.id)).outcome).toBe('unchanged');
    const draft = h.broadcast([], { status: 'draft', launchedAt: null });
    expect(await h.stop.stopBroadcast(WS, owner, draft.id)).toEqual({
      outcome: 'unchanged',
      broadcast: { id: draft.id, status: 'draft' },
    });
    expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
    expect(h.jobs.jobs).toHaveLength(1);
  });

  it('a broadcast of another workspace is not found', async () => {
    const h = setup();
    const b = h.broadcast(['waiting'], { workspaceId: newId() });
    await expect(h.stop.stopBroadcast(WS, owner, b.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
