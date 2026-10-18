import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { stubRadixDom } from '@/test/radix';
import { getSampleConversation, listSampleConversations } from './sample-source';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

/*
 * Accessible-name contract (implementer):
 *  - list:    role=list, aria-label="Conversations"; each conversation is a role=listitem
 *             containing a role=link named (contains) the contact name, href /w/<ws>/inbox/<id>;
 *             the unread count is the exact text of an element inside the item (absent when 0)
 *  - thread:  role=region, aria-label="Conversation"; contains the contact name, `@username`
 *             and the messages as plain text
 *  - back (phone): link "Back to conversations"
 *  - reply:   textbox name "Reply", placeholder "Write a reply…"; button "Send" (disabled when invalid)
 *  - texts:   "Sample data", "Replies are limited to 4096 characters" (only when over),
 *             "Preview — nothing is sent to customers" (always, with the thread open)
 */

const fetchSpy = vi.fn();

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return Object.assign(router, { unmount: view.unmount });
}

function setMobile(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: mobile ? 500 : 1280, configurable: true });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const convos = () => listSampleConversations();
const list = () => screen.findByRole('list', { name: 'Conversations' });
const thread = () => screen.findByRole('region', { name: 'Conversation' });
const items = (l: HTMLElement) => within(l).getAllByRole('listitem');
const linkFor = (l: HTMLElement, name: string) =>
  within(l).getByRole('link', { name: new RegExp(esc(name)) });
