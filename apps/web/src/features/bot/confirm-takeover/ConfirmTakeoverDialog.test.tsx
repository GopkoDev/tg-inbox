import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BotSettings } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBotStore } from '@/features/bot/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const guard = vi.fn();
vi.mock('@/shared/ui/app-shell-context', () => ({ useShellGuard: () => guard }));

import { ConfirmTakeoverDialog, type TakeoverRequest } from './ConfirmTakeoverDialog';

const bot = { name: 'Acme Flowers Support', username: 'acme_flowers_bot' };
const MESSAGE = 'Connecting will stop this bot delivering messages to another service';
const connected: BotSettings = {
  state: 'connected',
  bot,
  last_checked_at: '2026-10-11T10:00:00.000Z',
  last_message_received_at: null,
  contacts_count: 0,
};
const err = (status: number, code: string, message = code, details?: unknown) =>
  new ApiError(status, code as never, message, details);

const resubmit = vi.fn<() => Promise<BotSettings>>();
const onClose = vi.fn();
const onRefused = vi.fn();

function setup(open = true) {
  const request: TakeoverRequest = { bot, message: MESSAGE, resubmit: () => resubmit() };
  return render(
    <ConfirmTakeoverDialog
      workspaceId="w1"
      request={open ? request : null}
      onClose={onClose}
      onRefused={onRefused}
    />,
  );
}
const connect = () => screen.getByRole('button', { name: 'Connect' });

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  guard.mockRejectedValue(new Error('unhandled'));
  useBotStore.getState().clear();
});

describe('ConfirmTakeoverDialog (SCR-04)', () => {
  it('default: «Take over @username?», the server message + advice, Cancel and a destructive Connect', () => {
    setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Take over @acme_flowers_bot?' });
    expect(dialog).toHaveTextContent(MESSAGE);
    expect(dialog).toHaveTextContent('Only do this if you no longer use that service.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(connect()).toHaveAttribute('data-variant', 'destructive');
  });

  it('closed: renders nothing', () => {
    setup(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancelled: no request, closes', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(resubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('submitting: buttons disabled with a spinner; a second click sends nothing; Esc ignored', async () => {
    let resolve!: (s: BotSettings) => void;
    resubmit.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    fireEvent.click(connect());
    fireEvent.click(connect());
    expect(resubmit).toHaveBeenCalledTimes(1);
    expect(connect()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('takeover-spinner')).toBeInTheDocument();
    fireEvent.keyDown(connect(), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(connected));
  });

  it('success: store replaced and the dialog closes (AC-06)', async () => {
    resubmit.mockResolvedValue(connected);
    setup();
    fireEvent.click(connect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().settings).toEqual(connected);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'BOT_TOKEN_INVALID'],
    [409, 'BOT_BELONGS_TO_ANOTHER_WORKSPACE'],
    [409, 'WORKSPACE_KEEPS_ONE_BOT'],
    [409, 'BOT_NEEDS_NEW_TOKEN'],
    [409, 'NOTHING_TO_RECONNECT'],
  ])('refused on re-check (%s %s): closes and hands the refusal back', async (status, code) => {
    resubmit.mockRejectedValue(err(status, code, `msg ${code}`));
    setup();
    fireEvent.click(connect());
    await waitFor(() => expect(onRefused).toHaveBeenCalled());
    expect(onRefused.mock.calls[0]![0]).toMatchObject({ code, message: `msg ${code}` });
    expect(onClose).toHaveBeenCalled();
  });

  it('Telegram unavailable: alert in the dialog, Connect enabled again, stays open', async () => {
    resubmit.mockRejectedValue(
      err(503, 'TELEGRAM_UNAVAILABLE', 'Telegram is not responding — try again'),
    );
    setup();
    fireEvent.click(connect());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Telegram is not responding — try again',
    );
    expect(connect()).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('owners only: the page turns into the refusal and the dialog closes', async () => {
    resubmit.mockRejectedValue(err(403, 'OWNER_ONLY', 'Only business owners manage the bot'));
    setup();
    fireEvent.click(connect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useBotStore.getState().status).toBe('owners_only');
  });

  it('guard states: a 404 goes through the shell guard → not found, dialog closes', async () => {
    guard.mockResolvedValue('not-found');
    const failure = err(404, 'NOT_FOUND');
    resubmit.mockRejectedValue(failure);
    setup();
    fireEvent.click(connect());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(guard).toHaveBeenCalledWith(failure, 'w1');
    expect(useBotStore.getState().status).toBe('not_found');
  });

  it('unexpected: alert «Something went wrong — try again», stays open', async () => {
    resubmit.mockRejectedValue(new Error('network'));
    setup();
    fireEvent.click(connect());
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong — try again');
    expect(onClose).not.toHaveBeenCalled();
    expect(connect()).toBeEnabled();
  });
});
