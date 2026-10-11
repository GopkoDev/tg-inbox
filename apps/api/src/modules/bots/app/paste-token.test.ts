import { describe, expect, it } from 'vitest';
import {
  BotBelongsToAnotherWorkspaceError,
  BotTokenInvalidError,
  TakeoverConfirmationRequiredError,
  TelegramUnavailableError,
  WorkspaceKeepsOneBotError,
} from '../../../platform/errors.js';
import { at, BASE_URL, botRow, createBotsHarness, tokenOf } from './harness.js';
import { OWNER_ACTION_TIMEOUT } from './ports.js';

const NEW_TOKEN = tokenOf(100001n, 'n');
const ME = { ok: true as const, telegramBotId: 100001n, name: 'Acme Bot', username: 'acme_bot' };

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a refusal');
}

describe('pasteToken — refusals in order', () => {
  it('a text that is not a bot token → BOT_TOKEN_INVALID, no Telegram call (AC-02)', async () => {
    const h = createBotsHarness();
    const err = await refusal(h.paste.pasteToken('ws-a', 'not a token', false));
    expect(err).toBeInstanceOf(BotTokenInvalidError);
    expect(h.telegram.calls).toHaveLength(0);
    expect(h.bots.rows).toHaveLength(0);
  });

  it('Telegram rejects the token → BOT_TOKEN_INVALID; the connection keeps working (AC-02)', async () => {
    const h = createBotsHarness([botRow()]);
    h.telegram.me = 'unauthorized';
    const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
    expect(err).toBeInstanceOf(BotTokenInvalidError);
    expect(h.bots.rows).toEqual([botRow()]);
  });

  it('getMe transient → TELEGRAM_UNAVAILABLE, nothing written', async () => {
    const h = createBotsHarness();
    h.telegram.me = 'transient';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows).toHaveLength(0);
  });

  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    'a different bot while the workspace bot is %s → WORKSPACE_KEEPS_ONE_BOT connected (AC-05)',
    async (state) => {
      const h = createBotsHarness([botRow({ state, telegramBotId: 999n })]);
      h.telegram.me = ME;
      const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
      expect(err).toBeInstanceOf(WorkspaceKeepsOneBotError);
      expect((err as WorkspaceKeepsOneBotError).details).toEqual({ reason: 'connected' });
      expect(h.telegram.calls.map((c) => c.method)).toEqual(['getMe']);
    },
  );

  it('a different bot after a disconnect with history → WORKSPACE_KEEPS_ONE_BOT history (AC-05)', async () => {
    const kept = botRow({
      telegramBotId: 999n,
      state: 'disconnected',
      token: null,
      webhookSecret: null,
      connectedAt: null,
    });
    const h = createBotsHarness([kept]);
    const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
    expect((err as WorkspaceKeepsOneBotError).details).toEqual({ reason: 'history' });
    expect(h.bots.rows).toEqual([kept]);
  });

  it('the bot belongs to another workspace → BOT_BELONGS_TO_ANOTHER_WORKSPACE (AC-04)', async () => {
    const theirs = botRow({ workspaceId: 'ws-b' });
    const h = createBotsHarness([theirs]);
    const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
    expect(err).toBeInstanceOf(BotBelongsToAnotherWorkspaceError);
    expect(JSON.stringify((err as Error).message)).not.toContain('ws-b');
    expect(h.bots.rows).toEqual([theirs]);
    expect(h.telegram.calls.map((c) => c.method)).not.toContain('setWebhook');
  });

  it('bound elsewhere and delivering to another service → ownership refusal, never a confirmation', async () => {
    const h = createBotsHarness([botRow({ workspaceId: 'ws-b' })]);
    h.telegram.webhook = 'foreign';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      BotBelongsToAnotherWorkspaceError,
    );
  });

  it('delivering to another service, not confirmed → TAKEOVER_CONFIRMATION_REQUIRED with the bot (AC-06)', async () => {
    const h = createBotsHarness();
    h.telegram.me = ME;
    h.telegram.webhook = 'foreign';
    const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
    expect(err).toBeInstanceOf(TakeoverConfirmationRequiredError);
    expect((err as TakeoverConfirmationRequiredError).details).toEqual({
      bot: { name: 'Acme Bot', username: 'acme_bot' },
    });
    expect(h.bots.rows).toHaveLength(0);
    expect(h.telegram.calls.map((c) => c.method)).toEqual(['getMe', 'getWebhook']);
  });

  it('getWebhookInfo transient → TELEGRAM_UNAVAILABLE; unauthorized → BOT_TOKEN_INVALID', async () => {
    const h = createBotsHarness();
    h.telegram.webhook = 'transient';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    h.telegram.webhook = 'unauthorized';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      BotTokenInvalidError,
    );
    expect(h.bots.rows).toHaveLength(0);
  });

  it('no refusal carries the token', async () => {
    const h = createBotsHarness([botRow({ workspaceId: 'ws-b' })]);
    const err = await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false));
    expect(
      JSON.stringify({ m: (err as Error).message, d: (err as { details?: unknown }).details }),
    ).not.toContain(NEW_TOKEN);
  });
});

