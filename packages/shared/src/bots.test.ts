import { describe, expect, it } from 'vitest';
import {
  BotIdentity,
  BotReconnect,
  BotSettings,
  BotState,
  BotTokenPaste,
  ErrorEnvelope,
  SettingsRefusalDetails,
  TakeoverConfirmationDetails,
  WorkspaceKeepsOneBotDetails,
} from './index.js';

const bot = { name: 'Test Bot 1', username: 'test_bot_1' };

// Every BotSettings example of getBotSettings / pasteBotToken / reconnectBot / disconnectBot.
const settingsExamples = {
  connected: {
    state: 'connected',
    bot,
    last_checked_at: '2026-10-11T10:03:00Z',
    last_message_received_at: '2026-10-11T09:58:12Z',
    contacts_count: 12,
  },
  needsToken: {
    state: 'needs_token',
    bot,
    last_checked_at: '2026-10-11T10:03:00Z',
    last_message_received_at: '2026-10-11T08:40:00Z',
    contacts_count: 12,
  },
  takenOver: {
    state: 'taken_over',
    bot,
    last_checked_at: '2026-10-11T10:03:00Z',
    last_message_received_at: null,
    contacts_count: 0,
  },
  notConnected: { state: 'not_connected' },
  pasted: {
    state: 'connected',
    bot,
    last_checked_at: '2026-10-11T10:05:00Z',
    last_message_received_at: null,
    contacts_count: 0,
  },
  reconnected: {
    state: 'connected',
    bot,
    last_checked_at: '2026-10-11T10:06:00Z',
    last_message_received_at: '2026-10-11T08:40:00Z',
    contacts_count: 12,
  },
};

describe('BotSettings', () => {
  it.each(Object.entries(settingsExamples))('parses the %s example', (_name, example) => {
    expect(BotSettings.parse(example)).toEqual(example);
  });

  it.each(['token', 'webhook_secret', 'token_encrypted', 'webhook_secret_hash'])(
    'rejects an extra %s key (no token or secret can leave the API)',
    (key) => {
      expect(BotSettings.safeParse({ ...settingsExamples.connected, [key]: 'x' }).success).toBe(
        false,
      );
      expect(BotSettings.safeParse({ state: 'not_connected', [key]: 'x' }).success).toBe(false);
    },
  );

  it('rejects not_connected with a bot', () => {
    expect(BotSettings.safeParse({ state: 'not_connected', bot }).success).toBe(false);
  });

  it('rejects a live state without its fields, a negative count and the stored disconnected state', () => {
    expect(BotSettings.safeParse({ state: 'connected' }).success).toBe(false);
    expect(
      BotSettings.safeParse({ ...settingsExamples.connected, contacts_count: -1 }).success,
    ).toBe(false);
    expect(
      BotSettings.safeParse({ ...settingsExamples.connected, state: 'disconnected' }).success,
    ).toBe(false);
  });

  it('rejects a bot identity with an extra key', () => {
    expect(BotIdentity.safeParse({ ...bot, id: 1 }).success).toBe(false);
  });

  it('accepts long Telegram names (no length bounds)', () => {
    expect(
      BotIdentity.parse({ name: 'x'.repeat(1000), username: 'y'.repeat(300) }).name,
    ).toHaveLength(1000);
  });

  it('BotState holds only the live states', () => {
    expect(BotState.options).toEqual(['connected', 'needs_token', 'taken_over']);
  });
});

describe('BotTokenPaste', () => {
  it('parses both examples and defaults confirm_takeover to false', () => {
    expect(
      BotTokenPaste.parse({ token: ' 100000001:TEST-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ' }),
    ).toEqual({
      token: ' 100000001:TEST-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ',
      confirm_takeover: false,
    });
    expect(
      BotTokenPaste.parse({
        token: '100000001:TEST-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        confirm_takeover: true,
      }).confirm_takeover,
    ).toBe(true);
  });

  it('bounds the raw token at 512 characters, without checking its form', () => {
    expect(BotTokenPaste.safeParse({ token: 'x'.repeat(512) }).success).toBe(true);
    expect(BotTokenPaste.safeParse({ token: 'x'.repeat(513) }).success).toBe(false);
  });

  it('rejects a string confirm_takeover, a missing token and extra keys', () => {
    expect(BotTokenPaste.safeParse({ token: 't', confirm_takeover: 'true' }).success).toBe(false);
    expect(BotTokenPaste.safeParse({}).success).toBe(false);
    expect(BotTokenPaste.safeParse({ token: 't', workspace: 'x' }).success).toBe(false);
  });
});

describe('BotReconnect', () => {
  it('parses both examples and defaults confirm_takeover to false', () => {
    expect(BotReconnect.parse({})).toEqual({ confirm_takeover: false });
    expect(BotReconnect.parse({ confirm_takeover: true })).toEqual({ confirm_takeover: true });
  });

  it('rejects extra keys and a string flag', () => {
    expect(BotReconnect.safeParse({ token: 'x' }).success).toBe(false);
    expect(BotReconnect.safeParse({ confirm_takeover: 'true' }).success).toBe(false);
  });
});

describe('refusal details', () => {
  it.each(['connected', 'history'])('WorkspaceKeepsOneBotDetails accepts %s', (reason) => {
    expect(WorkspaceKeepsOneBotDetails.parse({ reason })).toEqual({ reason });
  });

  it('WorkspaceKeepsOneBotDetails rejects another reason', () => {
    expect(WorkspaceKeepsOneBotDetails.safeParse({ reason: 'other' }).success).toBe(false);
  });

  it('TakeoverConfirmationDetails carries the bot identity', () => {
    expect(TakeoverConfirmationDetails.parse({ bot })).toEqual({ bot });
  });

  it.each([
    ['NOTHING_TO_RECONNECT', settingsExamples.connected],
    ['BOT_NEEDS_NEW_TOKEN', settingsExamples.needsToken],
    ['NO_BOT_CONNECTED', settingsExamples.notConnected],
  ])('%s example: envelope + settings details parse', (code, settings) => {
    const body = { error: { code, message: 'm', details: { settings } } };
    expect(ErrorEnvelope.parse(body)).toEqual(body);
    expect(SettingsRefusalDetails.parse(body.error.details)).toEqual({ settings });
  });

  it('SettingsRefusalDetails rejects settings carrying a token', () => {
    expect(
      SettingsRefusalDetails.safeParse({ settings: { state: 'not_connected', token: 'x' } })
        .success,
    ).toBe(false);
  });
});
