import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type ContactProfile as ContactProfileDto,
  type ConversationSummary,
  type LiveFrame,
  type TagHistoryEntry,
  type TagHistoryPage,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getContact: vi.fn(),
  listContactTagHistory: vi.fn(),
  getContactConversation: vi.fn(),
  listThreadItems: vi.fn(),
  markConversationRead: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getContact: (...a: unknown[]) => api.getContact(...a),
  listContactTagHistory: (...a: unknown[]) => api.listContactTagHistory(...a),
  getContactConversation: (...a: unknown[]) => api.getContactConversation(...a),
}));
vi.mock('@/features/inbox/api-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/api-source')>()),
  listThreadItems: (...a: unknown[]) => api.listThreadItems(...a),
  markConversationRead: (...a: unknown[]) => api.markConversationRead(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: Record<string, (...a: never[]) => void> }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: (workspaceId: string, subscriber: Record<string, (...a: never[]) => void>) => {
    const entry = { workspaceId, subscriber };
    live.subs.push(entry);
    return () => {
      live.subs = live.subs.filter((e) => e !== entry);
    };
  },
}));

import { formatBotClock, formatBotDay } from '@/features/bot/settings/format';
import { formatFullDay } from './format';
import { ContactProfile } from './ContactProfile';
import { useContactsStore } from './store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const C1 = '0198f0c0-0000-7000-8000-000000000901';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));

const profile = (over: Partial<ContactProfileDto> = {}): ContactProfileDto => ({
  id: C1,
  workspace_id: WS,
  first_name: 'Ada',
  last_name: 'Lovelace',
  username: 'ada',
  language_code: 'uk',
  first_wrote_at: '2026-09-02T09:00:00Z',
  last_wrote_at: ago(3 * 60_000),
  tags: [
    {
      id: id(301),
      name: 'Kyiv',
      added_by: { account_id: id(800), display_name: 'Test User' },
      added_at: '2026-10-19T10:02:00Z',
    },
    {
      id: id(302),
      name: 'VIP',
      added_by: { account_id: id(801), display_name: 'Lena Leaver' },
      added_at: '2026-10-18T09:00:00Z',
    },
  ],
  ...over,
});
const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: CONV,
  workspace_id: WS,
  contact: { id: C1, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
  last_activity_at: ago(3 * 60_000),
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 2,
  waiting_for_reply: true,
  status: 'open',
  assignee: { account_id: id(802), display_name: 'Test User 2' },
  state_version: 1,
  close_snapshot: { customer_message_seq: 1, latest_reply: null },
  ...over,
});
const historyEntry = (n: number, over: Partial<TagHistoryEntry> = {}): TagHistoryEntry => ({
  id: id(700 + n),
  kind: 'added',
  tag_id: id(301),
  tag_name: 'Kyiv',
  merged_into_tag_id: null,
  merged_into_name: null,
  actor: { account_id: id(800), display_name: 'Test User' },
  source: 'inbox',
  created_at: '2026-10-19T10:02:00Z',
  ...over,
});
const historyPage = (items: TagHistoryEntry[] = []): TagHistoryPage => ({
  workspace_id: WS,
  contact_id: C1,
  items,
  has_prev: false,
  has_next: false,
  next_cursor: null,
});
const threadPage = {
  workspace_id: WS,
  conversation_id: CONV,
  items: [],
  has_prev: false,
  has_next: false,
  prev_cursor: null,
  next_cursor: null,
  read_through_at: null,
  newest_reply_id: null,
};