describe('pasteToken — connect (AC-01)', () => {
  it('no row → inserts a connected bot, sets the webhook dropping pending updates, returns settings', async () => {
    const h = createBotsHarness();
    h.telegram.me = ME;
    h.telegram.webhook = 'none';
    const settings = await h.paste.pasteToken('ws-a', `  ${NEW_TOKEN}\n`, false);
    expect(settings).toEqual({
      state: 'connected',
      bot: { name: 'Acme Bot', username: 'acme_bot' },
      last_checked_at: at(600).toISOString(),
      last_message_received_at: null,
      contacts_count: 0,
    });
    expect(h.bots.rows).toHaveLength(1);
    const row = h.bots.rows[0]!;
    expect(row).toMatchObject({
      workspaceId: 'ws-a',
      telegramBotId: 100001n,
      name: 'Acme Bot',
      username: 'acme_bot',
      state: 'connected',
      token: NEW_TOKEN,
      connectedAt: at(600),
      lastCheckedAt: at(600),
      createdAt: at(600),
    });
    const url = `${BASE_URL}/api/telegram/webhook/${row.id}`;
    const secret = h.secrets.secretFor(row.id, at(600));
    expect(row.webhookSecret).toBe(secret);
    expect(h.telegram.calls).toEqual([
      { method: 'getMe', token: NEW_TOKEN, timeoutMs: OWNER_ACTION_TIMEOUT },
      { method: 'getWebhook', token: NEW_TOKEN, timeoutMs: OWNER_ACTION_TIMEOUT, ourUrl: url },
      {
        method: 'setWebhook',
        token: NEW_TOKEN,
        timeoutMs: OWNER_ACTION_TIMEOUT,
        webhook: { url, secret, dropPending: true },
      },
    ]);
    expect(JSON.stringify(settings)).not.toContain(NEW_TOKEN);
  });

  it('confirmed takeover → connects', async () => {
    const h = createBotsHarness();
    h.telegram.webhook = 'foreign';
    expect(await h.paste.pasteToken('ws-a', NEW_TOKEN, true)).toMatchObject({
      state: 'connected',
    });
    expect(h.telegram.calls.map((c) => c.method)).toContain('setWebhook');
  });

  it('setWebhook fails → the inserted row is removed, TELEGRAM_UNAVAILABLE', async () => {
    const h = createBotsHarness();
    h.telegram.setResult = 'failed';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows).toHaveLength(0);
  });
});

