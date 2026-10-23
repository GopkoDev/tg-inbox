import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type IssuedConnectLink, type NotificationSettings } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  createConnectLink: vi.fn(),
  disconnectTelegram: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getNotificationSettings: (...a: unknown[]) => api.getNotificationSettings(...a),
  createConnectLink: (...a: unknown[]) => api.createConnectLink(...a),
  disconnectTelegram: (...a: unknown[]) => api.disconnectTelegram(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: Record<string, (...a: never[]) => void> }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (workspaceId: string, subscriber: Record<string, (...a: never[]) => void>) => {
    const entry = { workspaceId, subscriber };
    live.subs.push(entry);
    return () => {
      live.subs = live.subs.filter((e) => e !== entry);
    };
  },
  liveStatus: () => 'idle',
}));

import { formatBotClock, formatBotDay } from '@/features/bot/settings/format';
import { useNotificationsStore } from './store';
import { TelegramPingsCard } from './TelegramPingsCard';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const bot = (state = 'connected') =>
  ({
    workspace_id: WS,
    state,
    can_reply: state !== 'needs_token' && state !== 'not_connected',
    receiving: state === 'connected',
  }) as NotificationSettings['bot'];
const notConnected = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({
  workspace_id: WS,
  caller_role: 'operator',
  bot: bot(),
  telegram: { state: 'not_connected' },
  can_connect: true,
  ...over,
});
const connected = (
  pings: 'on' | 'paused' | 'not_reachable' = 'on',
  over: Partial<NotificationSettings> = {},
  name = 'Test User',
): NotificationSettings => ({
  workspace_id: WS,
  caller_role: 'operator',
  bot: bot(pings === 'paused' ? 'needs_token' : 'connected'),
  telegram: {
    state: 'connected',
    display_name: name,
    linked_at: '2026-10-19T09:12:00.000Z',
    blocked_at: pings === 'not_reachable' ? '2026-10-19T14:40:05.000Z' : null,
    pings,
  },
  can_connect: false,
  ...over,
});
const link: IssuedConnectLink = {
  workspace_id: WS,
  bot_username: 'acme_bot',
  url: `https://t.me/acme_bot?start=tgi_${'A'.repeat(43)}`,
  expires_at: '2026-10-19T09:22:00.000Z',
};
const refusal = (code: ErrorCode, details: unknown, status = 409) =>
  new ApiError(status, code, 'refused', details);

const guard = vi.fn();
function renderCard() {
  return render(
    <MemoryRouter>
      <ShellGuardContext.Provider value={guard}>
        <TelegramPingsCard workspaceId={WS} workspaceName="Acme Flowers" />
      </ShellGuardContext.Provider>
    </MemoryRouter>,
  );
}
const frame = (type: string) =>
  act(() => {
    for (const { subscriber } of live.subs)
      (subscriber.onFrame as (f: unknown) => void)({ v: 1, workspace_id: WS, type });
  });

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  useNotificationsStore.getState().clear();
  api.getNotificationSettings.mockResolvedValue(notConnected());
});
afterEach(() => vi.useRealTimers());

