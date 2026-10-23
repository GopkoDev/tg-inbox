import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { stubRadixDom } from '@/test/radix';
import { getSampleContact, listSampleContacts } from './sample-source';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));
// The frame's attention read and live connection are not what these tests are about.
vi.mock('@/features/attention/api', () => ({
  getAttentionCount: async (id: string) => ({ workspace_id: id, count: 0 }),
}));
vi.mock('@/shared/api/live-connection', () => ({
  openLiveConnection: () => ({ close: () => undefined }),
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

/*
 * Accessible-name contract (implementer):
 *  - list page: h1 "Contacts"; exactly one "Sample data" text
 *  - table:   role=table, aria-label="Contacts"; one body row (role=row) per contact, plus one
 *             header row. Each body row contains: a role=link named (contains) the contact name,
 *             href /w/<ws>/contacts/<id>; the `@username` as text; one text element per tag
 *  - search:  textbox, name contains "Search by name or username" (case-insensitive match on
 *             name OR username; clearing it restores rows)
 *  - tags:    a button whose name starts with "Tags" (opens a popover); when N tags are checked its
 *             accessible name is exactly "Tags N" (visible count badge, e.g. <span>1</span>);
 *             popover holds one role=checkbox per distinct tag, named exactly the tag
 *  - empty:   text containing "No contacts match" replaces the table (no role=table);
 *             button "Clear filters" resets search box (value ''), unchecks all tags, restores rows
 *  - profile: h1 = contact name; `@username` text; each tag as text; "Sample data" (exactly one);
 *             role=tablist with role=tab "Overview" (aria-selected=true initially) and
 *             "Conversation history"; selecting the latter shows every history entry's text
 *  - not found: text "Page not found" inside the frame (sidebar toggle still present)
 */

const fetchSpy = vi.fn();

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return Object.assign(router, { unmount: view.unmount });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const all = () => listSampleContacts();
const table = () => screen.findByRole('table', { name: 'Contacts' });
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1);
const search = () => screen.getByRole('textbox', { name: /Search by name or username/i });
const typeSearch = (v: string) => fireEvent.change(search(), { target: { value: v } });
const tagsBtn = () => screen.getByRole('button', { name: /^Tags/ });
const rowNames = (t: HTMLElement) =>
  bodyRows(t).map((r) => within(r).getByRole('link').textContent?.trim());

async function checkTag(tag: string) {
  if (!screen.queryByRole('checkbox', { name: tag })) fireEvent.click(tagsBtn());
  fireEvent.click(await screen.findByRole('checkbox', { name: tag }));
}

function partialTag() {
  const tags = [...new Set(all().flatMap((c) => c.tags))];
  return tags.find((t) => {
    const n = all().filter((c) => c.tags.includes(t)).length;
    return n > 0 && n < all().length;
  })!;
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  listMyWorkspaces.mockResolvedValue({
    items: [acme, bolt],
    has_next: false,
    has_prev: false,
    next_cursor: null,
  });
  enterWorkspace.mockImplementation((id: string) => Promise.resolve(id === 'w2' ? bolt : acme));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contacts preview (T7)', () => {
  it('AC-15: lists every sample contact under a labelled title', async () => {
    renderAt('/w/w1/contacts');
    expect(await screen.findByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getAllByText('Sample data')).toHaveLength(1);
    const t = await table();
    expect(bodyRows(t)).toHaveLength(all().length);
    for (const c of all()) {
      const row = within(t)
        .getByRole('link', { name: new RegExp(esc(c.name)) })
        .closest('tr') as HTMLElement;
      expect(row).not.toBeNull();
      expect(within(row).getByText(c.username)).toBeInTheDocument();
      for (const tag of c.tags) expect(within(row).getByText(tag)).toBeInTheDocument();
    }
  });

  it('AC-15: searching narrows the rows by name or username, case-insensitively', async () => {
    renderAt('/w/w1/contacts');
    const t = await table();
    const c = all()[3]!;
    const byName = c.name.slice(0, 4).toUpperCase();
    typeSearch(byName);
    let expected = all().filter(
      (x) =>
        x.name.toLowerCase().includes(byName.toLowerCase()) ||
        x.username.toLowerCase().includes(byName.toLowerCase()),
    );
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(bodyRows(t)).toHaveLength(expected.length));
    expect(rowNames(t).some((n) => n?.includes(c.name))).toBe(true);

    const handle = c.username.slice(1).toUpperCase();
    typeSearch(handle);
    expected = all().filter(
      (x) =>
        x.name.toLowerCase().includes(handle.toLowerCase()) ||
        x.username.toLowerCase().includes(handle.toLowerCase()),
    );
    await waitFor(() => expect(bodyRows(t)).toHaveLength(expected.length));
    expect(within(t).getByText(c.username)).toBeInTheDocument();

    typeSearch('');
    await waitFor(() => expect(bodyRows(t)).toHaveLength(all().length));
  });

  it('AC-15: the tag filter narrows rows to the checked tag and the button shows the count', async () => {
    renderAt('/w/w1/contacts');
    const t = await table();
    const tag = partialTag();
    const expected = all().filter((c) => c.tags.includes(tag));
    expect(tagsBtn()).toHaveAccessibleName('Tags');
    await checkTag(tag);
    await waitFor(() => expect(bodyRows(t)).toHaveLength(expected.length));
    for (const c of expected) {
      expect(within(t).getByRole('link', { name: new RegExp(esc(c.name)) })).toBeInTheDocument();
    }
    expect(tagsBtn()).toHaveAccessibleName('Tags 1');
  });

  it('AC-15: clicking a contact opens its profile address', async () => {
    const c = all()[2]!;
    const router = renderAt('/w/w1/contacts');
    const t = await table();
    const link = within(t).getByRole('link', { name: new RegExp(esc(c.name)) });
    expect(link).toHaveAttribute('href', `/w/w1/contacts/${c.id}`);
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/w1/contacts/${c.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: c.name })).toBeInTheDocument();
  });

  it('AC-15: the profile shows the header card and both tabs; a saved link works', async () => {
    const c = all().find((x) => x.tags.length > 0)!;
    const full = getSampleContact(c.id)!;
    renderAt(`/w/w1/contacts/${c.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: c.name })).toBeInTheDocument();
    expect(screen.getAllByText(c.username).length).toBeGreaterThan(0);
    for (const tag of c.tags) expect(screen.getAllByText(tag).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sample data')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

    const history = screen.getByRole('tab', { name: 'Conversation history' });
    fireEvent.mouseDown(history, { button: 0 });
    await waitFor(() => expect(history).toHaveAttribute('aria-selected', 'true'));
    for (const h of full.history) {
      expect(screen.getAllByText(h.text).length).toBeGreaterThan(0);
    }
  });

  it('AC-15: an unknown contact shows the not-found card inside the frame', async () => {
    renderAt('/w/w1/contacts/nope');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument();
  });

  it('AC-16: a filter matching nothing shows the empty state; Clear filters restores everything', async () => {
    renderAt('/w/w1/contacts');
    const t = await table();
    await checkTag(partialTag());
    typeSearch('zzzz-no-such-contact');
    expect(await screen.findByText(/No contacts match/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Contacts' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const back = await table();
    expect(bodyRows(back)).toHaveLength(all().length);
    expect(search()).toHaveValue('');
    expect(tagsBtn()).toHaveAccessibleName('Tags');
    expect(screen.queryByText(/No contacts match/)).not.toBeInTheDocument();
    void t;
  });

  it('AC-17: no API call while rendering, and every workspace shows the same rows', async () => {
    const first = renderAt('/w/w1/contacts');
    const rows1 = bodyRows(await table()).map((r) => r.textContent);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows1.length).toBe(all().length);
    expect(listMyWorkspaces.mock.calls.length).toBeLessThanOrEqual(1);
    expect(enterWorkspace).toHaveBeenCalledTimes(1);

    first.unmount();
    renderAt('/w/w2/contacts');
    const rows2 = bodyRows(await table()).map((r) => r.textContent);
    expect(rows2).toEqual(rows1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AC-17: the profile is the same in every workspace and calls no API', async () => {
    const c = all()[0]!;
    renderAt(`/w/w2/contacts/${c.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: c.name })).toBeInTheDocument();
    expect(screen.getAllByText(c.username).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
