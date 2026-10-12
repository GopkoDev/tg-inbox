import { describe, expect, it } from 'vitest';
import { at, botRow, createBotsHarness } from './harness.js';

describe('getSettings (flow 4)', () => {
  it('no bot row → not_connected', async () => {
    const h = createBotsHarness();
    expect(await h.settings.getSettings('ws-a')).toEqual({ state: 'not_connected' });
  });

  it('a row kept after a disconnect → not_connected and nothing else', async () => {
    const h = createBotsHarness([
      botRow({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null }),
    ]);
    h.contacts.counts.set('ws-a', 3);
    expect(await h.settings.getSettings('ws-a')).toEqual({ state: 'not_connected' });
  });

  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    '%s → identity, state, last check, last message, contacts count; never the token (AC-15)',
    async (state) => {
      const h = createBotsHarness([botRow({ state })]);
      h.conversations.last.set('ws-a', at(30));
      h.contacts.counts.set('ws-a', 12);
      const settings = await h.settings.getSettings('ws-a');
      expect(settings).toEqual({
        state,
        bot: { name: 'Old Name', username: 'old_name_bot' },
        last_checked_at: at(0).toISOString(),
        last_message_received_at: at(30).toISOString(),
        contacts_count: 12,
      });
      expect(JSON.stringify(settings)).not.toContain(botRow().token!);
      expect(JSON.stringify(settings)).not.toContain('stored-secret');
    },
  );

  it('before the first message the last message time is null (AC-07)', async () => {
    const h = createBotsHarness([botRow()]);
    expect(await h.settings.getSettings('ws-a')).toMatchObject({
      last_message_received_at: null,
      contacts_count: 0,
    });
  });

  it('makes no Telegram call', async () => {
    const h = createBotsHarness([botRow()]);
    await h.settings.getSettings('ws-a');
    expect(h.telegram.calls).toHaveLength(0);
  });

  it('reads only its own workspace', async () => {
    const h = createBotsHarness([botRow({ workspaceId: 'ws-b' })]);
    h.contacts.counts.set('ws-b', 5);
    expect(await h.settings.getSettings('ws-a')).toEqual({ state: 'not_connected' });
  });
});
