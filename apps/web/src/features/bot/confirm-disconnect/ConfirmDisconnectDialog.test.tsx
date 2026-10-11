import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BotSettings } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBotStore } from '@/features/bot/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const disconnectBot = vi.fn();
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  disconnectBot: (w: string) => disconnectBot(w),
}));
const guard = vi.fn();
vi.mock('@/shared/ui/app-shell-context', () => ({ useShellGuard: () => guard }));

import { ConfirmDisconnectDialog } from './ConfirmDisconnectDialog';

const bot = { name: 'Acme Flowers Support', username: 'acme_flowers_bot' };
const connected: BotSettings = {
  state: 'connected',
  bot,
  last_checked_at: '2026-10-11T10:00:00.000Z',
  last_message_received_at: null,
  contacts_count: 3,
};
const err = (status: number, code: string, message = code, details?: unknown) =>
  new ApiError(status, code as never, message, details);
const onClose = vi.fn();

function setup(open = true) {
  return render(
    <ConfirmDisconnectDialog workspaceId="w1" bot={open ? bot : null} onClose={onClose} />,
  );
}
const disconnect = () => screen.getByRole('button', { name: 'Disconnect' });

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  guard.mockRejectedValue(new Error('unhandled'));
  useBotStore.getState().clear();
  useBotStore.getState().replace(connected);
});

describe('ConfirmDisconnectDialog (SCR-05)', () => {
  it('default: «Disconnect @username?», what happens, Cancel and a destructive Disconnect', () => {
    setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Disconnect @acme_flowers_bot?' });
    expect(dialog).toHaveTextContent(
      'Messages sent to the bot from now on will never reach tg-inbox. tg-inbox forgets the token. Contacts and conversations captured so far stay.',
    );
    expect(disconnect()).toHaveAttribute('data-variant', 'destructive');
  });

  it('closed: renders nothing', () => {
    setup(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancelled: no request', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(disconnectBot).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('submitting: buttons disabled with a spinner; one request for two clicks', async () => {
    let resolve!: (s: BotSettings) => void;
    disconnectBot.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    fireEvent.click(disconnect());
    fireEvent.click(disconnect());
    expect(disconnectBot).toHaveBeenCalledTimes(1);
    expect(disconnectBot).toHaveBeenCalledWith('w1');
    expect(disconnect()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('disconnect-spinner')).toBeInTheDocument();
    await act(async () => resolve({ state: 'not_connected' }));
  });

  it('success: store ← not connected, the dialog closes (AC-18)', async () => {
    disconnectBot.mockResolvedValue({ state: 'not_connected' });
    setup();
    fireEvent.click(disconnect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().settings).toEqual({ state: 'not_connected' });
  });

  it('Telegram unavailable: alert in the dialog, bot still connected, Disconnect enabled', async () => {
    disconnectBot.mockRejectedValue(
      err(503, 'TELEGRAM_UNAVAILABLE', 'Telegram is not responding — try again'),
    );
    setup();
    fireEvent.click(disconnect());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Telegram is not responding — try again',
    );
    expect(disconnect()).toBeEnabled();
    expect(useBotStore.getState().settings).toEqual(connected);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('no bot connected: closes, store ← details.settings with the server message as notice', async () => {
    disconnectBot.mockRejectedValue(
      err(409, 'NO_BOT_CONNECTED', 'No bot is connected', {
        settings: { state: 'not_connected' },
      }),
    );
    setup();
    fireEvent.click(disconnect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().settings).toEqual({ state: 'not_connected' });
    expect(useBotStore.getState().notice).toEqual({ tone: 'info', text: 'No bot is connected' });
  });

  it('owners only → SCR-02 «owners only»', async () => {
    disconnectBot.mockRejectedValue(err(403, 'OWNER_ONLY', 'Only business owners manage the bot'));
    setup();
    fireEvent.click(disconnect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().status).toBe('owners_only');
  });

  it('guard states: 401 / ACCESS_REMOVED / 404 go to the shell guard and close', async () => {
    guard.mockResolvedValue('handled');
    const failure = err(401, 'UNAUTHENTICATED');
    disconnectBot.mockRejectedValue(failure);
    setup();
    fireEvent.click(disconnect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(guard).toHaveBeenCalledWith(failure, 'w1');
  });

  it.each([
    ['network', new Error('network')],
    ['400', err(400, 'VALIDATION_ERROR')],
    ['500', err(500, 'INTERNAL_ERROR')],
  ])('unexpected (%s): alert «Something went wrong — try again»', async (_c, failure) => {
    disconnectBot.mockRejectedValue(failure);
    setup();
    fireEvent.click(disconnect());
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong — try again');
    expect(onClose).not.toHaveBeenCalled();
    expect(useBotStore.getState().settings).toEqual(connected);
  });
});
