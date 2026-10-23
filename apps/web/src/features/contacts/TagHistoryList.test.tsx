import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagHistoryEntry } from '@tg/shared';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { formatHistoryTime } from './format';

const api = vi.hoisted(() => ({ listContactTagHistory: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listContactTagHistory: (...a: unknown[]) => api.listContactTagHistory(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { useContactsStore, type HistoryState } from './store';
import { TagHistoryList } from './TagHistoryList';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const C1 = '0198f0c0-0000-7000-8000-000000000901';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 10, min)).toISOString();
const guard = vi.fn();

const entry = (n: number, over: Partial<TagHistoryEntry> = {}): TagHistoryEntry => ({
  id: id(700 + n),
  kind: 'added',
  tag_id: id(300 + n),
  tag_name: 'Kyiv',
  merged_into_tag_id: null,
  merged_into_name: null,
  actor: { account_id: id(800), display_name: 'Test User' },
  source: 'inbox',
  created_at: at(n),
  ...over,
});
const seed = (over: Partial<HistoryState> = {}) =>
  useContactsStore.setState({
    workspaceId: WS,
    history: {
      contactId: C1,
      status: 'ready',
      items: [],
      hasNext: false,
      nextCursor: null,
      more: 'idle',
      ...over,
    },
  });
const renderList = () =>
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <TagHistoryList workspaceId={WS} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );

const observers: { cb: IntersectionObserverCallback; el: Element }[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        observers.push({ cb: this.cb, el });
      }
      disconnect() {}
      unobserve() {}
    },
  );
  useContactsStore.getState().clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('TagHistoryList lines', () => {
  it('composes one line per kind from the names then and the actor: added, removed, merged, deleted', () => {
    seed({
      items: [
        entry(4, { kind: 'removed', tag_name: 'Wholesale', source: 'profile' }),
        entry(3, { kind: 'added', tag_name: 'Kyiv', source: 'inbox' }),
        entry(2, {
          kind: 'merged',
          tag_name: 'Loyal',
          merged_into_tag_id: id(302),
          merged_into_name: 'VIP',
          actor: { account_id: id(801), display_name: 'Test Owner' },
          source: 'settings',
        }),
        entry(1, {
          kind: 'deleted',
          tag_name: 'Old promo',
          actor: { account_id: id(801), display_name: 'Test Owner' },
          source: 'settings',
        }),
      ],
    });
    renderList();
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      `Test User removed «Wholesale» · profile · ${formatHistoryTime(at(4))}`,
      `Test User added «Kyiv» · inbox · ${formatHistoryTime(at(3))}`,
      `Test Owner merged «Loyal» into «VIP» · ${formatHistoryTime(at(2))}`,
      `«Old promo» removed by Test Owner's delete · ${formatHistoryTime(at(1))}`,
    ]);
  });

  it('shows a deactivated actor by display name like any member, and a tag name with markup as plain text', () => {
    seed({
      items: [
        entry(1, {
          tag_name: '<b>bold</b>',
          actor: { account_id: id(802), display_name: 'Lena Leaver' },
        }),
      ],
    });
    renderList();
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('Lena Leaver added «<b>bold</b>»');
    expect(item.querySelector('b')).toBeNull();
  });
});

describe('TagHistoryList states', () => {
  it('shows five line skeletons while the first page loads', () => {
    seed({ status: 'loading' });
    renderList();
    expect(screen.getAllByTestId('history-skeleton')).toHaveLength(5);
  });

  it('says «No tag changes yet» when there is no entry', () => {
    seed();
    renderList();
    expect(screen.getByText('No tag changes yet')).toBeInTheDocument();
  });

  it("shows «Couldn't load the tag history» with Retry that reads again", () => {
    seed({ status: 'error' });
    api.listContactTagHistory.mockResolvedValue({
      workspace_id: WS,
      contact_id: C1,
      items: [],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    renderList();
    expect(screen.getByText("Couldn't load the tag history")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.listContactTagHistory).toHaveBeenCalledWith(WS, C1, {}, {});
  });

  it('loads the next page by after when scrolled to the end, with a skeleton line while it loads', () => {
    seed({ items: [entry(1)], hasNext: true, nextCursor: 'h1' });
    api.listContactTagHistory.mockReturnValue(new Promise(() => undefined));
    renderList();
    expect(observers).toHaveLength(1);
    act(() => {
      observers[0]!.cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(api.listContactTagHistory).toHaveBeenCalledWith(WS, C1, { after: 'h1' }, {});
    expect(screen.getAllByTestId('history-skeleton')).toHaveLength(1);
  });

  it('does not watch for the end when there is no next page', () => {
    seed({ items: [entry(1)] });
    renderList();
    expect(observers).toHaveLength(0);
  });

  it('keeps the entries and offers Retry when a next page fails', () => {
    seed({ items: [entry(1)], hasNext: true, nextCursor: 'h1', more: 'error' });
    api.listContactTagHistory.mockReturnValue(new Promise(() => undefined));
    renderList();
    expect(screen.getByText("Couldn't load more tag changes")).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.listContactTagHistory).toHaveBeenCalledWith(WS, C1, { after: 'h1' }, {});
  });
});
