import { NotificationSettings } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { at, notificationsHarness } from './fakes.js';
import { createSettings } from './settings.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';

function setup() {
  const h = notificationsHarness();
  h.setBot(W);
  const settings = createSettings({ links: h.links, bots: h.botPort });
  const link = (accountId: string, o: Partial<(typeof h.links.rows)[number]> = {}) =>
    h.links.rows.push({
      id: `link-${accountId}`,
      workspaceId: W,
      accountId,
      telegramBotId: 100001n,
      telegramUserId: 555n,
      displayName: 'Ann Telegram',
      linkedAt: at(-3600),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
      ...o,
    });
  return { h, settings, link };
}

describe('mySettings (AC-04, AC-06, AC-10, AC-13)', () => {
  it('not connected with a working bot: can_connect', async () => {
    const { settings } = setup();
    const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
    expect(NotificationSettings.parse(s)).toEqual({
      workspace_id: W,
      caller_role: 'operator',
      bot: { workspace_id: W, state: 'connected', can_reply: true, receiving: true },
      telegram: { state: 'not_connected' },
      can_connect: true,
    });
  });

  it.each(['needs_token', 'taken_over', 'disconnected'] as const)(
    'bot %s: cannot connect',
    async (state) => {
      const { h, settings } = setup();
      h.setBot(W, { state });
      const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'owner' });
      expect(s.can_connect).toBe(false);
      expect(s.caller_role).toBe('owner');
    },
  );

  it('no bot at all: not_connected bot, cannot connect', async () => {
    const { h, settings } = setup();
    h.bots.clear();
    const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
    expect(s.bot.state).toBe('not_connected');
    expect(s.can_connect).toBe(false);
  });

  it('connected: shows the name and times, never the Telegram user id, no connect', async () => {
    const { settings, link } = setup();
    link(A);
    const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
    expect(NotificationSettings.parse(s).telegram).toEqual({
      state: 'connected',
      display_name: 'Ann Telegram',
      linked_at: at(-3600).toISOString(),
      blocked_at: null,
      pings: 'on',
    });
    expect(s.can_connect).toBe(false);
    expect(JSON.stringify(s)).not.toContain('555');
  });

  it("shows only the caller's own link (AC-12)", async () => {
    const { settings, link } = setup();
    link(B);
    const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
    expect(s.telegram).toEqual({ state: 'not_connected' });
  });

  it('a removed link is not connected', async () => {
    const { settings, link } = setup();
    link(A, { removedAt: at(-10), removedReason: 'member', displayName: null });
    const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
    expect(s.telegram.state).toBe('not_connected');
  });

  it('pings: not_reachable beats paused beats on; taken_over still on', async () => {
    const { h, settings, link } = setup();
    link(A);
    const pings = async () => {
      const s = await settings.mySettings({ workspaceId: W, accountId: A, role: 'operator' });
      return s.telegram.state === 'connected' ? s.telegram.pings : null;
    };
    expect(await pings()).toBe('on');
    h.setBot(W, { state: 'taken_over' });
    expect(await pings()).toBe('on');
    h.setBot(W, { state: 'needs_token' });
    expect(await pings()).toBe('paused');
    h.setBot(W, { state: 'disconnected' });
    expect(await pings()).toBe('paused');
    h.links.rows[0]!.blockedAt = at(-5);
    expect(await pings()).toBe('not_reachable');
    h.setBot(W);
    expect(await pings()).toBe('not_reachable');
  });
});
