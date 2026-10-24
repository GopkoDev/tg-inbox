import {
  ErrorCode,
  type BroadcastDraft,
  type BroadcastGroupMatching,
  type ContactPage,
  type ContactRow,
  type TagWithCount,
} from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTagsStore } from '@/features/tags/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  listBroadcastGroup: vi.fn(),
  getBroadcastGroupMembership: vi.fn(),
  addBroadcastGroupContact: vi.fn(),
  countBroadcastGroupMatching: vi.fn(),
  addBroadcastGroupMatching: vi.fn(),
  listContacts: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  listBroadcastGroup: (...a: unknown[]) => api.listBroadcastGroup(...a),
  getBroadcastGroupMembership: (...a: unknown[]) => api.getBroadcastGroupMembership(...a),
  addBroadcastGroupContact: (...a: unknown[]) => api.addBroadcastGroupContact(...a),
  countBroadcastGroupMatching: (...a: unknown[]) => api.countBroadcastGroupMatching(...a),
  addBroadcastGroupMatching: (...a: unknown[]) => api.addBroadcastGroupMatching(...a),
}));
vi.mock('@/features/contacts/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/contacts/api')>()),
  listContacts: (...a: unknown[]) => api.listContacts(...a),
}));
vi.mock('@/features/tags/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tags/api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { useBroadcastDraftStore } from './draft-store';
import { GroupPicker } from './GroupPicker';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DRAFT = id(501);
const OLENA = id(201);
const PETRO = id(202);
const IVAN = id(203);
const WHOLESALE = id(301);
const ref = { account_id: id(11), display_name: 'Test User' };
const TAGS: TagWithCount[] = [{ id: WHOLESALE, name: 'Wholesale', contact_count: 14 }];

const draft = (size: number): BroadcastDraft => ({
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
    reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: size },
  },
});

const contact = (contactId: string, first: string, o: Partial<ContactRow> = {}): ContactRow => ({
  id: contactId,
  workspace_id: WS,
  first_name: first,
  last_name: null,
  username: null,
  language_code: null,
  first_wrote_at: '2026-10-01T09:00:00Z',
  last_wrote_at: '2026-10-20T09:00:00Z',
  tags: [],
  blocked_since: null,
  ...o,
});

const CONTACTS = [
  contact(OLENA, 'Olena', {
    last_name: 'K.',
    username: 'olena_k',
    tags: [{ id: WHOLESALE, name: 'Wholesale' }],
  }),
  contact(PETRO, 'Petro', { blocked_since: '2026-10-20T09:00:00Z' }),
  contact(IVAN, 'Ivan'),
];

const contactPage = (items: ContactRow[], o: Partial<ContactPage> = {}): ContactPage => ({
  workspace_id: WS,
  filter: { q: null, mode: 'any', tag_ids: [] },
  items,
  has_prev: false,
  has_next: false,
  next_cursor: null,
  matching_count: 120,
  total_count: 120,
  missing_tag_ids: [],
  ...o,
});

const matching = (o: Partial<BroadcastGroupMatching> = {}): BroadcastGroupMatching => ({
  broadcast_id: DRAFT,
  matching_count: 14,
  already_in_group_count: 1,
  to_add_count: 13,
  can_add: 9_986,
  missing_tag_ids: [],
  ...o,
});

const guard = vi.fn();
const onClose = vi.fn();

async function show() {
  api.getBroadcast.mockResolvedValue(draft(1));
  await useBroadcastDraftStore.getState().open(WS, DRAFT, guard);
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <GroupPicker workspaceId={WS} broadcastId={DRAFT} open onClose={onClose} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
  return screen.getByRole('dialog', { name: 'Add contacts' });
}

const rowOf = (contactId: string) => screen.getByTestId(`picker-row-${contactId}`);
const search = () => screen.getByRole('textbox', { name: 'Search by name or username' });

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
  useTagsStore.getState().clear();
  api.listTags.mockResolvedValue({ items: TAGS });
  api.listBroadcastGroup.mockReturnValue(new Promise(() => undefined));
  api.listContacts.mockResolvedValue(contactPage(CONTACTS));
  api.getBroadcastGroupMembership.mockResolvedValue({ broadcast_id: DRAFT, contact_ids: [PETRO] });
  api.countBroadcastGroupMatching.mockResolvedValue(
    matching({ matching_count: 120, already_in_group_count: 1, to_add_count: 119 }),
  );
});

