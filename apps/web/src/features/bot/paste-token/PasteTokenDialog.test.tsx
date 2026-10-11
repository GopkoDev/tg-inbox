import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BotSettings } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBotStore } from '@/features/bot/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const pasteBotToken = vi.fn();
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  pasteBotToken: (w: string, b: unknown) => pasteBotToken(w, b),
}));
const guard = vi.fn();
vi.mock('@/shared/ui/app-shell-context', () => ({ useShellGuard: () => guard }));

import { PasteTokenDialog } from './PasteTokenDialog';

const TOKEN = '100000001:TEST-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bot = { name: 'Acme Flowers Support', username: 'acme_flowers_bot' };
const connected: BotSettings = {
  state: 'connected',
  bot,
  last_checked_at: '2026-10-11T10:00:00.000Z',
  last_message_received_at: null,
  contacts_count: 0,
};
const err = (status: number, code: string, message = code, details?: unknown) =>
  new ApiError(status, code as never, message, details);

const onClose = vi.fn();
const onTakeover = vi.fn();

function setup(o: { mode?: 'connect' | 'new'; notice?: string | null; open?: boolean } = {}) {
  const ui = (open: boolean) => (
    <PasteTokenDialog
      workspaceId="w1"
      open={open}
      mode={o.mode ?? 'connect'}
      notice={o.notice ?? null}
      onClose={onClose}
      onTakeover={onTakeover}
    />
  );
  const view = render(ui(o.open ?? true));
  return { ...view, setOpen: (open: boolean) => view.rerender(ui(open)) };
}
const field = () => screen.getByLabelText('Bot token');
const typeToken = (value: string) => fireEvent.change(field(), { target: { value } });
const submit = (name: 'Connect' | 'Save token' = 'Connect') =>
  fireEvent.click(screen.getByRole('button', { name }));

/** The token must never reach the bot store, in any field. */
function expectTokenNotInStore() {
  expect(JSON.stringify(useBotStore.getState())).not.toContain(TOKEN);
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  guard.mockRejectedValue(new Error('unhandled'));
  useBotStore.getState().clear();
});

