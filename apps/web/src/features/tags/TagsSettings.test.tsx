import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode, type TagWithCount } from '@tg/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { openMenu, stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ listTags: vi.fn(), deleteTag: vi.fn(), renameTag: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
  deleteTag: (...a: unknown[]) => api.deleteTag(...a),
  renameTag: (...a: unknown[]) => api.renameTag(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: () => () => undefined,
}));

import { useTagsStore } from './store';
import { TagsSettings } from './TagsSettings';

stubRadixDom();

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const tag = (n: number, name: string, count: number): TagWithCount => ({
  id: id(300 + n),
  name,
  contact_count: count,
});
const KYIV = tag(1, 'Kyiv', 30);
const OLD = tag(2, 'Old promo', 40);
const VIP = tag(3, 'VIP', 14);
const WHOLESALE = tag(4, 'Wholesale', 0);
const list = (...items: TagWithCount[]) => ({ workspace_id: WS, items });
const guard = vi.fn();
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => Promise.resolve());
};
const refusal = (status: number, code: ErrorCode, details?: unknown) =>
  new ApiError(status, code, code, details);

function renderSettings(role: 'owner' | 'operator' = 'owner') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/settings/tags`]}>
        <Routes>
          <Route path="/w/:workspaceId/settings/tags" element={<TagsSettings workspaceId={WS} />} />
          <Route path="/w/:workspaceId/inbox" element={<p>inbox route</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });
const OWNERS_ONLY = "Only a business owner manages the workspace's tags";

beforeEach(() => {
  vi.resetAllMocks();
  useTagsStore.getState().clear();
  guard.mockResolvedValue('handled');
  api.listTags.mockResolvedValue(list(KYIV, OLD, VIP, WHOLESALE));
});

describe('SCR-21 Settings — Tags (AC-10)', () => {
  it('loading: a card with 5 skeleton rows', async () => {
    api.listTags.mockReturnValue(new Promise(() => undefined));
    renderSettings();
    expect(screen.getAllByTestId('tags-skeleton')).toHaveLength(5);
  });

  it('default: every tag in tag-list order with its count as a link, zero as plain text', async () => {
    renderSettings();
    await flush();
    expect(screen.getByText('Tags', { selector: '[data-slot="card-title"]' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every tag of the workspace with the number of contacts carrying it. Tags are created on a contact, in the inbox or on the profile.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tag' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Contacts' })).toBeInTheDocument();
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names).toEqual(['Kyiv', 'Old promo', 'VIP', 'Wholesale']);
    expect(within(row('Kyiv')).getByRole('link', { name: '30 contacts' })).toHaveAttribute(
      'href',
      `/w/${WS}/contacts?tag=${KYIV.id}`,
    );
    expect(within(row('Wholesale')).queryByRole('link')).toBeNull();
    expect(within(row('Wholesale')).getByText('0 contacts')).toBeInTheDocument();
    for (const name of ['Kyiv', 'Old promo', 'VIP', 'Wholesale']) {
      expect(within(row(name)).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
      expect(within(row(name)).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /create|new tag|add tag/i })).toBeNull();
    expect(api.listTags).toHaveBeenCalledWith(WS, {});
  });

  it('empty: no tags yet, no table', async () => {
    api.listTags.mockResolvedValue(list());
    renderSettings();
    await flush();
    expect(
      screen.getByText(
        'No tags yet. Tags are created on a contact, in the inbox or on the profile.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it("error: «Couldn't load the tags» + Retry reads again", async () => {
    api.listTags.mockRejectedValueOnce(new Error('offline'));
    renderSettings();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the tags");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('phone: the row-actions menu «⋯» holds Rename and Delete', async () => {
    renderSettings();
    await flush();
    openMenu('More actions for VIP');
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete «VIP»?' })).toBeInTheDocument();
  });
});

describe('SCR-21 owner actions (AC-09, AC-11, AC-14)', () => {
  it('a delete removes the row, re-reads the list and shows the success notice', async () => {
    api.deleteTag.mockResolvedValue({ workspace_id: WS, tag_id: OLD.id, removed_from_count: 40 });
    renderSettings();
    await flush();
    api.listTags.mockResolvedValue(list(KYIV, VIP, WHOLESALE));
    fireEvent.click(within(row('Old promo')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(api.deleteTag).toHaveBeenCalledWith(WS, OLD.id, { expected_count: 40 });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('row', { name: /^Old promo/ })).toBeNull();
    expect(screen.getByText('«Old promo» deleted.')).toBeInTheDocument();
    expect(api.listTags).toHaveBeenCalledTimes(2);
  });

  it('the success notice stays until the next action', async () => {
    api.deleteTag.mockResolvedValue({ workspace_id: WS, tag_id: OLD.id, removed_from_count: 40 });
    renderSettings();
    await flush();
    fireEvent.click(within(row('Old promo')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(screen.getByText('«Old promo» deleted.')).toBeInTheDocument();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByText('«Old promo» deleted.')).toBeNull();
  });

  it('tag gone: the dialog closes, the list re-reads, «This tag no longer exists.»', async () => {
    api.deleteTag.mockRejectedValue(refusal(404, ErrorCode.TAG_NOT_FOUND, { tag_id: OLD.id }));
    renderSettings();
    await flush();
    api.listTags.mockResolvedValue(list(KYIV, VIP, WHOLESALE));
    fireEvent.click(within(row('Old promo')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByText('This tag no longer exists.')).toBeInTheDocument();
    expect(api.listTags).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('row', { name: /^Old promo/ })).toBeNull();
  });

  it('owners only, lost meanwhile: 403 OWNER_ONLY shows the owners-only card', async () => {
    api.deleteTag.mockRejectedValue(refusal(403, ErrorCode.OWNER_ONLY));
    renderSettings();
    await flush();
    fireEvent.click(within(row('Kyiv')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(screen.getByText(OWNERS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('SCR-21 owners only (AC-11)', () => {
  it('an operator gets the owners-only card and Back to inbox, and nothing is read', async () => {
    renderSettings('operator');
    await flush();
    expect(screen.getByText(OWNERS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.listTags).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(await screen.findByText('inbox route')).toBeInTheDocument();
  });
});
