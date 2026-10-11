import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BotSettings } from '@tg/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useBotStore } from '@/features/bot/store';
import { formatBotTime } from '@/features/bot/settings/format';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

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
vi.mock('@/features/bot/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/bot/api')>()),
  getBotSettings: (w: string, o?: unknown) => getBotSettings(w, o),
  reconnectBot: (w: string, b: unknown) => reconnectBot(w, b),
  pasteBotToken: (w: string, b: unknown) => pasteBotToken(w, b),
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

const onDisconnect = vi.fn();
const onTakeoverWarning = vi.fn();
const onPasteTakeover = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/w/w1/bot']}>
      <Routes>
        <Route
          path="/w/:workspaceId/bot"
          element={
            <BotSettingsPage
              onDisconnect={onDisconnect}
              onTakeoverWarning={onTakeoverWarning}
              onPasteTakeover={onPasteTakeover}
            />
          }
        />
        <Route path="/w/:workspaceId" element={<p>home screen</p>} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </MemoryRouter>,
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
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

    it('takeover warning → SCR-04 with details.bot', async () => {
      reconnectBot.mockRejectedValue(
        err(409, 'TAKEOVER_CONFIRMATION_REQUIRED', 'Connecting will stop…', { bot }),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      await waitFor(() => expect(onTakeoverWarning).toHaveBeenCalledWith(bot));
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
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

    it('takeover warning: hands { token, bot } to SCR-04', async () => {
      getBotSettings.mockResolvedValue(notConnected);
      pasteBotToken.mockRejectedValue(
        err(409, 'TAKEOVER_CONFIRMATION_REQUIRED', 'Connecting will stop…', { bot }),
      );
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect bot' }));
      fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: TOKEN } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await waitFor(() => expect(onPasteTakeover).toHaveBeenCalledWith({ token: TOKEN, bot }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });
});
