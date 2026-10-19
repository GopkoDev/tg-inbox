import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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
  subs: [] as { subscriber: Record<string, (...a: never[]) => void> }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, subscriber: Record<string, (...a: never[]) => void>) => {
    const entry = { subscriber };
    live.subs.push(entry);
    return () => {
      live.subs = live.subs.filter((e) => e !== entry);
    };
  },
  liveStatus: () => 'idle',
}));

import { formatBotClock } from '@/features/bot/settings/format';
import { useNotificationsStore } from './store';
import { TelegramPingsCard } from './TelegramPingsCard';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const bot = (state = 'connected') =>
  ({
    workspace_id: WS,
    state,
    can_reply: state !== 'needs_token',
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
const connected = (): NotificationSettings => ({
  workspace_id: WS,
  caller_role: 'operator',
  bot: bot(),
  telegram: {
    state: 'connected',
    display_name: 'Test User',
    linked_at: '2026-10-19T09:15:00.000Z',
    blocked_at: null,
    pings: 'on',
  },
  can_connect: false,
});
const NOW = new Date('2026-10-19T09:12:00.000Z');
const issued = (n: number, expires = '2026-10-19T09:22:00.000Z'): IssuedConnectLink => ({
  workspace_id: WS,
  bot_username: 'acme_bot',
  url: `https://t.me/acme_bot?start=tgi_${String(n).repeat(43)}`,
  expires_at: expires,
});
const refusal = (code: ErrorCode, details: unknown, status = 409) =>
  new ApiError(status, code, 'refused', details);

const guard = vi.fn();
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function renderCard() {
  return render(
    <MemoryRouter initialEntries={[`/w/${WS}/settings/notifications`]}>
      <ShellGuardContext.Provider value={guard}>
        <TelegramPingsCard workspaceId={WS} workspaceName="Acme Flowers" />
        <Where />
      </ShellGuardContext.Provider>
    </MemoryRouter>,
  );
}
const dialog = () => screen.getByRole('dialog');
const footerButton = (name: string) => {
  const matches = within(dialog()).getAllByRole('button', { name });
  return matches[matches.length - 1]!;
};
async function openDialog(link = issued(1)) {
  api.createConnectLink.mockResolvedValueOnce(link);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
  await screen.findByRole('dialog');
}
const frame = (type: string) =>
  act(() => {
    for (const { subscriber } of live.subs)
      (subscriber.onFrame as (f: unknown) => void)({ v: 1, workspace_id: WS, type });
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const writeText = vi.fn();
beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  live.subs = [];
  guard.mockResolvedValue('handled');
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  useNotificationsStore.getState().clear();
  api.getNotificationSettings.mockResolvedValue(notConnected());
});
afterEach(() => vi.useRealTimers());

describe('ConnectTelegramDialog (SCR-17)', () => {
  it('opens only on a 201: waiting for Start with the sentence, Open in Telegram and the link', async () => {
    renderCard();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openDialog();
    expect(within(dialog()).getByRole('heading', { name: 'Connect Telegram' })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      'Open the link in Telegram, then press Start in the chat with @acme_bot.',
    );
    const open = within(dialog()).getByRole('link', { name: 'Open in Telegram' });
    expect(open).toHaveAttribute('href', issued(1).url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      `This link works once, until ${formatBotClock('2026-10-19T09:22:00.000Z')}.`,
    );
    expect(dialog()).toHaveTextContent('Waiting for you to press Start in Telegram…');
    expect(within(dialog()).getByRole('button', { name: 'Get a new link' })).toBeEnabled();
    expect(footerButton('Close')).toBeInTheDocument();
  });

  it('has no scannable code: no image, canvas or svg code in the dialog', async () => {
    renderCard();
    await openDialog();
    expect(dialog().querySelector('canvas, img')).toBeNull();
    expect(within(dialog()).queryByRole('img')).not.toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent(/qr|scan/i);
  });

  it('does not open for a refusal on the card (the card shows it)', async () => {
    renderCard();
    api.createConnectLink.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Copy writes the link, reads Copied for 2 s, then Copy again', async () => {
    renderCard();
    await openDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(issued(1).url));
    expect(await within(dialog()).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await advance(2100);
    expect(within(dialog()).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('a clipboard that refuses hides Copy; the link stays selectable', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderCard();
    await openDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(within(dialog()).queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument(),
    );
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
  });

  it('no clipboard API: Copy is not offered', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    renderCard();
    await openDialog();
    expect(within(dialog()).queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
  });

  it('connected live: the link and its buttons give way to the name and Done only', async () => {
    renderCard();
    await openDialog();
    api.getNotificationSettings.mockResolvedValue(connected());
    frame('telegram_link.changed');
    expect(await within(dialog()).findByText('Connected as Test User.')).toBeInTheDocument();
    expect(dialog()).toHaveTextContent('The Acme Flowers bot sent you a message in Telegram.');
    expect(within(dialog()).queryByText(issued(1).url)).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('link', { name: 'Open in Telegram' }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: /Copy|new link/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('a display name with markup is plain text in the dialog too', async () => {
    renderCard();
    await openDialog();
    const settings = connected();
    if (settings.telegram.state === 'connected') settings.telegram.display_name = '<b>Bob</b>';
    api.getNotificationSettings.mockResolvedValue(settings);
    frame('telegram_link.changed');
    expect(await within(dialog()).findByText('Connected as <b>Bob</b>.')).toBeInTheDocument();
    expect(dialog().querySelector('b')).toBeNull();
  });

  it('expired: link and buttons hidden, the message, Get a new link becomes primary', async () => {
    renderCard();
    await openDialog(issued(1, '2026-10-19T09:22:00.000Z'));
    await advance(9 * 60_000 + 59_000);
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
    await advance(1_100);
    expect(within(dialog()).getByText('This link has expired.')).toBeInTheDocument();
    expect(within(dialog()).queryByText(issued(1).url)).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('link', { name: 'Open in Telegram' }),
    ).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent('Waiting for you');
    const renew = within(dialog()).getByRole('button', { name: 'Get a new link' });
    expect(renew).toHaveAttribute('data-variant', 'default');
  });

  it('an already expired link (clock ahead) opens as expired', async () => {
    renderCard();
    await openDialog(issued(1, '2026-10-19T09:00:00.000Z'));
    expect(within(dialog()).getByText('This link has expired.')).toBeInTheDocument();
  });

  it('getting a new link: a spinner on it, the current link stays; then the link and expiry are replaced', async () => {
    renderCard();
    await openDialog();
    let next!: (l: IssuedConnectLink) => void;
    api.createConnectLink.mockReturnValueOnce(new Promise((r) => (next = r)));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    const busy = await within(dialog()).findByRole('button', { name: 'Get a new link' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
    await act(async () => next(issued(2, '2026-10-19T09:30:00.000Z')));
    expect(within(dialog()).getByText(issued(2).url)).toBeInTheDocument();
    expect(within(dialog()).queryByText(issued(1).url)).not.toBeInTheDocument();
    expect(dialog()).toHaveTextContent(`until ${formatBotClock('2026-10-19T09:30:00.000Z')}.`);
    expect(within(dialog()).getByRole('link', { name: 'Open in Telegram' })).toHaveAttribute(
      'href',
      issued(2).url,
    );
  });

  it('a new link brings an expired dialog back to waiting', async () => {
    renderCard();
    await openDialog(issued(1, '2026-10-19T09:00:00.000Z'));
    api.createConnectLink.mockResolvedValueOnce(issued(2));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    expect(await within(dialog()).findByText(issued(2).url)).toBeInTheDocument();
    expect(within(dialog()).queryByText('This link has expired.')).not.toBeInTheDocument();
  });

  it('link limit on a new link: the alert, Get a new link disabled until retry_at, the link stays valid', async () => {
    renderCard();
    await openDialog();
    const retryAt = '2026-10-19T09:20:00.000Z';
    api.createConnectLink.mockRejectedValueOnce(
      refusal(
        ErrorCode.CONNECT_LINK_LIMIT_REACHED,
        { limit: 5, window_seconds: 600, retry_at: retryAt },
        429,
      ),
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    expect(
      await within(dialog()).findByText(
        `Connect links are limited to 5 per 10 minutes — try again at ${formatBotClock(retryAt)}.`,
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Get a new link' })).toBeDisabled();
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
    await advance(8 * 60_000 + 1_000);
    expect(within(dialog()).queryByText(/Connect links are limited/)).not.toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Get a new link' })).toBeEnabled();
  });

  it('409 already connected on a new link: the dialog shows connected from the answer', async () => {
    renderCard();
    await openDialog();
    api.createConnectLink.mockRejectedValueOnce(
      refusal(ErrorCode.TELEGRAM_ALREADY_LINKED, { settings: connected() }),
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    expect(await within(dialog()).findByText('Connected as Test User.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('bot stopped working for an operator: no link, the explanation, ask an owner, Close', async () => {
    renderCard();
    await openDialog();
    api.createConnectLink.mockRejectedValueOnce(
      refusal(ErrorCode.PINGS_NEED_WORKING_BOT, {
        settings: notConnected({ can_connect: false, bot: bot('needs_token') }),
      }),
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    expect(
      await within(dialog()).findByText(
        'Telegram pings need a working bot that receives messages.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText('Ask a business owner to fix the bot.')).toBeInTheDocument();
    expect(within(dialog()).queryByText(issued(1).url)).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: /new link|Copy/ }),
    ).not.toBeInTheDocument();
    expect(footerButton('Close')).toBeInTheDocument();
  });

  it('bot stopped working for an owner via a bot.changed re-read: Open bot settings closes the dialog and goes there', async () => {
    renderCard();
    await openDialog();
    api.getNotificationSettings.mockResolvedValue(
      notConnected({ can_connect: false, caller_role: 'owner', bot: bot('taken_over') }),
    );
    frame('bot.changed');
    const open = await within(dialog()).findByRole('link', { name: 'Open bot settings' });
    expect(open).toHaveAttribute('href', `/w/${WS}/settings/bot`);
    expect(within(dialog()).queryByText(issued(1).url)).not.toBeInTheDocument();
    fireEvent.click(open);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent(`/w/${WS}/settings/bot`);
  });

  it('a bot that works again after a bot.changed brings the waiting state back', async () => {
    renderCard();
    await openDialog();
    api.getNotificationSettings.mockResolvedValue(
      notConnected({ can_connect: false, bot: bot('taken_over') }),
    );
    frame('bot.changed');
    await within(dialog()).findByText(/need a working bot/);
    api.getNotificationSettings.mockResolvedValue(notConnected());
    frame('bot.changed');
    expect(await within(dialog()).findByText(issued(1).url)).toBeInTheDocument();
  });

  it('new link failed: a destructive alert, the current link stays', async () => {
    renderCard();
    await openDialog();
    api.createConnectLink.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't create a new link — try again.");
    expect(within(dialog()).getByText(issued(1).url)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Get a new link' })).toBeEnabled();
    // a later success clears it
    api.createConnectLink.mockResolvedValueOnce(issued(2));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    expect(await within(dialog()).findByText(issued(2).url)).toBeInTheDocument();
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closed early: Esc, the close button or Close; the link keeps working; a later Start turns the card Connected', async () => {
    renderCard();
    await openDialog();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeInTheDocument();
    api.getNotificationSettings.mockResolvedValue(connected());
    frame('telegram_link.changed');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the footer Close closes the dialog and focus returns to Connect Telegram', async () => {
    renderCard();
    (await screen.findByRole('button', { name: 'Connect Telegram' })).focus();
    await openDialog();
    fireEvent.click(footerButton('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect Telegram' })).toHaveFocus(),
    );
  });

  it('opening again after closing shows the newly issued link, not the old one', async () => {
    renderCard();
    await openDialog(issued(1));
    fireEvent.click(footerButton('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openDialog(issued(2));
    expect(within(dialog()).getByText(issued(2).url)).toBeInTheDocument();
  });

  it.each([
    [401, ErrorCode.UNAUTHENTICATED],
    [403, ErrorCode.ACCESS_REMOVED],
    [404, ErrorCode.NOT_FOUND],
  ])('a %i on a new link hands over to the guard and closes the dialog', async (status, code) => {
    renderCard();
    await openDialog();
    const error = new ApiError(status, code, 'x');
    api.createConnectLink.mockRejectedValueOnce(error);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Get a new link' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(guard).toHaveBeenCalledWith(error, WS);
  });

  it('phone: Open in Telegram is the first, full-width button; the link with Copy sits under it', async () => {
    renderCard();
    await openDialog();
    const open = within(dialog()).getByRole('link', { name: 'Open in Telegram' });
    expect(open).toHaveClass('w-full');
    const copy = within(dialog()).getByRole('button', { name: 'Copy' });
    const order = open.compareDocumentPosition(copy);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const first = within(dialog()).getAllByRole('link')[0];
    expect(first).toBe(open);
  });
});