function renderProfile() {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <ContactProfile workspaceId={WS} contactId={C1} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const emit = (f: Record<string, unknown>) => {
  for (const s of live.subs)
    (s.subscriber.onFrame as (f: LiveFrame) => void)({ v: 1, workspace_id: WS, ...f } as LiveFrame);
};
const openTab = (name: string) => {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};

beforeEach(() => {
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  api.getContact.mockResolvedValue(profile());
  api.listContactTagHistory.mockResolvedValue(historyPage([historyEntry(1)]));
  api.getContactConversation.mockResolvedValue(summary());
  api.listThreadItems.mockResolvedValue(threadPage);
  useContactsStore.getState().clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('SCR-19 header card', () => {
  it('shows a skeleton avatar, name and fact lines while the contact loads', () => {
    api.getContact.mockReturnValue(new Promise(() => undefined));
    renderProfile();
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows the name as h1, the @username, the facts line and each tag with who added it and when', async () => {
    renderProfile();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Ukrainian · First wrote ${formatFullDay('2026-09-02T09:00:00Z')} · Last wrote 3 min ago`,
      ),
    ).toBeInTheDocument();
    const kyiv = screen.getByText('Kyiv');
    expect(kyiv).toHaveAttribute(
      'title',
      `Added by Test User, ${formatBotDay('2026-10-19T10:02:00Z')}, ${formatBotClock('2026-10-19T10:02:00Z')}`,
    );
    // a member deactivated since is shown by name like any member
    expect(screen.getByText('VIP')).toHaveAttribute(
      'title',
      expect.stringContaining('Added by Lena Leaver'),
    );
  });

  it('shows words, not blanks: no username, Unknown, Never, and «No tags»', async () => {
    api.getContact.mockResolvedValue(
      profile({
        last_name: null,
        username: null,
        language_code: null,
        first_wrote_at: null,
        last_wrote_at: null,
        tags: [],
      }),
    );
    renderProfile();
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByText('no username')).toBeInTheDocument();
    expect(screen.getByText('Unknown · First wrote Never · Last wrote Never')).toBeInTheDocument();
    expect(screen.getByText('No tags')).toBeInTheDocument();
  });

  it('renders a name with markup as plain text', async () => {
    api.getContact.mockResolvedValue(
      profile({ first_name: '<img src=x onerror=alert(1)>', last_name: null }),
    );
    renderProfile();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(heading.querySelector('img')).toBeNull();
  });

  it('stacks on a phone: the avatar row and the card use the responsive classes', async () => {
    renderProfile();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.closest('[data-slot="card-content"]')!.className).toMatch(/flex-col/);
    expect(heading.closest('[data-slot="card-content"]')!.className).toMatch(/sm:flex-row/);
  });
});

describe('SCR-19 conversation card', () => {
  it('shows the status, the assignee, the waiting marker and Open in inbox', async () => {
    renderProfile();
    const open = await screen.findByRole('link', { name: 'Open in inbox' });
    expect(open).toHaveAttribute('href', `/w/${WS}/inbox/${CONV}`);
    expect(open.className).toMatch(/w-full/);
    const card = open.closest('[data-slot="card"]') as HTMLElement;
    expect(within(card).getByText('Open')).toBeInTheDocument();
    expect(within(card).getByText('Assigned to Test User 2')).toBeInTheDocument();
    expect(within(card).getByText('Waiting for a reply')).toBeInTheDocument();
  });

  it('shows Closed, Unassigned and no waiting marker', async () => {
    api.getContactConversation.mockResolvedValue(
      summary({ status: 'closed', assignee: null, waiting_for_reply: false }),
    );
    renderProfile();
    const open = await screen.findByRole('link', { name: 'Open in inbox' });
    const card = open.closest('[data-slot="card"]') as HTMLElement;
    expect(within(card).getByText('Closed')).toBeInTheDocument();
    expect(within(card).getByText('Unassigned')).toBeInTheDocument();
    expect(within(card).queryByText('Waiting for a reply')).not.toBeInTheDocument();
  });

  it('reads «No conversation to show» with no Open in inbox when the contact has none', async () => {
    api.getContactConversation.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    renderProfile();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() =>
      expect(screen.getAllByText('No conversation to show').length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('link', { name: 'Open in inbox' })).not.toBeInTheDocument();
  });

  it("shows «Couldn't load the conversation» with Retry in the card, the header stays", async () => {
    api.getContactConversation.mockRejectedValueOnce(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'),
    );
    renderProfile();
    expect((await screen.findAllByText("Couldn't load the conversation")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    api.getContactConversation.mockResolvedValueOnce(summary());
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(await screen.findByRole('link', { name: 'Open in inbox' })).toBeInTheDocument();
  });

  it('shows a skeleton badge row while the conversation loads', () => {
    api.getContactConversation.mockReturnValue(new Promise(() => undefined));
    renderProfile();
    expect(screen.getByTestId('conversation-skeleton')).toBeInTheDocument();
  });
});

describe('SCR-19 not found, error and tabs', () => {
  it('shows the not-found card inside the frame, with no conversation part', async () => {
    api.getContact.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    renderProfile();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open in inbox' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it("shows «Couldn't load this contact» with Retry in place of the header card", async () => {
    api.getContact.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    renderProfile();
    expect(await screen.findByText("Couldn't load this contact")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    api.getContact.mockResolvedValueOnce(profile());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('hands a 401 to the guard', async () => {
    api.getContact.mockRejectedValue(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'));
    renderProfile();
    await waitFor(() => expect(guard).toHaveBeenCalled());
    expect(guard.mock.calls[0]![1]).toBe(WS);
  });

  it('has the Conversation tab selected and the Tag history tab with the entries', async () => {
    renderProfile();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tablist').className).toMatch(/w-full/);
    openTab('Tag history');
    expect(await screen.findByText(/Test User added «Kyiv» · inbox/)).toBeInTheDocument();
  });
});

describe('SCR-19 live', () => {
  it('contact.changed re-reads the tags and the tag history in place', async () => {
    renderProfile();
    await screen.findByRole('heading', { level: 1 });
    openTab('Tag history');
    await screen.findByText(/Test User added «Kyiv»/);
    api.getContact.mockResolvedValue(profile({ tags: [profile().tags[0]!] }));
    api.listContactTagHistory.mockResolvedValue(
      historyPage([historyEntry(2, { kind: 'removed', tag_name: 'VIP' }), historyEntry(1)]),
    );
    act(() => emit({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    await waitFor(() =>
      expect(screen.queryByText('VIP', { selector: '[title]' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/Test User removed «VIP»/)).toBeInTheDocument();
  });

  it('shows a renamed tag under its new name after tags.changed', async () => {
    renderProfile();
    await screen.findByText('Kyiv');
    api.getContact.mockResolvedValue(
      profile({ tags: [{ ...profile().tags[0]!, name: 'Capital' }] }),
    );
    act(() => emit({ type: 'tags.changed' }));
    expect(await screen.findByText('Capital')).toBeInTheDocument();
    expect(screen.queryByText('Kyiv')).not.toBeInTheDocument();
  });

  it('conversation.changed updates status, assignee and the waiting marker in place and shows a new name; nothing is marked read', async () => {
    renderProfile();
    await screen.findByText('Assigned to Test User 2');
    api.getContactConversation.mockResolvedValue(
      summary({ status: 'closed', assignee: null, waiting_for_reply: false }),
    );
    api.getContact.mockResolvedValue(profile({ first_name: 'Adeline' }));
    act(() =>
      emit({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: null,
        change: 'state',
      }),
    );
    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for a reply')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Adeline Lovelace' }),
    ).toBeInTheDocument();
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('listens while open and stops when it closes', async () => {
    const view = renderProfile();
    await screen.findByRole('heading', { level: 1 });
    expect(live.subs).toHaveLength(1);
    view.unmount();
    await settle();
    expect(live.subs).toHaveLength(0);
    expect(useContactsStore.getState().profile).toBeNull();
  });
});
