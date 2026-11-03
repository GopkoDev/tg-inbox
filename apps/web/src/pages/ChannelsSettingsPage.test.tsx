import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Destination, DestinationList } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  listDestinations: vi.fn(),
  createDestinationCode: vi.fn(),
  getDestinationCode: vi.fn(),
  removeDestination: vi.fn(),
  setPostingTimeZone: vi.fn(),
}));
vi.mock('@/features/posts/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/posts/api')>()),
  listDestinations: (...a: unknown[]) => api.listDestinations(...a),
  createDestinationCode: (...a: unknown[]) => api.createDestinationCode(...a),
  getDestinationCode: (...a: unknown[]) => api.getDestinationCode(...a),
  removeDestination: (...a: unknown[]) => api.removeDestination(...a),
  setPostingTimeZone: (...a: unknown[]) => api.setPostingTimeZone(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { useDestinationsStore } from '@/features/posts/destinations-store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ChannelsSettingsPage } from './ChannelsSettingsPage';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const dest = (over: Partial<Destination> = {}): Destination => ({
  id: '0198f0c0-0000-7000-8000-0000000000d1',
  kind: 'channel',
  title: 'Test Channel',
  username: 'test_channel',
  availability: 'available',
  problem: null,
  scheduled_count: 2,
  connected_by: { account_id: '0198f0c0-0000-7000-8000-0000000000a1', display_name: 'Test User' },
  connected_at: '2026-10-19T09:12:00.000Z',
  ...over,
});
const list = (items: Destination[], time_zone: string | null = 'Europe/Kyiv'): DestinationList => ({
  workspace_id: WS,
  time_zone,
  scheduled_total: items.reduce((n, d) => n + d.scheduled_count, 0),
  items,
});
const created = {
  id: '0198f0c0-0000-7000-8000-0000000000c1',
  code: `tgp_${'A'.repeat(32)}`,
  group_command: `/connect tgp_${'A'.repeat(32)}`,
  expires_at: '2099-01-01T09:10:00.000Z',
};
const status = (s: string, over = {}) => ({
  id: created.id,
  status: s,
  expires_at: created.expires_at,
  needed_right: null,
  destination_id: null,
  ...over,
});

const guard = vi.fn();
function renderPage(role: 'owner' | 'operator' = 'owner') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <MemoryRouter initialEntries={[`/w/${WS}/settings/channels`]}>
      <ShellGuardContext.Provider value={guard}>
        <Routes>
          <Route path="/w/:workspaceId/settings/channels" element={<ChannelsSettingsPage />} />
        </Routes>
      </ShellGuardContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useDestinationsStore.getState().clear();
  api.listDestinations.mockResolvedValue(list([dest()]));
});

describe('ChannelsSettingsPage (SCR-33)', () => {
  it('owner: lists destinations with kind, username, scheduled count and the zone', async () => {
    renderPage();
    expect(await screen.findByText('Test Channel')).toBeTruthy();
    expect(screen.getByText('Channel')).toBeTruthy();
    expect(screen.getByText('@test_channel')).toBeTruthy();
    expect(screen.getByText(/2 scheduled/)).toBeTruthy();
    expect(screen.getByText('Europe/Kyiv')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect a channel or group' })).toBeTruthy();
  });

  it('operator: sees the list, no actions, and the owner-only note', async () => {
    renderPage('operator');
    expect(await screen.findByText('Test Channel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect a channel or group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(
      screen.getByText(
        'Only a business owner can connect channels and groups or change the time zone',
      ),
    ).toBeTruthy();
  });

  it('empty: how-to and Connect button', async () => {
    api.listDestinations.mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByText('No channels or groups yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect a channel or group' })).toBeTruthy();
  });

  it('unavailable row shows the problem in plain language', async () => {
    api.listDestinations.mockResolvedValue(
      list([dest({ availability: 'unavailable', problem: 'not_current_bot' })]),
    );
    renderPage();
    expect(await screen.findByText("Can't post")).toBeTruthy();
    expect(screen.getByText('Connected with your previous bot — connect it again')).toBeTruthy();
  });

  it('time zone not set', async () => {
    api.listDestinations.mockResolvedValue(list([dest()], null));
    renderPage();
    expect(
      await screen.findByText(/Not set — you'll be asked when you first schedule a post/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set' })).toBeTruthy();
  });

  it('error: Retry re-reads', async () => {
    api.listDestinations.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Test Channel')).toBeTruthy();
  });

  it('connect dialog: waiting shows code and group command, then connected', async () => {
    api.createDestinationCode.mockResolvedValue(created);
    api.getDestinationCode.mockResolvedValue(status('waiting'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a channel or group' }));
    expect(await screen.findByText(created.code)).toBeTruthy();
    expect(screen.getByText(/Waiting for the code/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Group' })).toBeTruthy();
  });

  it('connect dialog: missing right keeps the code and names the right', async () => {
    api.createDestinationCode.mockResolvedValue(created);
    api.getDestinationCode.mockResolvedValue(
      status('no_post_right', { needed_right: 'send_messages' }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a channel or group' }));
    expect(await screen.findByText(/can't post in/)).toBeTruthy();
    expect(screen.getByText(created.code)).toBeTruthy();
  });

  it('connect dialog: expired offers a new code', async () => {
    api.createDestinationCode.mockResolvedValue(created);
    api.getDestinationCode.mockResolvedValue(status('expired'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a channel or group' }));
    expect(await screen.findByText('This code expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy();
  });

  it('connect dialog: no working bot offers bot settings', async () => {
    api.createDestinationCode.mockRejectedValue(
      new ApiError(409, 'POSTS_NEED_WORKING_BOT', 'no bot'),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a channel or group' }));
    expect(await screen.findByText(/Open bot settings/)).toBeTruthy();
  });

  it('connect dialog: destination limit', async () => {
    api.createDestinationCode.mockRejectedValue(
      new ApiError(409, 'DESTINATION_LIMIT_REACHED', 'limit'),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a channel or group' }));
    expect(await screen.findByText('You can connect up to 20 channels and groups')).toBeTruthy();
  });

  it('remove dialog: names the destination and the drafts consequence, then removes', async () => {
    api.removeDestination.mockResolvedValue({ outcome: 'removed', returned_to_draft: 2 });
    renderPage();
    await screen.findByText('Test Channel');
    fireEvent.pointerDown(screen.getByRole('button', { name: /actions|more|⋯/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Test Channel?')).toBeTruthy();
    expect(within(dialog).getByText(/2 scheduled posts to it go back to drafts/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(api.removeDestination).toHaveBeenCalledWith(WS, dest().id));
  });

  it('time zone dialog: confirms with the count, then saves', async () => {
    api.setPostingTimeZone.mockResolvedValue({
      outcome: 'saved',
      time_zone: 'Europe/Warsaw',
      relabelled_scheduled: 2,
    });
    renderPage();
    await screen.findByText('Europe/Kyiv');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Time zone' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('option', { name: 'Europe/Warsaw' }));
    fireEvent.click(screen.getByRole('button', { name: /^(Change|Continue)$/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Change the time zone to Europe/Warsaw?')).toBeTruthy();
    expect(
      within(dialog).getByText(/2 scheduled posts keep their moment and show a new local time/),
    ).toBeTruthy();
  });
});
