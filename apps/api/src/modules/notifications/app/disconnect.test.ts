import { describe, expect, it } from 'vitest';
import { at, notificationsHarness } from './fakes.js';
import { createDisconnectTelegram } from './disconnect.js';
import { createSettings } from './settings.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const W2 = '0199a000-0000-7000-8000-0000000000a2';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';

function setup() {
  const h = notificationsHarness();
  h.setBot(W);
  const link = (workspaceId: string, accountId: string) =>
    h.links.rows.push({
      id: `link-${workspaceId.slice(-2)}-${accountId.slice(-2)}`,
      workspaceId,
      accountId,
      telegramBotId: 100001n,
      telegramUserId: 555n,
      displayName: 'Ann',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
    });
  const disconnect = createDisconnectTelegram({
    transaction: h.transaction,
    links: h.links,
    signals: h.signalPort,
    enqueue: h.enqueue,
    settings: createSettings({ links: h.links, bots: h.botPort }),
    clock: h.clock,
  });
  return { h, link, disconnect };
}

describe('disconnectTelegram (AC-04, AC-12)', () => {
  it("removes the caller's link as member, signals, enqueues notifications_off", async () => {
    const { h, link, disconnect } = setup();
    link(W, A);
    const s = await disconnect.disconnectTelegram({
      workspaceId: W,
      accountId: A,
      role: 'operator',
    });
    expect(s.telegram).toEqual({ state: 'not_connected' });
    expect(s.can_connect).toBe(true);
    const row = h.links.rows[0]!;
    expect(row.removedAt).toEqual(at(0));
    expect(row.removedReason).toBe('member');
    expect(row.displayName).toBeNull();
    // The id stays for the answer job.
    expect(row.telegramUserId).toBe(555n);
    expect(h.signals).toEqual([{ workspaceId: W, accountId: A }]);
    expect(h.jobs).toEqual([
      { workspaceId: W, message: { kind: 'notifications_off', telegramLinkId: row.id } },
    ]);
  });

  it('a second Disconnect: 200, nothing changed, no signal, no job', async () => {
    const { h, link, disconnect } = setup();
    link(W, A);
    const input = { workspaceId: W, accountId: A, role: 'operator' as const };
    await disconnect.disconnectTelegram(input);
    const s = await disconnect.disconnectTelegram(input);
    expect(s.telegram.state).toBe('not_connected');
    expect(h.signals).toHaveLength(1);
    expect(h.jobs).toHaveLength(1);
  });

  it("removes only the caller's own link, only in that workspace", async () => {
    const { h, link, disconnect } = setup();
    link(W, A);
    link(W, B);
    link(W2, A);
    await disconnect.disconnectTelegram({ workspaceId: W, accountId: A, role: 'operator' });
    expect(h.links.rows.map((r) => r.removedAt !== null)).toEqual([true, false, false]);
  });

  it('nothing to disconnect: no signal, no job', async () => {
    const { h, disconnect } = setup();
    await disconnect.disconnectTelegram({ workspaceId: W, accountId: A, role: 'operator' });
    expect(h.signals).toEqual([]);
    expect(h.jobs).toEqual([]);
  });
});
