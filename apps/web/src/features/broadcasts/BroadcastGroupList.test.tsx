import {
  ErrorCode,
  type BroadcastDraft,
  type BroadcastGroupPage,
  type BroadcastGroupRow,
} from '@tg/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  listBroadcastGroup: vi.fn(),
  removeBroadcastGroupContact: vi.fn(),
  getBroadcastGroupMembership: vi.fn(),
  countBroadcastGroupMatching: vi.fn(),
  listContacts: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  listBroadcastGroup: (...a: unknown[]) => api.listBroadcastGroup(...a),
  removeBroadcastGroupContact: (...a: unknown[]) => api.removeBroadcastGroupContact(...a),
  getBroadcastGroupMembership: (...a: unknown[]) => api.getBroadcastGroupMembership(...a),
  countBroadcastGroupMatching: (...a: unknown[]) => api.countBroadcastGroupMatching(...a),
}));
vi.mock('@/features/contacts/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/contacts/api')>()),
  listContacts: (...a: unknown[]) => api.listContacts(...a),
}));
vi.mock('@/features/tags/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tags/api')>()),
  listTags: async () => ({ items: [] }),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { BroadcastEditor } from './BroadcastEditor';
import { BroadcastGroupList } from './BroadcastGroupList';
import { useBroadcastDraftStore } from './draft-store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DRAFT = id(501);
const OLENA = id(201);
const PETRO = id(202);
const IVAN = id(203);
const ref = { account_id: id(11), display_name: 'Test User' };
const tagRef = (n: number, name: string) => ({ id: id(300 + n), name });

const draft = (size: number, over: Partial<BroadcastDraft> = {}): BroadcastDraft => ({
  id: DRAFT,
  workspace_id: WS,
  name: 'Wholesale catch-up',
  author: ref,
  last_changed_by: ref,
  last_changed_at: '2026-10-23T09:00:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'draft',
  version: 3,
  text: 'New prices from Monday.',
  audience: { kind: 'group', size },
  breakdown: {
    audience_size: size,
    reach: { blocked_count: 1, never_wrote_count: 0, reachable_count: Math.max(0, size - 1) },
  },
  ...over,
});

const row = (
  contactId: string,
  first: string,
  o: Partial<BroadcastGroupRow['contact']> = {},
): BroadcastGroupRow => ({
  contact: {
    id: contactId,
    first_name: first,
    last_name: null,
    username: null,
    tags: [],
    blocked_since: null,
    ...o,
  },
  added_by: ref,
  added_at: '2026-10-23T09:00:00Z',
});

const ROWS = [
  row(OLENA, 'Olena', {
    last_name: 'K.',
    username: 'olena_k',
    tags: [tagRef(1, 'Wholesale'), tagRef(2, 'Kyiv'), tagRef(3, 'VIP'), tagRef(4, 'Spring')],
  }),
  row(PETRO, 'Petro', { blocked_since: '2026-10-20T09:00:00Z' }),
];

const page = (items: BroadcastGroupRow[], size: number, o: Partial<BroadcastGroupPage> = {}) =>
  ({
    workspace_id: WS,
    broadcast_id: DRAFT,
    size,
    items,
    has_prev: false,
    has_next: false,
    next_cursor: null,
    ...o,
  }) satisfies BroadcastGroupPage;

const guard = vi.fn();

async function show(d: BroadcastDraft = draft(14)) {
  api.getBroadcast.mockResolvedValue(d);
  await useBroadcastDraftStore.getState().open(WS, DRAFT, guard);
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <BroadcastGroupList workspaceId={WS} broadcastId={DRAFT} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
  api.listContacts.mockReturnValue(new Promise(() => undefined));
  api.countBroadcastGroupMatching.mockReturnValue(new Promise(() => undefined));
});

