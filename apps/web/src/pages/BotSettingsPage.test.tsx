import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BotSettings } from '@tg/shared';
import { useEffect } from 'react';
import { Route, Routes, useNavigate, type NavigateFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useBotStore } from '@/features/bot/store';
import { formatBotTime } from '@/features/bot/settings/format';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';
import { InDataRouter } from '@/test/router';
import { AppShell } from '@/shared/ui/app-shell';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (a?: string) => listMyWorkspaces(a),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));
const resolveWorkspace = vi.fn();
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));
const getBotSettings = vi.fn();
const reconnectBot = vi.fn();
const pasteBotToken = vi.fn();
const disconnectBot = vi.fn();
vi.mock('@/features/bot/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/bot/api')>()),
  getBotSettings: (w: string, o?: unknown) => getBotSettings(w, o),
  reconnectBot: (w: string, b: unknown) => reconnectBot(w, b),
  pasteBotToken: (w: string, b: unknown) => pasteBotToken(w, b),
  disconnectBot: (w: string) => disconnectBot(w),
}));

import { BotSettingsPage } from './BotSettingsPage';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bot = { name: 'Acme Flowers Support', username: 'acme_flowers_bot' };
const LAST = '2026-10-11T09:58:12.000Z';
const CHECKED = '2026-10-11T10:03:00.000Z';
const settingsOf = (o: Partial<Extract<BotSettings, { bot: unknown }>> = {}): BotSettings => ({
  state: 'connected',
  bot,
  last_checked_at: CHECKED,
  last_message_received_at: LAST,
  contacts_count: 12,
  ...o,
});
const notConnected: BotSettings = { state: 'not_connected' };
const err = (status: number, code: string, message = code, details?: unknown) =>
  new ApiError(status, code as never, message, details);

const TAKEOVER = 'Connecting will stop this bot delivering messages to another service';
const takeoverRefusal = () => err(409, 'TAKEOVER_CONFIRMATION_REQUIRED', TAKEOVER, { bot });

/** Lets a test change the URL the way browser history does (no in-app link). */
const nav: { current: NavigateFunction } = { current: () => undefined };
function CaptureNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.current = navigate;
  }, [navigate]);
  return null;
}

function renderPage() {
  return render(
    <InDataRouter initialEntries={['/w/w1/bot']}>
      <CaptureNavigate />
      <Routes>
        <Route path="/w/:workspaceId/bot" element={<AppShell />}>
          <Route index element={<BotSettingsPage />} />
        </Route>
        <Route path="/w/:workspaceId" element={<p>home screen</p>} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </InDataRouter>,
  );
}

/** No state ever renders anything shaped like a bot token. */
const TOKEN_SHAPE = /\d{3,}:[A-Za-z0-9_-]{30,}/;
function expectNoToken(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(TOKEN_SHAPE);
  expect(container.innerHTML).not.toMatch(TOKEN_SHAPE);
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue({ items: [acme], has_next: false, has_prev: false });
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useBotStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'Olga' });
  useWorkspaceStore.getState().setCurrent(acme);
});

