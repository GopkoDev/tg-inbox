import type {
  BroadcastRecipient,
  BroadcastRecipientPage,
  LaunchedBroadcast,
  LiveFrame,
  RecipientState,
} from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBotTime } from '@/features/bot/settings/format';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  listBroadcastRecipients: vi.fn(),
  stopBroadcast: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  listBroadcastRecipients: (...a: unknown[]) => api.listBroadcastRecipients(...a),
  stopBroadcast: (...a: unknown[]) => api.stopBroadcast(...a),
}));
const live = vi.hoisted(() => ({ handlers: [] as Array<(f: LiveFrame) => void> }));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, handlers: { onFrame: (f: LiveFrame) => void }) => {
    live.handlers.push(handlers.onFrame);
    return () => {
      live.handlers = live.handlers.filter((h) => h !== handlers.onFrame);
    };
  },
  liveStatus: () => 'idle',
}));

import { BroadcastDetailPage } from '@/pages/BroadcastDetailPage';
import { useBroadcastDraftStore } from './draft-store';
import { useBroadcastReportStore } from './report-store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const B = id(501);
const OWNER = id(11);
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });
const LAUNCHED_AT = '2026-10-23T09:00:00Z';

const broadcast = (over: Partial<LaunchedBroadcast> = {}): LaunchedBroadcast => ({
  id: B,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref(OWNER, 'Test User'),
  last_changed_by: ref(OWNER, 'Test User'),
  last_changed_at: LAUNCHED_AT,
  created_at: LAUNCHED_AT,
  status: 'sending',
  text: 'New prices from Monday:\nroses 20% off.',
  audience: {
    kind: 'tags',
    mode: 'any',
    tags: [
      { tag_id: id(301), name: 'VIP', kind: 'include' },
      { tag_id: id(302), name: 'Staff', kind: 'exclude' },
    ],
  },
  launched_by: ref(OWNER, 'Test User'),
  launched_at: LAUNCHED_AT,
  launch_breakdown: {
    audience_size: 38,
    blocked_count: 2,
    never_wrote_count: 0,
    recipient_count: 36,
  },
  stopped_by: null,
  stopped_at: null,
  ended_at: null,
  end_reason: null,
  totals: {
    waiting: 20,
    sending: 2,
    delivered: 12,
    blocked: 1,
    failed: 1,
    not_confirmed: 0,
    stopped: 0,
  },
  not_reached_count: 0,
  ...over,
});

let nextRecipient = 1;
const recipient = (
  state: RecipientState,
  over: Partial<BroadcastRecipient> = {},
): BroadcastRecipient => {
  const n = nextRecipient++;
  const done = state !== 'waiting' && state !== 'sending';
  return {
    id: id(6000 + n),
    position: n,
    contact: { id: id(7000 + n), first_name: `Person ${n}`, last_name: null, username: null },
    state,
    failure_reason: state === 'failed' ? 'account_gone' : null,
    outcome_at: done ? '2026-10-23T09:01:00Z' : null,
    ...over,
  };
};
const page = (
  items: BroadcastRecipient[],
  over: Partial<BroadcastRecipientPage> = {},
): BroadcastRecipientPage => ({
  workspace_id: WS,
  broadcast_id: B,
  state: null,
  items,
  has_prev: false,
  has_next: false,
  next_cursor: null,
  ...over,
});

const guard = vi.fn();