describe('TelegramPingsCard (SCR-16)', () => {
  it('loading: the title and a skeleton for the status line and the button', () => {
    api.getNotificationSettings.mockReturnValue(new Promise(() => undefined));
    renderCard();
    expect(screen.getByText('Telegram pings')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-pings-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('not connected: badge, the explanation naming the workspace and Connect Telegram', async () => {
    renderCard();
    const connect = await screen.findByRole('button', { name: 'Connect Telegram' });
    expect(connect).toBeEnabled();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Get a message from the Acme Flowers bot in your own Telegram when a customer has waited 5 minutes and you're away from the panel. Pings never include the customer's message or name.",
      ),
    ).toBeInTheDocument();
    expect(api.getNotificationSettings).toHaveBeenCalledTimes(1);
    expect(api.getNotificationSettings.mock.calls[0]![0]).toBe(WS);
  });

  it('connecting: a spinner, the button disabled, then SCR-17 opens with the issued link', async () => {
    // The fixture link expires at 09:22 — pin the clock before it, or the dialog opens expired.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-19T09:16:00.000Z') });
    renderCard();
    let issue!: (l: IssuedConnectLink) => void;
    api.createConnectLink.mockReturnValue(new Promise((r) => (issue = r)));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    const busy = await screen.findByRole('button', { name: /Connect Telegram/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(api.createConnectLink).toHaveBeenCalledWith(WS);
    await act(async () => issue(link));
    expect(await screen.findByRole('dialog')).toHaveTextContent(link.url);
  });

  it('no working bot for an operator: asks a business owner, no button at all', async () => {
    api.getNotificationSettings.mockResolvedValue(
      notConnected({ can_connect: false, bot: bot('taken_over') }),
    );
    renderCard();
    expect(
      await screen.findByText(
        'Telegram pings need a working bot that receives messages. Ask a business owner to fix the bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('no working bot for an owner: Open bot settings leads to the bot settings', async () => {
    api.getNotificationSettings.mockResolvedValue(
      notConnected({ can_connect: false, caller_role: 'owner', bot: bot('needs_token') }),
    );
    renderCard();
    const open = await screen.findByRole('link', { name: 'Open bot settings' });
    expect(open).toHaveAttribute('href', `/w/${WS}/settings/bot`);
    expect(
      screen.getByText('Telegram pings need a working bot that receives messages.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ask a business owner/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument();
  });

  it('connected: name and since when, the reassurance, Disconnect only, never a connect link', async () => {
    api.getNotificationSettings.mockResolvedValue(connected());
    renderCard();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    const since = `${formatBotDay('2026-10-19T09:12:00.000Z')}, ${formatBotClock('2026-10-19T09:12:00.000Z')}`;
    expect(screen.getByText(`Connected as Test User since ${since}.`)).toBeInTheDocument();
    expect(
      screen.getByText(
        "You'll get a ping in Telegram when customers wait and you're away from the panel.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Connect Telegram/ })).not.toBeInTheDocument();
  });

  it('renders a display name with markup as plain text', async () => {
    api.getNotificationSettings.mockResolvedValue(
      connected('on', {}, '<img src=x onerror=alert(1)> *Bob*'),
    );
    const { container } = renderCard();
    expect(
      await screen.findByText(/Connected as <img src=x onerror=alert\(1\)> \*Bob\* since/),
    ).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('pings paused for an operator: the explanation and who to ask, Disconnect stays', async () => {
    api.getNotificationSettings.mockResolvedValue(connected('paused'));
    renderCard();
    expect(await screen.findByText('Pings paused')).toBeInTheDocument();
    expect(
      screen.getByText('Pings paused — the bot is not working. They start again when it works.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ask a business owner to fix the bot.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open bot settings' })).not.toBeInTheDocument();
  });

  it('pings paused for an owner: Open bot settings, Disconnect stays', async () => {
    api.getNotificationSettings.mockResolvedValue(connected('paused', { caller_role: 'owner' }));
    renderCard();
    expect(await screen.findByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/bot`,
    );
    expect(screen.queryByText('Ask a business owner to fix the bot.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('not reachable: blocked-the-bot text with a destructive badge, Disconnect', async () => {
    api.getNotificationSettings.mockResolvedValue(connected('not_reachable'));
    renderCard();
    const badge = await screen.findByText('Not reachable');
    expect(badge).toHaveAttribute('data-variant', 'destructive');
    expect(
      screen.getByText(
        'Not reachable — you blocked the bot in Telegram. Unblock it, or disconnect.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('a connected member with a taken-over bot sees plain Connected (flow 18)', async () => {
    api.getNotificationSettings.mockResolvedValue(connected('on', { bot: bot('taken_over') }));
    renderCard();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText(/paused/i)).not.toBeInTheDocument();
  });

  it('disconnecting: no confirmation, a spinner, both actions disabled, then Not connected at once', async () => {
    api.getNotificationSettings.mockResolvedValue(connected());
    renderCard();
    let done!: (s: NotificationSettings) => void;
    api.disconnectTelegram.mockReturnValue(new Promise((r) => (done = r)));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const busy = await screen.findByRole('button', { name: /Disconnect/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(api.disconnectTelegram).toHaveBeenCalledWith(WS);
    await act(async () => done(notConnected()));
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeEnabled();
  });

  it('disconnected with the bot not working: the no-working-bot state', async () => {
    api.getNotificationSettings.mockResolvedValue(connected('paused'));
    renderCard();
    api.disconnectTelegram.mockResolvedValue(
      notConnected({ can_connect: false, bot: bot('needs_token') }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(
      await screen.findByText(/Telegram pings need a working bot that receives messages/),
    ).toBeInTheDocument();
  });

  it('link limit: the alert with the clock time, Connect disabled until retry_at, then enabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-19T09:16:00.000Z') });
    renderCard();
    const retryAt = '2026-10-19T09:26:00.000Z';
    api.createConnectLink.mockRejectedValue(
      refusal(
        ErrorCode.CONNECT_LINK_LIMIT_REACHED,
        { limit: 5, window_seconds: 600, retry_at: retryAt },
        429,
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect(
      await screen.findByText(
        `Connect links are limited to 5 per 10 minutes — try again at ${formatBotClock(retryAt)}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9 * 60_000);
    });
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 10);
    });
    expect(screen.queryByText(/Connect links are limited/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeEnabled();
  });

  it('409 already linked: re-renders as connected from the answer, with the alert', async () => {
    renderCard();
    api.createConnectLink.mockRejectedValue(
      refusal(ErrorCode.TELEGRAM_ALREADY_LINKED, { settings: connected() }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect(
      await screen.findByText(
        "You're already connected — disconnect first to connect another Telegram account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Telegram/ })).not.toBeInTheDocument();
  });

  it('the already-connected alert goes with the next re-read', async () => {
    renderCard();
    api.createConnectLink.mockRejectedValue(
      refusal(ErrorCode.TELEGRAM_ALREADY_LINKED, { settings: connected() }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    await screen.findByText(/You're already connected/);
    api.getNotificationSettings.mockResolvedValue(connected());
    frame('telegram_link.changed');
    await waitFor(() =>
      expect(screen.queryByText(/You're already connected/)).not.toBeInTheDocument(),
    );
  });

  it('409 no working bot: re-renders as the no-working-bot state from the answer', async () => {
    renderCard();
    api.createConnectLink.mockRejectedValue(
      refusal(ErrorCode.PINGS_NEED_WORKING_BOT, {
        settings: notConnected({
          can_connect: false,
          caller_role: 'owner',
          bot: bot('needs_token'),
        }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect(await screen.findByRole('link', { name: 'Open bot settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument();
  });

  it('action failed on connect: a destructive alert, buttons enabled, the state kept', async () => {
    renderCard();
    api.createConnectLink.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't create a connect link — try again.");
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeEnabled();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('action failed on disconnect: its own alert, Disconnect enabled, still connected', async () => {
    api.getNotificationSettings.mockResolvedValue(connected());
    renderCard();
    api.disconnectTelegram.mockRejectedValue(new Error('network'));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't disconnect — try again.");
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('not loaded: an alert with Retry inside the card; Retry reads again', async () => {
    api.getNotificationSettings.mockRejectedValueOnce(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'),
    );
    renderCard();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your Telegram settings");
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([['telegram_link.changed'], ['bot.changed'], ['resync']])(
    'live: a %s frame re-reads and the card switches state without a reload',
    async (type) => {
      renderCard();
      await screen.findByRole('button', { name: 'Connect Telegram' });
      api.getNotificationSettings.mockResolvedValue(connected());
      frame(type);
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(screen.getByText(/Connected as Test User/)).toBeInTheDocument();
      expect(api.getNotificationSettings).toHaveBeenLastCalledWith(WS, { background: true });
    },
  );

  it('live: Not reachable and back to Connected; Pings paused and back', async () => {
    api.getNotificationSettings.mockResolvedValue(connected());
    renderCard();
    await screen.findByText('Connected');
    api.getNotificationSettings.mockResolvedValue(connected('not_reachable'));
    frame('telegram_link.changed');
    expect(await screen.findByText('Not reachable')).toBeInTheDocument();
    api.getNotificationSettings.mockResolvedValue(connected('paused'));
    frame('bot.changed');
    expect(await screen.findByText('Pings paused')).toBeInTheDocument();
    api.getNotificationSettings.mockResolvedValue(connected());
    frame('bot.changed');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('live: a frame of another workspace and other frame types are ignored', async () => {
    renderCard();
    await screen.findByRole('button', { name: 'Connect Telegram' });
    api.getNotificationSettings.mockClear();
    act(() => {
      for (const { subscriber } of live.subs) {
        const onFrame = subscriber.onFrame as (f: unknown) => void;
        onFrame({ v: 1, workspace_id: '0198f0c0-0000-7000-8000-000000000002', type: 'resync' });
        onFrame({
          v: 1,
          workspace_id: WS,
          type: 'conversation.changed',
          conversation_id: WS,
          item: null,
          change: 'read',
        });
      }
    });
    expect(api.getNotificationSettings).not.toHaveBeenCalled();
  });

  it('live: a reconnect re-reads too, and a failed background re-read keeps the state with no error', async () => {
    api.getNotificationSettings.mockResolvedValue(connected());
    renderCard();
    await screen.findByText('Connected');
    api.getNotificationSettings.mockRejectedValue(new Error('network'));
    act(() => {
      for (const { subscriber } of live.subs) (subscriber.onReconnected as () => void)();
    });
    await waitFor(() => expect(api.getNotificationSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops listening when the card goes away', async () => {
    const { unmount } = renderCard();
    await screen.findByRole('button', { name: 'Connect Telegram' });
    expect(live.subs).toHaveLength(1);
    unmount();
    expect(live.subs).toHaveLength(0);
  });

  it('guard answers go to the shell guard: a 401 on load', async () => {
    const unauth = new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x');
    api.getNotificationSettings.mockRejectedValue(unauth);
    renderCard();
    await waitFor(() => expect(guard).toHaveBeenCalledWith(unauth, WS));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('guard answers: a 404 shows the not-found card', async () => {
    guard.mockResolvedValue('not-found');
    api.getNotificationSettings.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    renderCard();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('phone: the buttons go full width under their text', async () => {
    renderCard();
    expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toHaveClass('w-full');
  });

  describe('focus after SCR-17 closes (W5)', () => {
    const openDialog = async () => {
      renderCard();
      api.createConnectLink.mockResolvedValue(link);
      fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
      await screen.findByRole('dialog');
    };

    it('connected while the dialog was open: Done moves focus to Disconnect, not the page body', async () => {
      await openDialog();
      api.getNotificationSettings.mockResolvedValue(connected());
      frame('telegram_link.changed');
      fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toHaveFocus());
    });

    it('the bot stopped while the dialog was open: Close moves focus to the card heading', async () => {
      await openDialog();
      api.getNotificationSettings.mockResolvedValue(
        notConnected({ can_connect: false, bot: bot('taken_over') }),
      );
      frame('bot.changed');
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).queryByText(link.url)).not.toBeInTheDocument());
      fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Telegram pings' })).toHaveFocus(),
      );
    });

    it('still not connected: Close returns focus to Connect Telegram', async () => {
      await openDialog();
      fireEvent.click(
        within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).at(-1)!,
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Connect Telegram' })).toHaveFocus(),
      );
    });
  });

  describe('access removed (AC-12, W3)', () => {
    const removed = () => new ApiError(403, ErrorCode.ACCESS_REMOVED, 'gone');

    it('a 403 ACCESS_REMOVED on load goes to the shell guard and shows no link state', async () => {
      const refusal = removed();
      api.getNotificationSettings.mockRejectedValue(refusal);
      renderCard();
      await waitFor(() => expect(guard).toHaveBeenCalledWith(refusal, WS));
      expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
      expect(screen.queryByText('Connected')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    });

    it('a 403 ACCESS_REMOVED on Connect goes to the guard and opens no dialog', async () => {
      renderCard();
      const refusal = removed();
      api.createConnectLink.mockRejectedValue(refusal);
      fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
      await waitFor(() => expect(guard).toHaveBeenCalledWith(refusal, WS));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't create a connect link/)).not.toBeInTheDocument();
    });
  });
});
