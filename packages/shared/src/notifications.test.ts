import { describe, expect, it } from 'vitest';
import {
  AttentionCount,
  ConnectLinkLimitReachedError,
  IssuedConnectLink,
  NotificationSettings,
  PingsNeedWorkingBotError,
  PingsState,
  TelegramAlreadyLinkedError,
  TelegramLinkState,
} from './notifications.js';

const WS = '01920000-0000-7000-8000-000000000001';
const TOKEN = 'A'.repeat(43);
const bot = { workspace_id: WS, state: 'connected', can_reply: true, receiving: true };
const connected = {
  state: 'connected',
  display_name: 'Test User',
  linked_at: '2026-10-19T09:12:00Z',
  blocked_at: null,
  pings: 'on',
};
const settings = {
  workspace_id: WS,
  caller_role: 'operator',
  bot,
  telegram: connected,
  can_connect: false,
};

describe('AttentionCount (AC-01)', () => {
  it('parses the contract example and rejects a negative or extra field', () => {
    expect(AttentionCount.safeParse({ workspace_id: WS, count: 3 }).success).toBe(true);
    expect(AttentionCount.safeParse({ workspace_id: WS, count: 0 }).success).toBe(true);
    expect(AttentionCount.safeParse({ workspace_id: WS, count: -1 }).success).toBe(false);
    expect(AttentionCount.safeParse({ workspace_id: WS, count: 1.5 }).success).toBe(false);
    expect(AttentionCount.safeParse({ workspace_id: WS, count: 1, extra: 1 }).success).toBe(false);
  });
});

describe('PingsState / TelegramLinkState', () => {
  it('knows on, paused and not_reachable', () => {
    for (const p of ['on', 'paused', 'not_reachable'])
      expect(PingsState.safeParse(p).success).toBe(true);
    expect(PingsState.safeParse('off').success).toBe(false);
  });

  it('discriminates on state (AC-06)', () => {
    expect(TelegramLinkState.safeParse({ state: 'not_connected' }).success).toBe(true);
    expect(TelegramLinkState.safeParse(connected).success).toBe(true);
    expect(
      TelegramLinkState.safeParse({ ...connected, blocked_at: '2026-10-19T09:30:00Z' }).success,
    ).toBe(true);
    expect(TelegramLinkState.safeParse({ state: 'not_connected', display_name: 'x' }).success).toBe(
      false,
    );
    expect(TelegramLinkState.safeParse({ state: 'linked' }).success).toBe(false);
  });

  it('rejects an empty display_name and a connected state without pings', () => {
    expect(TelegramLinkState.safeParse({ ...connected, display_name: '' }).success).toBe(false);
    expect(TelegramLinkState.safeParse({ ...connected, pings: undefined }).success).toBe(false);
  });

  it('never carries the Telegram user id', () => {
    expect(TelegramLinkState.safeParse({ ...connected, telegram_user_id: 5001 }).success).toBe(
      false,
    );
  });
});

describe('NotificationSettings', () => {
  it('parses connected and not-connected examples', () => {
    expect(NotificationSettings.safeParse(settings).success).toBe(true);
    expect(
      NotificationSettings.safeParse({
        ...settings,
        caller_role: 'owner',
        telegram: { state: 'not_connected' },
        can_connect: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a bad role, a missing field and an extra field', () => {
    expect(NotificationSettings.safeParse({ ...settings, caller_role: 'admin' }).success).toBe(
      false,
    );
    expect(NotificationSettings.safeParse({ ...settings, can_connect: undefined }).success).toBe(
      false,
    );
    expect(NotificationSettings.safeParse({ ...settings, extra: 1 }).success).toBe(false);
  });
});

describe('IssuedConnectLink (AC-05)', () => {
  const link = {
    workspace_id: WS,
    bot_username: 'acme_flowers_bot',
    url: `https://t.me/acme_flowers_bot?start=tgi_${TOKEN}`,
    expires_at: '2026-10-19T09:22:00Z',
  };

  it('parses the contract example', () => {
    expect(IssuedConnectLink.safeParse(link).success).toBe(true);
    expect(
      IssuedConnectLink.safeParse({
        ...link,
        url: `https://t.me/acme_bot?start=tgi_${'a-_'.repeat(14)}a`,
      }).success,
    ).toBe(true);
  });

  it('rejects a 42-character token, a 44-character token, another host and another payload prefix', () => {
    const bad = [
      `https://t.me/acme_flowers_bot?start=tgi_${'A'.repeat(42)}`,
      `https://t.me/acme_flowers_bot?start=tgi_${'A'.repeat(44)}`,
      `https://example.com/acme_flowers_bot?start=tgi_${TOKEN}`,
      `https://t.me/acme_flowers_bot?start=abc_${TOKEN}`,
      `https://t.me/acme_flowers_bot?start=tgi_${'A'.repeat(42)}+`,
    ];
    for (const url of bad)
      expect(IssuedConnectLink.safeParse({ ...link, url }).success).toBe(false);
  });
});

describe('refusals (AC-06, AC-13)', () => {
  const env = (code: string, details: unknown) => ({ error: { code, message: 'm', details } });

  it('CONNECT_LINK_LIMIT_REACHED carries limit 5, window 600 and retry_at', () => {
    const ok = env('CONNECT_LINK_LIMIT_REACHED', {
      limit: 5,
      window_seconds: 600,
      retry_at: '2026-10-19T09:26:30Z',
    });
    expect(ConnectLinkLimitReachedError.safeParse(ok).success).toBe(true);
    expect(
      ConnectLinkLimitReachedError.safeParse(
        env('CONNECT_LINK_LIMIT_REACHED', {
          limit: 6,
          window_seconds: 600,
          retry_at: '2026-10-19T09:26:30Z',
        }),
      ).success,
    ).toBe(false);
    expect(
      ConnectLinkLimitReachedError.safeParse(env('CONNECT_LINK_LIMIT_REACHED', { limit: 5 }))
        .success,
    ).toBe(false);
    expect(ConnectLinkLimitReachedError.safeParse(env('OTHER', ok.error.details)).success).toBe(
      false,
    );
  });

  it('TELEGRAM_ALREADY_LINKED and PINGS_NEED_WORKING_BOT carry the caller settings', () => {
    expect(
      TelegramAlreadyLinkedError.safeParse(env('TELEGRAM_ALREADY_LINKED', { settings })).success,
    ).toBe(true);
    expect(
      PingsNeedWorkingBotError.safeParse(
        env('PINGS_NEED_WORKING_BOT', {
          settings: {
            ...settings,
            caller_role: 'owner',
            bot: { ...bot, state: 'needs_token', can_reply: false, receiving: false },
            telegram: { state: 'not_connected' },
          },
        }),
      ).success,
    ).toBe(true);
    expect(TelegramAlreadyLinkedError.safeParse(env('TELEGRAM_ALREADY_LINKED', {})).success).toBe(
      false,
    );
    expect(
      PingsNeedWorkingBotError.safeParse(env('TELEGRAM_ALREADY_LINKED', { settings })).success,
    ).toBe(false);
  });
});