describe('pasteToken — connect again (AC-19)', () => {
  const kept = botRow({
    state: 'disconnected',
    token: null,
    webhookSecret: null,
    connectedAt: null,
    lastCheckedAt: at(100),
  });

  it('same bot after a disconnect → same row, new capture epoch and secret, pending dropped', async () => {
    const h = createBotsHarness([kept]);
    h.telegram.me = ME;
    await h.paste.pasteToken('ws-a', NEW_TOKEN, false);
    expect(h.bots.rows).toHaveLength(1);
    const row = h.bots.rows[0]!;
    expect(row).toMatchObject({
      id: kept.id,
      state: 'connected',
      token: NEW_TOKEN,
      name: 'Acme Bot',
      connectedAt: at(600),
      lastCheckedAt: at(600),
      createdAt: kept.createdAt,
    });
    const secret = h.secrets.secretFor(kept.id, at(600));
    expect(row.webhookSecret).toBe(secret);
    expect(secret).not.toBe(h.secrets.secretFor(kept.id, at(0)));
    expect(h.telegram.calls.at(-1)!.webhook).toMatchObject({ secret, dropPending: true });
  });

  it('setWebhook fails → the row is disconnected again as before', async () => {
    const h = createBotsHarness([kept]);
    h.telegram.me = ME;
    h.telegram.setResult = 'failed';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows).toEqual([kept]);
  });
});

describe('pasteToken — rotate (AC-17, AC-16, AC-16b)', () => {
  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    'same bot while %s → new token, connected, epoch and secret kept, pending kept',
    async (state) => {
      const h = createBotsHarness([botRow({ state })]);
      h.telegram.me = ME;
      h.telegram.webhook = state === 'taken_over' ? 'foreign' : 'ours';
      const settings = await h.paste.pasteToken('ws-a', NEW_TOKEN, true);
      expect(settings).toMatchObject({ state: 'connected', bot: { name: 'Acme Bot' } });
      expect(h.bots.rows).toHaveLength(1);
      expect(h.bots.rows[0]).toMatchObject({
        id: botRow().id,
        state: 'connected',
        token: NEW_TOKEN,
        name: 'Acme Bot',
        username: 'acme_bot',
        connectedAt: at(0),
        lastCheckedAt: at(600),
        webhookSecret: 'stored-secret',
      });
      expect(h.telegram.calls.at(-1)).toMatchObject({
        method: 'setWebhook',
        token: NEW_TOKEN,
        webhook: {
          url: `${BASE_URL}/api/telegram/webhook/${botRow().id}`,
          secret: h.secrets.secretFor(botRow().id, at(0)),
          dropPending: false,
        },
      });
    },
  );

  it('taken over and not confirmed → confirmation required, nothing changed', async () => {
    const h = createBotsHarness([botRow({ state: 'taken_over' })]);
    h.telegram.webhook = 'foreign';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TakeoverConfirmationRequiredError,
    );
    expect(h.bots.rows).toEqual([botRow({ state: 'taken_over' })]);
  });

  it('setWebhook fails → old token, state and identity restored', async () => {
    const before = botRow({ state: 'needs_token' });
    const h = createBotsHarness([before]);
    h.telegram.me = ME;
    h.telegram.setResult = 'failed';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows).toEqual([before]);
  });

  it('a stored token that cannot be decrypted → the new token is stored and the secret re-derived (ADR-0006)', async () => {
    const h = createBotsHarness([botRow({ state: 'needs_token', undecryptable: true })]);
    h.telegram.me = ME;
    const settings = await h.paste.pasteToken('ws-a', NEW_TOKEN, false);
    expect(settings).toMatchObject({ state: 'connected' });
    expect(h.bots.rows[0]).toMatchObject({
      state: 'connected',
      token: NEW_TOKEN,
      connectedAt: at(0),
      webhookSecret: h.secrets.secretFor(botRow().id, at(0)),
    });
    expect(h.bots.rows[0]?.undecryptable).toBeUndefined();
  });

  it('undecryptable old token and setWebhook fails → needs_token, TELEGRAM_UNAVAILABLE', async () => {
    const h = createBotsHarness([botRow({ state: 'connected', undecryptable: true })]);
    h.telegram.me = ME;
    h.telegram.setResult = 'failed';
    expect(await refusal(h.paste.pasteToken('ws-a', NEW_TOKEN, false))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows[0]).toMatchObject({ state: 'needs_token', name: 'Old Name' });
  });
});
