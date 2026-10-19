import { describe, expect, it } from 'vitest';
import { SendBotMessageJob, toJobPayload } from './jobs.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const L = '0199a000-0000-7000-8000-0000000000c1';

describe('SendBotMessageJob (events.md)', () => {
  it.each(['connected', 'already_connected', 'notifications_off', 'chat_only_notifications'])(
    '%s takes telegram_link_id only',
    (kind) => {
      expect(
        SendBotMessageJob.safeParse({ workspace_id: W, kind, telegram_link_id: L }).success,
      ).toBe(true);
      expect(
        SendBotMessageJob.safeParse({ workspace_id: W, kind, telegram_user_id: '5' }).success,
      ).toBe(false);
      expect(
        SendBotMessageJob.safeParse({
          workspace_id: W,
          kind,
          telegram_link_id: L,
          telegram_user_id: '5',
        }).success,
      ).toBe(false);
    },
  );

  it('link_expired takes a decimal telegram_user_id only', () => {
    const base = { workspace_id: W, kind: 'link_expired' };
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: '777' }).success).toBe(true);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: '0' }).success).toBe(false);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: 777 }).success).toBe(false);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_link_id: L }).success).toBe(false);
    expect(
      SendBotMessageJob.safeParse({ ...base, telegram_user_id: '7', reason: 'x' }).success,
    ).toBe(false);
  });

  it('cannot_connect needs a reason', () => {
    const base = { workspace_id: W, kind: 'cannot_connect', telegram_user_id: '777' };
    expect(SendBotMessageJob.safeParse(base).success).toBe(false);
    expect(
      SendBotMessageJob.safeParse({ ...base, reason: 'telegram_linked_to_teammate' }).success,
    ).toBe(true);
    expect(SendBotMessageJob.safeParse({ ...base, reason: 'nope' }).success).toBe(false);
  });

  it('toJobPayload builds a valid payload for every message', () => {
    for (const m of [
      { kind: 'connected', telegramLinkId: L },
      { kind: 'link_expired', telegramUserId: 777n },
      { kind: 'cannot_connect', telegramUserId: 777n, reason: 'member_linked_elsewhere' },
    ] as const) {
      expect(SendBotMessageJob.safeParse(toJobPayload(W, m)).success).toBe(true);
    }
    expect(toJobPayload(W, { kind: 'link_expired', telegramUserId: 777n })).toEqual({
      workspace_id: W,
      kind: 'link_expired',
      telegram_user_id: '777',
    });
  });
});