async function openPage(
  b: LaunchedBroadcast = broadcast(),
  p: BroadcastRecipientPage = page([recipient('delivered')]),
  role: 'owner' | 'operator' = 'owner',
) {
  api.getBroadcast.mockResolvedValue(b);
  api.listBroadcastRecipients.mockResolvedValue(p);
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/broadcasts/${B}`]}>
        <Routes>
          <Route path="/w/:workspaceId/broadcasts/:broadcastId" element={<BroadcastDetailPage />} />
          <Route path="/w/:workspaceId/contacts/:contactId" element={<p>contact profile</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
  await screen.findByRole('heading', { level: 1, name: b.name });
}

const report = () => screen.getByTestId('broadcast-report');
const total = (label: string) =>
  within(report())
    .getAllByText(label)
    .map((e) => e.closest('[data-total]'))
    .find((e) => e !== null) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  live.handlers = [];
  nextRecipient = 1;
  guard.mockResolvedValue('handled');
  useBroadcastDraftStore.getState().close();
  useBroadcastReportStore.getState().close();
});

describe('SCR-28 Broadcast page (AC-11, AC-12, AC-18)', () => {
  it('loading: header, text and report skeletons while the launched broadcast is read', async () => {
    api.getBroadcast.mockResolvedValueOnce(broadcast());
    api.getBroadcast.mockReturnValue(new Promise(() => undefined));
    api.listBroadcastRecipients.mockReturnValue(new Promise(() => undefined));
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'owner' } });
    render(
      <ShellGuardContext.Provider value={guard}>
        <MemoryRouter initialEntries={[`/w/${WS}/broadcasts/${B}`]}>
          <Routes>
            <Route
              path="/w/:workspaceId/broadcasts/:broadcastId"
              element={<BroadcastDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </ShellGuardContext.Provider>,
    );
    expect(await screen.findByTestId('report-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('recipient-skeleton')).toHaveLength(8);
  });

  it('sending: status, who launched it, read-only, the text, the audience as defined and «Sent to 36»', async () => {
    await openPage();
    expect(screen.getByTestId('broadcast-launched-view')).toBeInTheDocument();
    expect(screen.getAllByText('Sending')[0]).toBeInTheDocument();
    expect(
      screen.getByText(`Launched by Test User · ${formatBotTime(LAUNCHED_AT)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Read-only — a launched broadcast can't be changed."),
    ).toBeInTheDocument();
    expect(screen.getByTestId('broadcast-text')).toHaveTextContent(
      'New prices from Monday: roses 20% off.',
    );
    expect(screen.getByTestId('broadcast-text')).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByText('Any of VIP · leaving out Staff')).toBeInTheDocument();
    expect(screen.getByText('Sent to')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('a hand-picked group reads so', async () => {
    await openPage(broadcast({ audience: { kind: 'group' } }));
    expect(screen.getByText('Hand-picked group')).toBeInTheDocument();
  });

  it('the report: five totals per Decision 10', async () => {
    await openPage(
      broadcast({
        status: 'stopped',
        stopped_by: ref(OWNER, 'Test User'),
        stopped_at: '2026-10-23T09:03:00Z',
        ended_at: '2026-10-23T09:03:00Z',
        end_reason: 'stopped',
        totals: {
          waiting: 0,
          sending: 1,
          delivered: 12,
          blocked: 1,
          failed: 2,
          not_confirmed: 3,
          stopped: 17,
        },
      }),
    );
    expect(total('Waiting')).toHaveTextContent('1');
    expect(total('Delivered')).toHaveTextContent('12');
    expect(total('Blocked the bot')).toHaveTextContent('1');
    expect(total('Failed')).toHaveTextContent('5');
    expect(total('Not sent — stopped')).toHaveTextContent('17');
  });

  it('no stopped recipients: no «Not sent — stopped» total', async () => {
    await openPage();
    expect(within(report()).queryByText('Not sent — stopped')).toBeNull();
  });

  it('recipients with plain reasons, outcomes and contact links', async () => {
    await openPage(
      broadcast(),
      page([
        recipient('delivered'),
        recipient('failed', { failure_reason: 'account_gone' }),
        recipient('failed', { failure_reason: 'chat_not_found' }),
        recipient('failed', { failure_reason: 'telegram_error' }),
        recipient('failed', { failure_reason: 'text_refused' }),
        recipient('failed', { failure_reason: 'bot_stopped' }),
        recipient('not_confirmed'),
        recipient('stopped'),
        recipient('sending'),
        recipient('waiting'),
      ]),
    );
    const table = within(report()).getByRole('table');
    for (const text of [
      'Account no longer exists',
      'Chat not found',
      'Telegram error',
      'Telegram refused the text',
      'The bot stopped working',
      'Not confirmed — Telegram did not answer, not sent again',
      'Sending…',
    ]) {
      expect(within(table).getAllByText(text)[0]).toBeInTheDocument();
    }
    expect(within(table).getAllByText('Not sent — stopped')[0]).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Person 1' })).toHaveAttribute(
      'href',
      `/w/${WS}/contacts/${id(7001)}`,
    );
  });

  it('narrowed to one outcome: read from the top; none → «No recipients with this outcome.»', async () => {
    await openPage();
    api.listBroadcastRecipients.mockResolvedValue(page([], { state: 'blocked' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Outcome' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked the bot' }));
    await waitFor(() =>
      expect(api.listBroadcastRecipients).toHaveBeenLastCalledWith(WS, B, { state: 'blocked' }, {}),
    );
    expect(await screen.findByText('No recipients with this outcome.')).toBeInTheDocument();
  });

  it('U3: while a narrowed page loads, skeleton rows, never «No recipients with this outcome.»', async () => {
    await openPage();
    api.listBroadcastRecipients.mockReturnValue(new Promise(() => undefined));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Outcome' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked the bot' }));
    expect((await screen.findAllByTestId('recipient-row-skeleton')).length).toBeGreaterThan(0);
    expect(screen.queryByText('No recipients with this outcome.')).toBeNull();
  });

  it('U3: a failed narrowed page: an Alert in the report, Retry reads the same outcome', async () => {
    await openPage();
    api.listBroadcastRecipients.mockRejectedValueOnce(new Error('network'));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Outcome' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked the bot' }));
    expect(await within(report()).findByText("Couldn't load recipients")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spring prices' })).toBeInTheDocument();
    api.listBroadcastRecipients.mockResolvedValue(
      page([recipient('blocked')], { state: 'blocked' }),
    );
    fireEvent.click(within(report()).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(api.listBroadcastRecipients).toHaveBeenLastCalledWith(WS, B, { state: 'blocked' }, {}),
    );
    expect(await within(report()).findByRole('link', { name: /^Person/ })).toBeInTheDocument();
  });

  it('Show more: the next 50; a failure says so with Retry', async () => {
    const first = Array.from({ length: 50 }, () => recipient('delivered'));
    await openPage(broadcast(), page(first, { has_next: true, next_cursor: 'abc' }));
    api.listBroadcastRecipients.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText("Couldn't load more recipients")).toBeInTheDocument();
    api.listBroadcastRecipients.mockResolvedValueOnce(page([recipient('blocked')]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(report()).getAllByRole('row')).toHaveLength(52));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('live: a report frame re-reads the totals in place', async () => {
    await openPage();
    api.getBroadcast.mockResolvedValue(
      broadcast({
        totals: {
          waiting: 0,
          sending: 0,
          delivered: 34,
          blocked: 1,
          failed: 1,
          not_confirmed: 0,
          stopped: 0,
        },
      }),
    );
    await act(async () => {
      for (const h of live.handlers)
        h({
          type: 'broadcast.changed',
          workspace_id: WS,
          broadcast_id: B,
          change: 'report',
        } as LiveFrame);
    });
    await waitFor(() => expect(total('Delivered')).toHaveTextContent('34'));
  });

  it('sent: «Launched by …» stays beside «Finished …», no Stop (AC-11)', async () => {
    await openPage(
      broadcast({ status: 'sent', ended_at: '2026-10-23T09:02:00Z', end_reason: 'completed' }),
    );
    expect(
      screen.getByText(`Launched by Test User · ${formatBotTime(LAUNCHED_AT)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Finished ${formatBotTime('2026-10-23T09:02:00Z')}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it.each([
    [
      'text_refused',
      'Sending ended early: Telegram refused the text.',
      '— ended early: Telegram refused the text',
    ],
    [
      'bot_stopped',
      'Sending ended early: the bot stopped working.',
      '— ended early: the bot stopped working',
    ],
  ] as const)(
    'sent, ended early (%s): the alert and the status note',
    async (reason, alert, note) => {
      await openPage(
        broadcast({ status: 'sent', ended_at: '2026-10-23T09:02:00Z', end_reason: reason }),
      );
      expect(screen.getByText(alert)).toBeInTheDocument();
      expect(
        screen.getByText(
          'You can duplicate it, fix the text or the bot, and send the copy to the recipients it did not reach.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(note)).toBeInTheDocument();
    },
  );

  it('stopped: «Launched by …» stays beside «Stopped by …», no Stop (AC-11)', async () => {
    await openPage(
      broadcast({
        status: 'stopped',
        stopped_by: ref(OWNER, 'Test User'),
        stopped_at: '2026-10-23T09:03:00Z',
        ended_at: '2026-10-23T09:03:00Z',
        end_reason: 'stopped',
      }),
    );
    expect(
      screen.getByText(`Launched by Test User · ${formatBotTime(LAUNCHED_AT)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Stopped by Test User · ${formatBotTime('2026-10-23T09:03:00Z')}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('operator: no Stop while sending', async () => {
    await openPage(broadcast(), page([recipient('delivered')]), 'operator');
    expect(report()).toBeInTheDocument();
    expect(screen.getAllByText('Sending')[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('owner: Stop opens SCR-29 with the waiting total; stopped → the page shows «Stopped»', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('alertdialog');
    // Only the waiting ones (20) will not get it; the 2 in flight finish.
    expect(within(dialog).getByText(/^20 recipients are still waiting\./)).toBeInTheDocument();
    api.stopBroadcast.mockResolvedValue({
      outcome: 'stopped',
      broadcast: broadcast({
        status: 'stopped',
        stopped_by: ref(OWNER, 'Test User'),
        stopped_at: '2026-10-23T09:03:00Z',
        ended_at: '2026-10-23T09:03:00Z',
        end_reason: 'stopped',
      }),
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop broadcast' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getAllByText('Stopped')[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('owner: a stop answered unchanged shows «Sent» and the notice', async () => {
    await openPage();
    api.stopBroadcast.mockResolvedValue({
      outcome: 'unchanged',
      broadcast: broadcast({
        status: 'sent',
        ended_at: '2026-10-23T09:02:00Z',
        end_reason: 'completed',
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop broadcast' }));
    expect(
      await screen.findByText('Nothing was waiting any more — the broadcast had already finished.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Sent')[0]).toBeInTheDocument();
  });

  it("error: «Couldn't load this broadcast» with Retry", async () => {
    api.getBroadcast.mockResolvedValueOnce(broadcast());
    api.getBroadcast.mockRejectedValueOnce(new Error('network'));
    api.getBroadcast.mockResolvedValue(broadcast());
    api.listBroadcastRecipients.mockResolvedValue(page([recipient('delivered')]));
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'owner' } });
    render(
      <ShellGuardContext.Provider value={guard}>
        <MemoryRouter initialEntries={[`/w/${WS}/broadcasts/${B}`]}>
          <Routes>
            <Route
              path="/w/:workspaceId/broadcasts/:broadcastId"
              element={<BroadcastDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </ShellGuardContext.Provider>,
    );
    expect(await screen.findByText("Couldn't load this broadcast")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Spring prices' }),
    ).toBeInTheDocument();
  });
});
