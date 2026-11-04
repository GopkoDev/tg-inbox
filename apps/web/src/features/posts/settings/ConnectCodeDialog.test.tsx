import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from '@tg/shared';

const api = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  createDestinationCode: (...a: unknown[]) => api.create(...a),
  getDestinationCode: (...a: unknown[]) => api.get(...a),
}));
const live = vi.hoisted(() => ({ onFrame: null as ((f: LiveFrame) => void) | null }));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, h: { onFrame: (f: LiveFrame) => void }) => {
    live.onFrame = h.onFrame;
    return () => {
      live.onFrame = null;
    };
  },
  liveStatus: () => 'idle',
}));

import { MemoryRouter } from 'react-router';
import { useDestinationsStore } from '../destinations-store';
import { ConnectCodeDialog } from './ConnectCodeDialog';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const CODE = '0198f0c0-0000-7000-8000-0000000000c1';
const created = {
  id: CODE,
  code: 'tgp_abc',
  command: '/connect tgp_abc',
  expires_at: new Date(Date.now() + 600_000).toISOString(),
};
const status = (s: string) => ({
  id: CODE,
  status: s,
  expires_at: created.expires_at,
  needed_right: null,
  destination_id: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  live.onFrame = null;
  useDestinationsStore.setState({ timeZone: 'Europe/Kyiv' });
  api.create.mockResolvedValue(created);
  api.get.mockResolvedValue(status('waiting'));
});
afterEach(() => vi.useRealTimers());

describe('ConnectCodeDialog (AC-01)', () => {
  it('does not poll; it re-reads the code status on destinations.changed', async () => {
    render(
      <MemoryRouter>
        <ConnectCodeDialog workspaceId={WS} onClose={() => undefined} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(live.onFrame).not.toBeNull());
    await screen.findByText(/tgp_abc/);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 3500));
    const before = api.get.mock.calls.length;
    expect(before).toBeLessThanOrEqual(1);
    api.get.mockResolvedValue(status('expired'));
    act(() => live.onFrame?.({ type: 'destinations.changed', v: 1, workspace_id: WS }));
    await waitFor(() => expect(api.get.mock.calls.length).toBe(before + 1));
  }, 10_000);

  const open = () =>
    render(
      <MemoryRouter>
        <ConnectCodeDialog workspaceId={WS} onClose={() => undefined} />
      </MemoryRouter>,
    );

  it('shows the destination-limit result, with no spinner and no waiting text', async () => {
    api.get.mockResolvedValue(status('destination_limit'));
    open();
    expect(await screen.findByText(/up to 20 channels and groups/i)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting/i)).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('shows the code expiry in the workspace zone, naming it', async () => {
    open();
    expect(await screen.findByText(/Expires at .*\(Europe\/Kyiv\)/)).toBeInTheDocument();
  });

  it('does not show a browser-zone expiry while the workspace zone is unknown', async () => {
    useDestinationsStore.setState({ timeZone: null });
    open();
    await screen.findByText(/tgp_abc/);
    expect(screen.queryByText(/Expires at/)).not.toBeInTheDocument();
  });
});
