import { describe, expect, it } from 'vitest';
import { InboxBotStatus } from '@tg/shared';
import { botRow, createBotsHarness } from './harness.js';
import { createInboxBotStatus } from './inbox-status.js';

function setup(rows = [botRow()]) {
  const h = createBotsHarness(rows);
  return { h, status: createInboxBotStatus({ bots: h.bots }) };
}

describe('inboxBotStatus (AC-13, AC-14)', () => {
  it.each([
    ['connected', { state: 'connected', can_reply: true, receiving: true }],
    ['taken_over', { state: 'taken_over', can_reply: true, receiving: false }],
    ['needs_token', { state: 'needs_token', can_reply: false, receiving: false }],
    ['disconnected', { state: 'not_connected', can_reply: false, receiving: false }],
  ] as const)('%s → %j', async (state, expected) => {
    const dead = state === 'disconnected';
    const { status } = setup([
      botRow({
        state,
        ...(dead && { token: null, webhookSecret: null, connectedAt: null }),
      }),
    ]);
    expect(await status.inboxBotStatus('ws-a')).toEqual({ workspace_id: 'ws-a', ...expected });
  });

  it('no bot row → not_connected, cannot reply', async () => {
    const { status } = setup([]);
    expect(await status.inboxBotStatus('ws-a')).toEqual({
      workspace_id: 'ws-a',
      state: 'not_connected',
      can_reply: false,
      receiving: false,
    });
  });

  it('is scoped to the workspace asked for', async () => {
    const { status } = setup();
    expect((await status.inboxBotStatus('ws-b')).state).toBe('not_connected');
  });

  it('never carries the bot name, username, token or secret', async () => {
    const { status } = setup();
    const result = await status.inboxBotStatus('ws-a');
    expect(Object.keys(result).sort()).toEqual(['can_reply', 'receiving', 'state', 'workspace_id']);
    const json = JSON.stringify(result);
    for (const secret of ['Old Name', 'old_name_bot', 'stored-secret', ':TEST-']) {
      expect(json).not.toContain(secret);
    }
  });

  it('canCarryReplies is can_reply', async () => {
    for (const [state, expected] of [
      ['connected', true],
      ['taken_over', true],
      ['needs_token', false],
    ] as const) {
      const { status } = setup([botRow({ state })]);
      expect(await status.canCarryReplies('ws-a')).toBe(expected);
    }
    expect(await setup([]).status.canCarryReplies('ws-a')).toBe(false);
  });

  it('matches the shared InboxBotStatus schema', async () => {
    const { status } = setup();
    const result = await status.inboxBotStatus('0199a000-0000-7000-8000-0000000000aa');
    expect(() => InboxBotStatus.parse(result)).not.toThrow();
  });
});