describe('PasteTokenDialog (SCR-03)', () => {
  it('default (connect): title, hint, plain-text field without autocomplete, Cancel + Connect', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Connect bot' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Open @BotFather in Telegram → /mybots → your bot → API Token, copy it and paste it here',
      ),
    ).toBeInTheDocument();
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveAttribute('autocomplete', 'off');
    expect(field()).toHaveAttribute('spellcheck', 'false');
    expect(field()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('default (new token): title New token and Save token', () => {
    setup({ mode: 'new' });
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save token' })).toBeInTheDocument();
  });

  it('needs-token notice: the server message above the field', () => {
    const message = "The bot's token no longer works — paste a new token from BotFather";
    setup({ mode: 'new', notice: message });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('validation: empty after trimming → field error, no request', () => {
    setup();
    typeToken('   ');
    submit();
    expect(screen.getByText('Paste the token from BotFather')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription('Paste the token from BotFather');
    expect(pasteBotToken).not.toHaveBeenCalled();
  });

  it('validation: over 512 characters is blocked client-side', () => {
    setup();
    typeToken('x'.repeat(513));
    submit();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(pasteBotToken).not.toHaveBeenCalled();
  });

  it('validation: a server VALIDATION_ERROR shows its message under the field', async () => {
    pasteBotToken.mockRejectedValue(err(400, 'VALIDATION_ERROR', 'body/token must be string'));
    setup();
    typeToken(TOKEN);
    submit();
    expect(await screen.findByText('body/token must be string')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('submitting: field and buttons disabled with a spinner; Esc is ignored', async () => {
    let resolve!: (s: BotSettings) => void;
    pasteBotToken.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    typeToken(`  ${TOKEN} `);
    submit();
    expect(pasteBotToken).toHaveBeenCalledWith('w1', {
      token: `  ${TOKEN} `,
      confirm_takeover: false,
    });
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('paste-spinner')).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(connected));
  });

  it('success: store replaced, dialog closes, token cleared and never in the store (AC-01)', async () => {
    pasteBotToken.mockResolvedValue(connected);
    const { setOpen } = setup();
    typeToken(TOKEN);
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().settings).toEqual(connected);
    expectTokenNotInStore();
    setOpen(false);
    setOpen(true);
    expect(field()).toHaveValue('');
  });

  it.each([
    [
      'token not valid',
      400,
      'BOT_TOKEN_INVALID',
      'The token is not valid — copy it again from BotFather',
      undefined,
    ],
    [
      'another workspace',
      409,
      'BOT_BELONGS_TO_ANOTHER_WORKSPACE',
      'This bot already belongs to another workspace',
      undefined,
    ],
    [
      'one bot — connected',
      409,
      'WORKSPACE_KEEPS_ONE_BOT',
      'A workspace keeps one business bot — disconnect the current bot first',
      { reason: 'connected' },
    ],
    [
      'one bot — history',
      409,
      'WORKSPACE_KEEPS_ONE_BOT',
      'A workspace keeps one business bot — your customers know only the bot they wrote to',
      { reason: 'history' },
    ],
  ])(
    'error: %s → alert with the server message, field cleared',
    async (_c, status, code, message, details) => {
      pasteBotToken.mockRejectedValue(err(status, code, message, details));
      setup();
      typeToken(TOKEN);
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(field()).toHaveValue('');
      expect(onClose).not.toHaveBeenCalled();
      expectTokenNotInStore();
    },
  );

  it('error: token not valid also focuses the field (AC-02)', async () => {
    pasteBotToken.mockRejectedValue(
      err(400, 'BOT_TOKEN_INVALID', 'The token is not valid — copy it again from BotFather'),
    );
    setup();
    typeToken(TOKEN);
    submit();
    await screen.findByRole('alert');
    await waitFor(() => expect(field()).toHaveFocus());
  });

  it.each([
    [
      'Telegram unavailable',
      err(503, 'TELEGRAM_UNAVAILABLE', 'Telegram is not responding — try again'),
      'Telegram is not responding — try again',
    ],
    ['unexpected', new Error('network'), 'Something went wrong — try again'],
    [
      'payload too large',
      err(413, 'PAYLOAD_TOO_LARGE', 'too large'),
      'Something went wrong — try again',
    ],
  ])('error: %s → alert, the token stays for another try', async (_c, error, text) => {
    pasteBotToken.mockRejectedValue(error);
    setup();
    typeToken(TOKEN);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(field()).toHaveValue(TOKEN);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('takeover warning: hands { token, bot } to SCR-04 and closes; nothing in the store (AC-06)', async () => {
    pasteBotToken.mockRejectedValue(
      err(409, 'TAKEOVER_CONFIRMATION_REQUIRED', 'Connecting will stop…', { bot }),
    );
    setup();
    typeToken(TOKEN);
    submit();
    await waitFor(() => expect(onTakeover).toHaveBeenCalledWith({ token: TOKEN, bot }));
    expect(onClose).toHaveBeenCalled();
    expectTokenNotInStore();
  });

  it('cancelled: Cancel closes; reopening shows an empty field', () => {
    const { setOpen } = setup();
    typeToken(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    setOpen(false);
    setOpen(true);
    expect(field()).toHaveValue('');
  });

  it('cancelled: Esc closes when not submitting', () => {
    setup();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('owners only: the dialog closes and SCR-02 shows owners only', async () => {
    pasteBotToken.mockRejectedValue(err(403, 'OWNER_ONLY', 'Only business owners manage the bot'));
    setup();
    typeToken(TOKEN);
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().status).toBe('owners_only');
  });

  it('guard states: handled by the shared guard, the token is dropped', async () => {
    const removed = err(403, 'ACCESS_REMOVED');
    pasteBotToken.mockRejectedValue(removed);
    guard.mockResolvedValue('handled');
    setup();
    typeToken(TOKEN);
    submit();
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, 'w1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('guard not-found: closes and SCR-02 renders not found', async () => {
    pasteBotToken.mockRejectedValue(err(404, 'NOT_FOUND'));
    guard.mockResolvedValue('not-found');
    setup();
    typeToken(TOKEN);
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().status).toBe('not_found');
  });
});