describe('BotSettingsPage (SCR-02)', () => {
  it('loading: a skeleton while the settings are in flight (a user open, not background)', () => {
    getBotSettings.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('bot-skeleton')).toBeInTheDocument();
    expect(getBotSettings).toHaveBeenCalledWith('w1', undefined);
  });

  it('not connected: explains and offers Connect bot → SCR-03', async () => {
    getBotSettings.mockResolvedValue(notConnected);
    const { container } = renderPage();
    expect(await screen.findByText('No bot is connected')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Paste the token of your bot from BotFather; messages your customers send to it will arrive here',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect bot' }));
    expect(screen.getByRole('dialog', { name: 'Connect bot' })).toBeInTheDocument();
    expectNoToken(container);
  });

  it('connected: name, @username link, badge, last message, contacts, last check (AC-15, AC-07)', async () => {
    getBotSettings.mockResolvedValue(settingsOf());
    const { container } = renderPage();
    expect(await screen.findByText('Acme Flowers Support')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@acme_flowers_bot' })).toHaveAttribute(
      'href',
      'https://t.me/acme_flowers_bot',
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    const facts = screen.getByTestId('bot-facts');
    expect(within(facts).getByText('Last message received')).toBeInTheDocument();
    expect(within(facts).getByText(formatBotTime(LAST))).toBeInTheDocument();
    expect(within(facts).getByText('Contacts captured')).toBeInTheDocument();
    expect(within(facts).getByText('12')).toBeInTheDocument();
    expect(within(facts).getByText('Checked with Telegram')).toBeInTheDocument();
    expect(within(facts).getByText(formatBotTime(CHECKED))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New token' }));
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Disconnect @acme_flowers_bot?' }),
    ).toBeInTheDocument();
    expectNoToken(container);
  });

  it('empty: no messages yet → none yet, 0 contacts and a hint to test', async () => {
    getBotSettings.mockResolvedValue(
      settingsOf({ last_message_received_at: null, contacts_count: 0 }),
    );
    renderPage();
    expect(await screen.findByText('none yet')).toBeInTheDocument();
    expect(within(screen.getByTestId('bot-facts')).getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Write to @acme_flowers_bot in Telegram to test')).toBeInTheDocument();
  });

  it('needs token: badge, destructive explanation, Paste new token and Disconnect (AC-16)', async () => {
    getBotSettings.mockResolvedValue(settingsOf({ state: 'needs_token' }));
    const { container } = renderPage();
    expect(await screen.findByText('Not working — needs a new token')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Messages are not arriving. Paste a new token of @acme_flowers_bot from BotFather. Everything captured so far is kept.',
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Paste new token' }));
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    expectNoToken(container);
  });

  it('taken over: badge, explanation, Reconnect / Paste token again / Disconnect (AC-16b)', async () => {
    getBotSettings.mockResolvedValue(settingsOf({ state: 'taken_over' }));
    renderPage();
    expect(await screen.findByText('Not receiving messages')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Another service took over this bot's messages. Reconnect to receive them here again; messages the other service received are not recovered.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Paste token again' }));
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  describe('reconnect', () => {
    beforeEach(() => getBotSettings.mockResolvedValue(settingsOf({ state: 'taken_over' })));

    it('reconnecting: spinner on Reconnect, other actions disabled; success re-renders', async () => {
      let resolve!: (s: BotSettings) => void;
      reconnectBot.mockReturnValue(new Promise((r) => (resolve = r)));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      expect(reconnectBot).toHaveBeenCalledWith('w1', { confirm_takeover: false });
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
      expect(screen.getByTestId('reconnect-spinner')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Paste token again' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
      await act(async () => resolve(settingsOf()));
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(useBotStore.getState().settings).toEqual(settingsOf());
    });

    it('a reconnect answered after a switch to another workspace does not touch its page', async () => {
      let resolve!: (s: BotSettings) => void;
      reconnectBot.mockReturnValue(new Promise((r) => (resolve = r)));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      // The owner switches to Bolt Bikes (clears the bot store) and its settings load first.
      act(() => useWorkspaceStore.getState().setCurrent({ ...acme, id: 'w2', name: 'Bolt' }));
      getBotSettings.mockResolvedValue(notConnected);
      await act(() => useBotStore.getState().load('w2'));
      await act(async () => resolve(settingsOf()));
      expect(useBotStore.getState()).toMatchObject({
        workspaceId: 'w2',
        settings: notConnected,
        notice: null,
      });
    });

    it('takeover warning → SCR-04 with details.bot and the server message', async () => {
      reconnectBot.mockRejectedValue(takeoverRefusal());
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Take over @acme_flowers_bot?',
      });
      expect(dialog).toHaveTextContent(TAKEOVER);
      // Behind the modal (aria-hidden), Reconnect is enabled again.
      expect(screen.getByRole('button', { name: 'Reconnect', hidden: true })).toBeEnabled();
    });

    it('needs token → store ← details.settings, then SCR-03 with the server message', async () => {
      const message = "The bot's token no longer works — paste a new token from BotFather";
      reconnectBot.mockRejectedValue(
        err(409, 'BOT_NEEDS_NEW_TOKEN', message, {
          settings: settingsOf({ state: 'needs_token' }),
        }),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      expect(await screen.findByText('Not working — needs a new token')).toBeInTheDocument();
      const dialog = screen.getByRole('dialog', { name: 'New token' });
      expect(within(dialog).getByRole('alert')).toHaveTextContent(message);
    });

    it('stale: NOTHING_TO_RECONNECT → store ← details.settings and a notice with the server message', async () => {
      const message =
        'The bot is not taken over by another service — there is nothing to reconnect';
      reconnectBot.mockRejectedValue(
        err(409, 'NOTHING_TO_RECONNECT', message, { settings: settingsOf() }),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('Telegram unavailable → alert, state unchanged, Reconnect enabled again', async () => {
      reconnectBot.mockRejectedValue(
        err(503, 'TELEGRAM_UNAVAILABLE', 'Telegram is not responding — try again'),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      expect(await screen.findByText('Telegram is not responding — try again')).toBeInTheDocument();
      expect(screen.getByText('Not receiving messages')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
    });

    it('unexpected failure → alert, the page keeps its previous state', async () => {
      reconnectBot.mockRejectedValue(new Error('network'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Not receiving messages')).toBeInTheDocument();
    });
  });

  it('owners only: an operator gets only the refusal and Back to home (AC-03)', async () => {
    getBotSettings.mockRejectedValue(err(403, 'OWNER_ONLY', 'Only business owners manage the bot'));
    renderPage();
    expect(await screen.findByText('Only business owners manage the bot')).toBeInTheDocument();
    expect(screen.queryByText('Acme Flowers Support')).not.toBeInTheDocument();
    expect(getBotSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByText('home screen')).toBeInTheDocument();
  });

  it('not a member: 404 renders the not-found card in place (AC-03)', async () => {
    getBotSettings.mockRejectedValue(err(404, 'NOT_FOUND'));
    renderPage();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('error on load: Something went wrong + Retry reloads', async () => {
    getBotSettings.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    getBotSettings.mockResolvedValue(notConnected);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No bot is connected')).toBeInTheDocument();
  });

  describe('paste token (SCR-03 over SCR-02)', () => {
    const TOKEN = '100000001:TEST-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    it('connect: success closes the dialog and SCR-02 shows the connected bot (AC-01)', async () => {
      getBotSettings.mockResolvedValue(notConnected);
      pasteBotToken.mockResolvedValue(settingsOf({ last_message_received_at: null }));
      const { container } = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect bot' }));
      fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: TOKEN } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoToken(container);
      expect(JSON.stringify(useBotStore.getState())).not.toContain(TOKEN);
    });

    const pasteUntilTakeover = async () => {
      getBotSettings.mockResolvedValue(notConnected);
      pasteBotToken.mockRejectedValueOnce(takeoverRefusal());
      const view = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect bot' }));
      fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: TOKEN } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByRole('alertdialog', { name: 'Take over @acme_flowers_bot?' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoToken(view.container);
      expectNoToken(document.body);
      return view;
    };
    const confirmTakeover = () =>
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Connect' }),
      );

    it('takeover warning → SCR-04; Connect resubmits the same token confirmed → connected (AC-06)', async () => {
      const { container } = await pasteUntilTakeover();
      pasteBotToken.mockResolvedValue(settingsOf({ last_message_received_at: null }));
      confirmTakeover();
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(pasteBotToken).toHaveBeenLastCalledWith('w1', {
        token: TOKEN,
        confirm_takeover: true,
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expectNoToken(container);
      expect(JSON.stringify(useBotStore.getState())).not.toContain(TOKEN);
    });

    it('a URL change to another workspace drops an open takeover (and its token) for good', async () => {
      await pasteUntilTakeover();
      enterWorkspace.mockImplementation((id: string) =>
        Promise.resolve({ id, name: id === 'w1' ? 'Acme Flowers' : 'Bolt', role: 'owner' }),
      );
      await act(() => nav.current('/w/w2/bot'));
      await waitFor(() => expect(useWorkspaceStore.getState().current?.id).toBe('w2'));
      expect(await screen.findByText('No bot is connected')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await act(() => nav.current('/w/w1/bot'));
      await waitFor(() => expect(useWorkspaceStore.getState().current?.id).toBe('w1'));
      // The page body is rendered again for w1 — and the old SCR-04 does not come back.
      expect(await screen.findByText('No bot is connected')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoToken(document.body);
    });

    it('a slow paste in the workspace just left never closes the dialog opened in the new one', async () => {
      getBotSettings.mockResolvedValue(notConnected);
      enterWorkspace.mockImplementation((id: string) =>
        Promise.resolve({ id, name: id === 'w1' ? 'Acme Flowers' : 'Bolt', role: 'owner' }),
      );
      let resolveW1!: (s: BotSettings) => void;
      pasteBotToken.mockReturnValueOnce(new Promise((r) => (resolveW1 = r)));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect bot' }));
      fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: TOKEN } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await act(() => nav.current('/w/w2/bot'));
      await waitFor(() => expect(useWorkspaceStore.getState().current?.id).toBe('w2'));
      fireEvent.click(await screen.findByRole('button', { name: 'Connect bot' }));
      fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'typing in w2' } });
      await act(async () => resolveW1(settingsOf()));
      expect(screen.getByRole('dialog', { name: 'Connect bot' })).toBeInTheDocument();
      expect(screen.getByLabelText('Bot token')).toHaveValue('typing in w2');
    });

    it('takeover cancelled: no request, still not connected, the token is dropped', async () => {
      await pasteUntilTakeover();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(pasteBotToken).toHaveBeenCalledTimes(1);
      expect(screen.getByText('No bot is connected')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Connect bot' }));
      expect(screen.getByLabelText('Bot token')).toHaveValue('');
    });

    it.each([
      [400, 'BOT_TOKEN_INVALID', 'The token is not valid — copy it again from BotFather'],
      [409, 'BOT_BELONGS_TO_ANOTHER_WORKSPACE', 'This bot already belongs to another workspace'],
      [
        409,
        'WORKSPACE_KEEPS_ONE_BOT',
        'A workspace keeps one business bot — disconnect the current bot first',
      ],
    ])(
      'takeover confirmed but refused on re-check (%s %s) → SCR-03 reopens in that error',
      async (status, code, message) => {
        await pasteUntilTakeover();
        pasteBotToken.mockRejectedValue(err(status, code, message));
        confirmTakeover();
        const dialog = await screen.findByRole('dialog', { name: 'Connect bot' });
        expect(within(dialog).getByRole('alert')).toHaveTextContent(message);
        expect(within(dialog).getByLabelText('Bot token')).toHaveValue('');
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      },
    );
  });

  describe('reconnect → confirm takeover (SCR-04 from SCR-02)', () => {
    beforeEach(() => getBotSettings.mockResolvedValue(settingsOf({ state: 'taken_over' })));
    const untilWarning = async () => {
      reconnectBot.mockRejectedValueOnce(takeoverRefusal());
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      return screen.findByRole('alertdialog', { name: 'Take over @acme_flowers_bot?' });
    };

    it('Connect → reconnectBot { confirm_takeover: true } → connected (AC-16b)', async () => {
      const dialog = await untilWarning();
      reconnectBot.mockResolvedValue(settingsOf());
      fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(reconnectBot).toHaveBeenLastCalledWith('w1', { confirm_takeover: true });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('re-check: BOT_NEEDS_NEW_TOKEN → needs token and SCR-03 with the server message', async () => {
      const message = "The bot's token no longer works — paste a new token from BotFather";
      const dialog = await untilWarning();
      reconnectBot.mockRejectedValue(
        err(409, 'BOT_NEEDS_NEW_TOKEN', message, {
          settings: settingsOf({ state: 'needs_token' }),
        }),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      expect(await screen.findByText('Not working — needs a new token')).toBeInTheDocument();
      const paste = screen.getByRole('dialog', { name: 'New token' });
      expect(within(paste).getByRole('alert')).toHaveTextContent(message);
    });

    it('re-check: NOTHING_TO_RECONNECT → SCR-02 stale with the server message', async () => {
      const message =
        'The bot is not taken over by another service — there is nothing to reconnect';
      const dialog = await untilWarning();
      reconnectBot.mockRejectedValue(
        err(409, 'NOTHING_TO_RECONNECT', message, { settings: settingsOf() }),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('disconnect (SCR-05 over SCR-02)', () => {
    beforeEach(() => getBotSettings.mockResolvedValue(settingsOf()));

    it('confirm → not connected; contacts stay on the server (AC-18)', async () => {
      disconnectBot.mockResolvedValue(notConnected);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Disconnect @acme_flowers_bot?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByText('No bot is connected')).toBeInTheDocument();
      expect(disconnectBot).toHaveBeenCalledWith('w1');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('cancel → no request, SCR-02 unchanged', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(disconnectBot).not.toHaveBeenCalled();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('owners only on disconnect → SCR-02 «owners only»', async () => {
      disconnectBot.mockRejectedValue(
        err(403, 'OWNER_ONLY', 'Only business owners manage the bot'),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByText('Only business owners manage the bot')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
    });
  });
});
