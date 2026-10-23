import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createBroadcastItems } from './broadcast-items.js';
import { fakeBroadcastItemRepo, fakeConversationSignals } from './fakes.js';
import type { Executor } from './ports.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const tx = { marker: 'tx' } as unknown as Executor;

function setup() {
  const items = fakeBroadcastItemRepo();
  items.conversations.set('ws-a:c1', 'conv-1');
  const signals = fakeConversationSignals();
  const useCases = createBroadcastItems({ items, signals, clock: fixedClock(at(100)) });
  return { items, signals, useCases };
}

describe('broadcast items (ADR-0010, AC-16)', () => {
  it('records a delivered item in the caller transaction and signals it as created', async () => {
    const { items, signals, useCases } = setup();
    const insert = vi.spyOn(items, 'insert');
    const out = await useCases.recordBroadcastItem(tx, {
      workspaceId: 'ws-a',
      contactId: 'c1',
      broadcastId: 'b1',
      state: 'delivered',
      positionAt: at(5),
      telegramMessageId: 42n,
    });
    expect(out).toEqual({ id: expect.any(String), conversationId: 'conv-1' });
    expect(insert.mock.calls[0]![1]).toBe(tx);
    expect(items.rows).toEqual([
      {
        id: out!.id,
        workspaceId: 'ws-a',
        conversationId: 'conv-1',
        broadcastId: 'b1',
        state: 'delivered',
        positionAt: at(5),
        telegramMessageId: 42n,
        createdAt: at(100),
      },
    ]);
    expect(signals.broadcastItems).toEqual([
      { workspaceId: 'ws-a', conversationId: 'conv-1', broadcastItemId: out!.id, tx },
    ]);
    // Nothing about the conversation's state, read marks or activity is signalled.
    expect([signals.sent, signals.read, signals.replies, signals.activities].flat()).toEqual([]);
  });

  it('a not confirmed item carries no message id', async () => {
    const { items, useCases } = setup();
    await useCases.recordBroadcastItem(tx, {
      workspaceId: 'ws-a',
      contactId: 'c1',
      broadcastId: 'b1',
      state: 'not_confirmed',
      positionAt: at(3),
      telegramMessageId: null,
    });
    expect(items.rows[0]).toMatchObject({ state: 'not_confirmed', telegramMessageId: null });
  });

  it('a contact with no conversation in the workspace gets no item and no signal', async () => {
    const { items, signals, useCases } = setup();
    const out = await useCases.recordBroadcastItem(tx, {
      workspaceId: 'ws-b',
      contactId: 'c1',
      broadcastId: 'b1',
      state: 'delivered',
      positionAt: at(5),
      telegramMessageId: 1n,
    });
    expect(out).toBeNull();
    expect(items.rows).toEqual([]);
    expect(signals.broadcastItems).toEqual([]);
  });

  it('reads one item by workspace, conversation and id', async () => {
    const { useCases } = setup();
    const out = await useCases.recordBroadcastItem(tx, {
      workspaceId: 'ws-a',
      contactId: 'c1',
      broadcastId: 'b1',
      state: 'delivered',
      positionAt: at(5),
      telegramMessageId: 1n,
    });
    expect(await useCases.getBroadcastItem('ws-a', 'conv-1', out!.id)).toMatchObject({
      id: out!.id,
      broadcastId: 'b1',
    });
    expect(await useCases.getBroadcastItem('ws-b', 'conv-1', out!.id)).toBeNull();
    expect(await useCases.getBroadcastItem('ws-a', 'conv-2', out!.id)).toBeNull();
  });
});