describe('SCR-25 — the hand-picked group (AC-04)', () => {
  it('loading: skeleton rows until the group answers', async () => {
    api.listBroadcastGroup.mockReturnValue(new Promise(() => undefined));
    await show();
    expect(screen.getAllByTestId('group-skeleton').length).toBeGreaterThan(0);
  });

  it('default: the size, Add contacts, and each contact with name, username, tags (+N after 3) and the blocked marker', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    await show();
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
    expect(screen.getByText('14 contacts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add contacts' })).toBeEnabled();
    const olena = screen.getByTestId(`group-row-${OLENA}`);
    expect(within(olena).getByText('@olena_k')).toBeInTheDocument();
    for (const name of ['Wholesale', 'Kyiv', 'VIP'])
      expect(within(olena).getAllByText(name).length).toBeGreaterThan(0);
    expect(within(olena).queryByText('Spring')).toBeNull();
    expect(within(olena).getAllByText('+1').length).toBeGreaterThan(0);
    expect(within(olena).queryByText('Blocked the bot')).toBeNull();
    const petro = screen.getByTestId(`group-row-${PETRO}`);
    expect(within(petro).getByText('Blocked the bot')).toBeInTheDocument();
    expect(within(petro).getByText('no username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('one contact reads «1 contact»', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS.slice(0, 1), 1));
    await show(draft(1));
    expect(await screen.findByText('1 contact')).toBeInTheDocument();
  });

  it('empty: «No contacts in this group yet.» with Add contacts', async () => {
    api.listBroadcastGroup.mockResolvedValue(page([], 0));
    await show(draft(0));
    expect(await screen.findByText('No contacts in this group yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add contacts' })).toBeEnabled();
  });

  it('Show more after 50 reads the next page and keeps the shown rows', async () => {
    api.listBroadcastGroup
      .mockResolvedValueOnce(page(ROWS, 51, { has_next: true, next_cursor: 'c1' }))
      .mockResolvedValueOnce(page([row(IVAN, 'Ivan')], 51));
    await show(draft(51));
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Ivan')).toBeInTheDocument();
    expect(screen.getByText('Olena K.')).toBeInTheDocument();
    expect(api.listBroadcastGroup.mock.calls[1]![2]).toEqual({ after: 'c1' });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it("error: «Couldn't load the group» with Retry", async () => {
    api.listBroadcastGroup
      .mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'))
      .mockResolvedValueOnce(page(ROWS, 14));
    await show();
    expect(await screen.findByText("Couldn't load the group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
  });

  it('Remove takes the row out, follows the size and re-reads the breakdown', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    api.removeBroadcastGroupContact.mockResolvedValue({
      broadcast_id: DRAFT,
      outcome: 'removed',
      group_size: 13,
    });
    await show();
    api.getBroadcast.mockResolvedValue(draft(13));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Olena K. from this group' }));
    await waitFor(() => expect(screen.queryByText('Olena K.')).toBeNull());
    expect(api.removeBroadcastGroupContact).toHaveBeenCalledWith(WS, DRAFT, OLENA);
    expect(screen.getByText('13 contacts')).toBeInTheDocument();
    await waitFor(() => expect(api.getBroadcast).toHaveBeenCalledTimes(2));
    expect(useBroadcastDraftStore.getState().draft?.breakdown.audience_size).toBe(13);
  });

  it('Remove of a row a teammate removed (unchanged) still drops it', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    api.removeBroadcastGroupContact.mockResolvedValue({
      broadcast_id: DRAFT,
      outcome: 'unchanged',
      group_size: 13,
    });
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Petro from this group' }));
    await waitFor(() => expect(screen.queryByText('Petro')).toBeNull());
  });

  it('a failed Remove keeps the row and says so', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    api.removeBroadcastGroupContact.mockRejectedValue(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Petro from this group' }));
    expect(await screen.findByText("Couldn't remove Petro")).toBeInTheDocument();
    expect(screen.getByText('Petro')).toBeInTheDocument();
  });

  it('Add contacts opens the picker; closing it re-reads the group and the draft', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add contacts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add contacts' });
    expect(dialog).toBeInTheDocument();
    api.listBroadcastGroup.mockResolvedValue(page([...ROWS, row(IVAN, 'Ivan')], 15));
    api.getBroadcast.mockResolvedValue(draft(15));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Ivan')).toBeInTheDocument();
    expect(screen.getByText('15 contacts')).toBeInTheDocument();
    await waitFor(() =>
      expect(useBroadcastDraftStore.getState().draft?.breakdown.audience_size).toBe(15),
    );
  });
});

describe('SCR-25 — the editor mounts the group for a hand-picked audience', () => {
  it('kind group: the group list sits in the Audience card above the breakdown', async () => {
    api.listBroadcastGroup.mockResolvedValue(page(ROWS, 14));
    api.getBroadcast.mockResolvedValue(draft(14));
    await useBroadcastDraftStore.getState().open(WS, DRAFT, guard);
    render(
      <ShellGuardContext.Provider value={guard}>
        <MemoryRouter>
          <BroadcastEditor workspaceId={WS} broadcastId={DRAFT} />
        </MemoryRouter>
      </ShellGuardContext.Provider>,
    );
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Hand-picked group' })).toBeInTheDocument();
    // The group's size line, and the breakdown's audience line below it.
    expect(screen.getAllByText('14 contacts')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add contacts' })).toBeInTheDocument();
  });
});