const box = () => screen.getByRole('textbox', { name: 'Reply' });
const send = () => screen.getByRole('button', { name: 'Send' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

beforeEach(() => {
  stubRadixDom();
  setMobile(false);
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
  setMobile(false);
  vi.unstubAllGlobals();
});

describe('inbox preview (T6)', () => {
  it('AC-12: lists every sample conversation under a labelled title', async () => {
    renderAt('/w/w1/inbox');
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    const l = await list();
    expect(items(l)).toHaveLength(convos().length);
    for (const c of convos()) {
      const item = linkFor(l, c.name).closest('li') as HTMLElement;
      expect(item).not.toBeNull();
      expect(within(item).getByText(c.lastMessage)).toBeInTheDocument();
      if (c.unread > 0) expect(within(item).getByText(String(c.unread))).toBeInTheDocument();
    }
  });

  it('AC-12: picking a conversation opens its thread and clears its unread count', async () => {
    const c = convos().find((x) => x.unread > 0)!;
    const full = getSampleConversation(c.id)!;
    const router = renderAt('/w/w1/inbox');
    const l = await list();
    fireEvent.click(linkFor(l, c.name));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/w1/inbox/${c.id}`));
    const t = await thread();
    expect(within(t).getByText(c.name)).toBeInTheDocument();
    expect(within(t).getByText(c.username)).toBeInTheDocument();
    for (const m of full.messages) {
      expect(within(t).getAllByText(m.text).length).toBeGreaterThan(0);
    }
    const item = linkFor(await list(), c.name).closest('li') as HTMLElement;
    expect(within(item).queryByText(String(c.unread))).not.toBeInTheDocument();
  });

  it('AC-12: a saved link opens the same thread', async () => {
    const c = convos()[2]!;
    renderAt(`/w/w1/inbox/${c.id}`);
    const t = await thread();
    expect(within(t).getByText(c.name)).toBeInTheDocument();
    expect(within(t).getByText(c.username)).toBeInTheDocument();
    for (const m of getSampleConversation(c.id)!.messages) {
      expect(within(t).getAllByText(m.text).length).toBeGreaterThan(0);
    }
  });

  it('AC-12: an unknown conversation shows the not-found card inside the frame', async () => {
    renderAt('/w/w1/inbox/nope');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Conversation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument();
  });

  it('AC-13: send is disabled for empty, spaces and over-long text, with the limit message', async () => {
    renderAt(`/w/w1/inbox/${convos()[0]!.id}`);
    await thread();
    expect(box()).toHaveAttribute('placeholder', 'Write a reply…');
    expect(send()).toBeDisabled();
    type('   ');
    expect(send()).toBeDisabled();
    expect(screen.queryByText('Replies are limited to 4096 characters')).not.toBeInTheDocument();
    type('a'.repeat(4097));
    expect(send()).toBeDisabled();
    expect(screen.getByText('Replies are limited to 4096 characters')).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(within(await thread()).queryByText('a'.repeat(4097))).not.toBeInTheDocument();
    type('a'.repeat(4096));
    expect(send()).toBeEnabled();
    expect(screen.queryByText('Replies are limited to 4096 characters')).not.toBeInTheDocument();
  });

  it('AC-13: the limit message is tied to the textarea while the reply is too long', async () => {
    renderAt(`/w/w1/inbox/${convos()[0]!.id}`);
    await thread();
    expect(box()).not.toHaveAttribute('aria-describedby');
    type('a'.repeat(4097));
    const id = box().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent(
      'Replies are limited to 4096 characters',
    );
    type('ok');
    expect(box()).not.toHaveAttribute('aria-describedby');
  });

  it('AC-13: Shift+Enter does not send; Enter sends a valid reply', async () => {
    renderAt(`/w/w1/inbox/${convos()[0]!.id}`);
    const t = await thread();
    type('Hello there');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(within(t).queryByText('Hello there')).not.toBeInTheDocument();
    expect(box()).toHaveValue('Hello there');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(await within(t).findByText('Hello there')).toBeInTheDocument();
    expect(box()).toHaveValue('');
  });

  it('AC-14: a sent reply ends the thread, tops the list and is dropped on switching', async () => {
    const [first, second] = [convos()[3]!, convos()[5]!];
    renderAt(`/w/w1/inbox/${first.id}`);
    const t = await thread();
    expect(screen.getByText('Preview — nothing is sent to customers')).toBeInTheDocument();
    type('See you at 6');
    fireEvent.click(send());
    expect(await within(t).findByText('See you at 6')).toBeInTheDocument();

    const l = await list();
    const top = items(l)[0]!;
    expect(within(top).getByText(first.name)).toBeInTheDocument();
    expect(within(top).getByText('See you at 6')).toBeInTheDocument();

    fireEvent.click(linkFor(l, second.name));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Conversation' })).getByText(second.username),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('See you at 6')).not.toBeInTheDocument();
    fireEvent.click(linkFor(await list(), first.name));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Conversation' })).getByText(first.username),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('See you at 6')).not.toBeInTheDocument();
    expect(screen.getByText('Preview — nothing is sent to customers')).toBeInTheDocument();
  });

  it('AC-14: a sent reply is gone after switching to another workspace', async () => {
    const c = convos()[3]!;
    const router = renderAt(`/w/w1/inbox/${c.id}`);
    const t = await thread();
    type('Only for Acme');
    fireEvent.click(send());
    expect(await within(t).findByText('Only for Acme')).toBeInTheDocument();

    await act(() => router.navigate(`/w/w2/inbox/${c.id}`));
    expect(await screen.findByRole('button', { name: /Bolt Bikes/ })).toBeInTheDocument();
    await thread();
    expect(screen.queryByText('Only for Acme')).not.toBeInTheDocument();
    expect(box()).toHaveValue('');
  });

  it('AC-14: a sent reply is gone after visiting contacts and coming back', async () => {
    const c = convos()[3]!;
    const router = renderAt(`/w/w1/inbox/${c.id}`);
    const t = await thread();
    type('Gone after contacts');
    fireEvent.click(send());
    expect(await within(t).findByText('Gone after contacts')).toBeInTheDocument();

    await act(() => router.navigate('/w/w1/contacts'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument();
    await act(() => router.navigate(`/w/w1/inbox/${c.id}`));
    await thread();
    expect(screen.queryByText('Gone after contacts')).not.toBeInTheDocument();
  });

  it('AC-14: typed markup is shown as literal text', async () => {
    renderAt(`/w/w1/inbox/${convos()[0]!.id}`);
    const t = await thread();
    type('<b>x</b>');
    fireEvent.click(send());
    expect(await within(t).findByText('<b>x</b>')).toBeInTheDocument();
    expect(t.querySelector('b')).toBeNull();
  });

  it('AC-12b: on a phone the list and the thread replace each other', async () => {
    setMobile(true);
    const c = convos()[1]!;
    renderAt('/w/w1/inbox');
    const l = await list();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    fireEvent.click(linkFor(l, c.name));

    const t = await thread();
    expect(within(t).getByText(c.username)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Conversations' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to conversations' }));

    expect(await list()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to conversations' })).not.toBeInTheDocument();
    await act(async () => undefined);
  });

  it('AC-12: a search with no match shows the empty state and Clear search restores the list', async () => {
    renderAt('/w/w1/inbox');
    const l = await list();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
      target: { value: 'zzzz-no-such-name' },
    });
    expect(screen.getByText('No conversations match')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Conversations' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(items(await list())).toHaveLength(items(l).length);
    expect(screen.queryByText('No conversations match')).not.toBeInTheDocument();
  });

  it('AC-17: no API call while rendering, and every workspace shows the same data', async () => {
    const first = renderAt('/w/w1/inbox');
    const names1 = items(await list()).map((li) => li.textContent);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(names1.length).toBe(convos().length);
    // workspace entry itself goes through the mocked workspaces api; nothing else may be called
    expect(listMyWorkspaces.mock.calls.length).toBeLessThanOrEqual(1);
    expect(enterWorkspace).toHaveBeenCalledTimes(1);

    first.unmount();
    renderAt('/w/w2/inbox');
    const names2 = items(await list()).map((li) => li.textContent);
    expect(names2).toEqual(names1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
