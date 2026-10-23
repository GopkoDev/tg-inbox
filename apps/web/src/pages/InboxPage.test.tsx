import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listConversations = vi.fn();
vi.mock('@/features/inbox/api-source', () => ({
  listConversations: (...a: unknown[]) => listConversations(...a),
  getInboxBotStatus: async () => new Promise(() => undefined),
}));
vi.mock('@/shared/api/realtime', () => ({
  openLiveSocket: () => ({ close: vi.fn() }),
}));
vi.mock('@/features/inbox/InboxList', () => ({ InboxList: () => null }));
vi.mock('@/features/workspaces/guard', () => ({ useGuard: () => vi.fn() }));

import { useInboxStore } from '@/features/inbox/store';
import { InboxPage } from './InboxPage';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const page = (status: string, assignee: string) => ({
  workspace_id: WS,
  lens: { status, assignee },
  items: [],
  has_prev: false,
  has_next: false,
  next_cursor: null,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function Go() {
  const [, set] = useSearchParams();
  return (
    <button type="button" onClick={() => set({ assignee: 'unassigned' })}>
      go
    </button>
  );
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/w/:workspaceId/inbox" element={<InboxPage />} />
      </Routes>
      <Where />
      <Go />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  useInboxStore.getState().leave();
});

describe('InboxPage lenses', () => {
  it('reads the lenses from the address', async () => {
    listConversations.mockResolvedValue(page('closed', 'mine'));
    renderAt(`/w/${WS}/inbox?status=closed&assignee=mine`);
    await waitFor(() => expect(useInboxStore.getState().listStatus).toBe('ready'));
    expect(useInboxStore.getState().lens).toEqual({ status: 'closed', assignee: 'mine' });
    expect(listConversations.mock.calls[0]![1]).toMatchObject({
      status: 'closed',
      assignee: 'mine',
    });
    expect(screen.getByTestId('where').textContent).toBe(
      `/w/${WS}/inbox?status=closed&assignee=mine`,
    );
  });

  it('rewrites an unknown value to the default in the address and never requests it', async () => {
    listConversations.mockResolvedValue(page('open', 'all'));
    renderAt(`/w/${WS}/inbox?assignee=everyone`);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/w/${WS}/inbox`));
    await waitFor(() => expect(useInboxStore.getState().listStatus).toBe('ready'));
    expect(listConversations.mock.calls.every((c) => c[1].assignee === 'all')).toBe(true);
  });

  it('a lens change in the address reloads the list in the new lens', async () => {
    listConversations.mockImplementation(async (_ws, p) => page(p.status, p.assignee));
    renderAt(`/w/${WS}/inbox`);
    await waitFor(() => expect(useInboxStore.getState().listStatus).toBe('ready'));
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
    expect(listConversations.mock.calls.at(-1)![1]).toMatchObject({ assignee: 'unassigned' });
  });
});