describe('SCR-26 — the group picker (AC-04, AC-05)', () => {
  it('loading: 8 skeleton rows while the contacts are read', async () => {
    api.listContacts.mockReturnValue(new Promise(() => undefined));
    await show();
    expect(screen.getAllByTestId('picker-skeleton')).toHaveLength(8);
  });

  it('default: the Contacts list rows with In group ✓ or Add, the blocked marker, the count and Add all matching', async () => {
    await show();
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
    expect(api.listContacts).toHaveBeenCalledWith(WS, { q: '', mode: 'any', tag: [] });
    await waitFor(() =>
      expect(api.getBroadcastGroupMembership).toHaveBeenCalledWith(WS, DRAFT, [OLENA, PETRO, IVAN]),
    );
    expect(await within(rowOf(PETRO)).findByText('In group ✓')).toBeInTheDocument();
    expect(within(rowOf(PETRO)).getByText('Blocked the bot')).toBeInTheDocument();
    expect(within(rowOf(OLENA)).getByRole('button', { name: 'Add Olena K.' })).toBeEnabled();
    expect(within(rowOf(OLENA)).getByText('@olena_k')).toBeInTheDocument();
    expect(within(rowOf(OLENA)).getByText('Wholesale')).toBeInTheDocument();
    expect(screen.getByText('120 contacts')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Add all matching (119)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('the search (300 ms) and the tag filter read the Contacts list the same way, with «N of M contacts match»', async () => {
    await show();
    await screen.findByText('Olena K.');
    api.listContacts.mockResolvedValue(
      contactPage(CONTACTS.slice(0, 1), { matching_count: 14, total_count: 120 }),
    );
    api.countBroadcastGroupMatching.mockResolvedValue(matching());
    fireEvent.change(search(), { target: { value: '  kyiv ' } });
    await waitFor(
      () =>
        expect(api.listContacts).toHaveBeenLastCalledWith(WS, { q: 'kyiv', mode: 'any', tag: [] }),
      { timeout: 2_000 },
    );
    expect(await screen.findByText('14 of 120 contacts match')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.countBroadcastGroupMatching).toHaveBeenLastCalledWith(WS, DRAFT, {
        q: 'kyiv',
        mode: 'any',
        tag: [],
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Add all matching (13)' }),
    ).toBeInTheDocument();

    await waitFor(() => expect(useTagsStore.getState().status).toBe('ready'));
    fireEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Wholesale/ }));
    await waitFor(() =>
      expect(api.listContacts).toHaveBeenLastCalledWith(WS, {
        q: 'kyiv',
        mode: 'any',
        tag: [WHOLESALE],
      }),
    );
  });

  it('Add one: a spinner, then In group ✓', async () => {
    let answer!: (v: unknown) => void;
    api.addBroadcastGroupContact.mockReturnValue(new Promise((r) => (answer = r)));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Olena K.' }));
    expect(within(rowOf(OLENA)).getByTestId('add-spinner')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.addBroadcastGroupContact).toHaveBeenCalledWith(WS, DRAFT, { contact_id: OLENA }),
    );
    await act(async () => answer({ broadcast_id: DRAFT, outcome: 'added', group_size: 2 }));
    expect(within(rowOf(OLENA)).getByText('In group ✓')).toBeInTheDocument();
    expect(useBroadcastDraftStore.getState().draft?.audience).toEqual({ kind: 'group', size: 2 });
  });

  it('a contact a teammate already added: In group ✓ and «Already in this group» for 3 s', async () => {
    api.addBroadcastGroupContact.mockResolvedValue({
      broadcast_id: DRAFT,
      outcome: 'unchanged',
      group_size: 2,
    });
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Ivan' }));
    expect(await within(rowOf(IVAN)).findByText('In group ✓')).toBeInTheDocument();
    expect(within(rowOf(IVAN)).getByText('Already in this group')).toBeInTheDocument();
    await waitFor(
      () => expect(within(rowOf(IVAN)).queryByText('Already in this group')).toBeNull(),
      { timeout: 4_000 },
    );
  }, 10_000);

  it("a failed add: «Couldn't add — Retry» on the row", async () => {
    api.addBroadcastGroupContact
      .mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'))
      .mockResolvedValueOnce({ broadcast_id: DRAFT, outcome: 'added', group_size: 2 });
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Ivan' }));
    expect(await within(rowOf(IVAN)).findByText("Couldn't add")).toBeInTheDocument();
    fireEvent.click(within(rowOf(IVAN)).getByRole('button', { name: 'Retry' }));
    expect(await within(rowOf(IVAN)).findByText('In group ✓')).toBeInTheDocument();
  });

  it('a contact that is gone: the page is read again and the picker says so', async () => {
    api.addBroadcastGroupContact.mockRejectedValue(
      new ApiError(404, ErrorCode.NOT_FOUND, 'Not found'),
    );
    await show();
    await screen.findByText('Ivan');
    api.listContacts.mockResolvedValue(contactPage(CONTACTS.slice(0, 2)));
    fireEvent.click(screen.getByRole('button', { name: 'Add Ivan' }));
    expect(await screen.findByText('This contact is no longer available.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Ivan')).toBeNull());
  });

  it('Add all matching asks first, then adds the 13 with the search, the filter and the count', async () => {
    api.listContacts.mockResolvedValue(contactPage(CONTACTS, { matching_count: 14 }));
    api.countBroadcastGroupMatching.mockResolvedValue(matching());
    api.addBroadcastGroupMatching.mockResolvedValue({
      broadcast_id: DRAFT,
      expected_count: 13,
      added_count: 13,
      group_size: 14,
    });
    await show();
    fireEvent.change(search(), { target: { value: 'kyiv' } });
    const addAll = await screen.findByRole('button', { name: 'Add all matching (13)' });
    await waitFor(() =>
      expect(api.countBroadcastGroupMatching).toHaveBeenLastCalledWith(WS, DRAFT, {
        q: 'kyiv',
        mode: 'any',
        tag: [],
      }),
    );
    fireEvent.click(addAll);
    expect(screen.getByText('Add 13 contacts to this group?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText('Add 13 contacts to this group?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add all matching (13)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 13' }));
    expect(await screen.findByText('13 contacts added.')).toBeInTheDocument();
    expect(api.addBroadcastGroupMatching).toHaveBeenCalledWith(WS, DRAFT, {
      q: 'kyiv',
      mode: 'any',
      tag_ids: [],
      expected_count: 13,
    });
    expect(useBroadcastDraftStore.getState().draft?.audience).toEqual({ kind: 'group', size: 14 });
  });

  it('matches that changed between the count and the confirmation: the current ones are added and the picker says how many', async () => {
    api.countBroadcastGroupMatching.mockResolvedValue(matching());
    api.addBroadcastGroupMatching.mockResolvedValue({
      broadcast_id: DRAFT,
      expected_count: 13,
      added_count: 12,
      group_size: 13,
    });
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all matching (13)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 13' }));
    expect(
      await screen.findByText('The matching contacts changed — 12 were added.'),
    ).toBeInTheDocument();
  });

  it('too large: the refusal with the room left shows instead of the confirmation; nothing is sent', async () => {
    api.countBroadcastGroupMatching.mockResolvedValue(
      matching({ matching_count: 50, already_in_group_count: 0, to_add_count: 50, can_add: 10 }),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all matching (50)' }));
    expect(
      screen.getByText(
        "A broadcast's audience can hold at most 10 000 contacts — 10 more can be added.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/to this group\?/)).toBeNull();
    expect(api.addBroadcastGroupMatching).not.toHaveBeenCalled();
  });

  it('too large at the confirmation (409): the refusal names the room left, «no more» at 0', async () => {
    api.countBroadcastGroupMatching.mockResolvedValue(matching());
    api.addBroadcastGroupMatching.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE, 'too large', {
        limit: 10_000,
        audience_size: 10_000,
        can_add: 0,
      }),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all matching (13)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 13' }));
    expect(
      await screen.findByText(
        "A broadcast's audience can hold at most 10 000 contacts — no more can be added.",
      ),
    ).toBeInTheDocument();
  });

  it('empty: nothing matches → Clear search and filter; no contacts at all → «No contacts yet.»', async () => {
    api.listContacts.mockResolvedValue(contactPage([], { matching_count: 0, total_count: 120 }));
    await show();
    fireEvent.change(search(), { target: { value: 'zzz' } });
    await waitFor(() =>
      expect(api.listContacts).toHaveBeenLastCalledWith(WS, { q: 'zzz', mode: 'any', tag: [] }),
    );
    expect(await screen.findByText('No contacts match your search and filter')).toBeInTheDocument();
    api.listContacts.mockResolvedValue(contactPage(CONTACTS));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  it('no contacts in the workspace: «No contacts yet.»', async () => {
    api.listContacts.mockResolvedValue(contactPage([], { matching_count: 0, total_count: 0 }));
    await show();
    expect(await screen.findByText(/^No contacts yet\./)).toBeInTheDocument();
  });

  it('a chosen tag that no longer exists: the notice as on the Contacts list', async () => {
    api.listContacts.mockResolvedValue(contactPage(CONTACTS, { missing_tag_ids: [WHOLESALE] }));
    await show();
    expect(
      await screen.findByText(
        'One of the chosen tags no longer exists, so it was left out of the filter.',
      ),
    ).toBeInTheDocument();
  });

  it('Show more reads the next page and its membership', async () => {
    api.listContacts
      .mockResolvedValueOnce(
        contactPage(CONTACTS.slice(0, 2), { has_next: true, next_cursor: 'c1' }),
      )
      .mockResolvedValueOnce(contactPage(CONTACTS.slice(2)));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Ivan')).toBeInTheDocument();
    expect(api.listContacts).toHaveBeenLastCalledWith(WS, {
      q: '',
      mode: 'any',
      tag: [],
      after: 'c1',
    });
    await waitFor(() =>
      expect(api.getBroadcastGroupMembership).toHaveBeenLastCalledWith(WS, DRAFT, [IVAN]),
    );
  });

  it("error: «Couldn't load contacts» with Retry", async () => {
    api.listContacts
      .mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'))
      .mockResolvedValueOnce(contactPage(CONTACTS));
    await show();
    expect(await screen.findByText("Couldn't load contacts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Olena K.')).toBeInTheDocument();
  });

  it('the draft changed (a teammate switched it to tags, or launched it): the picker closes', async () => {
    api.addBroadcastGroupContact.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', { draft: draft(0) }),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Ivan' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Add all matching on a launched broadcast closes the picker', async () => {
    api.countBroadcastGroupMatching.mockResolvedValue(matching());
    api.addBroadcastGroupMatching.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_NOT_A_DRAFT, 'launched', {
        broadcast_id: DRAFT,
        status: 'sending',
      }),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all matching (13)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 13' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Done closes the picker', async () => {
    const dialog = await show();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
