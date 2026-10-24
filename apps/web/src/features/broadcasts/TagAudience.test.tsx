import { ErrorCode, type BroadcastDraft, type TagWithCount } from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  saveBroadcastAudience: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  saveBroadcastAudience: (...a: unknown[]) => api.saveBroadcastAudience(...a),
}));
vi.mock('@/features/tags/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tags/api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { useTagsStore } from '@/features/tags/store';
import { useBroadcastDraftStore } from './draft-store';
import { TagAudience } from './TagAudience';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DRAFT = id(501);
const VIP = id(301);
const KYIV = id(302);
const STAFF = id(303);
const OLD = id(304);
const tag = (tagId: string, name: string, contact_count: number): TagWithCount => ({
  id: tagId,
  name,
  contact_count,
});
const TAGS = [tag(KYIV, 'Kyiv', 120), tag(STAFF, 'Staff', 3), tag(VIP, 'VIP', 40)];
const ref = { account_id: id(11), display_name: 'Test User' };

const draft = (over: Partial<BroadcastDraft> = {}): BroadcastDraft => ({
  id: DRAFT,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref,
  last_changed_by: ref,
  last_changed_at: '2026-10-23T09:00:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'draft',
  version: 3,
  text: 'New prices from Monday.',
  audience: {
    kind: 'tags',
    mode: 'any',
    tags: [
      { tag_id: VIP, name: 'VIP', kind: 'include' },
      { tag_id: STAFF, name: 'Staff', kind: 'exclude' },
    ],
    dropped_tags: [],
  },
  breakdown: {
    audience_size: 38,
    reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
  },
  ...over,
});

const guard = vi.fn();

async function show(d: BroadcastDraft = draft()) {
  api.getBroadcast.mockResolvedValue(d);
  await useBroadcastDraftStore.getState().open(WS, DRAFT, guard);
  render(
    <ShellGuardContext.Provider value={guard}>
      <TagAudience workspaceId={WS} />
    </ShellGuardContext.Provider>,
  );
  await waitFor(() => expect(useTagsStore.getState().status).toBe('ready'));
}

const sendTo = () => screen.getByRole('button', { name: /^Send to/ });
const leaveOut = () => screen.getByRole('button', { name: /^Leave out/ });
const lastSave = () => api.saveBroadcastAudience.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.listTags.mockResolvedValue({ items: TAGS });
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
  useTagsStore.getState().clear();
});

describe('SCR-25 — the tag audience (AC-01)', () => {
  it('default: Send to and Leave out label themselves; the chosen and left-out tags as badges', async () => {
    await show();
    expect(sendTo()).toHaveTextContent('Send to · Any of 1');
    expect(leaveOut()).toHaveTextContent('Leave out · 1');
    const badges = screen.getByTestId('audience-badges');
    expect(within(badges).getByText('VIP')).toBeInTheDocument();
    expect(within(badges).getByText('− Staff')).toHaveAttribute('data-variant', 'outline');
  });

  it('a tag renamed since shows under its current name', async () => {
    api.listTags.mockResolvedValue({
      items: [tag(KYIV, 'Kyiv', 120), tag(STAFF, 'Staff', 3), tag(VIP, 'VIP clients', 40)],
    });
    await show();
    expect(within(screen.getByTestId('audience-badges')).getByText('VIP clients')).toBeVisible();
  });

  it('choosing a tag in Send to saves the whole tag audience against the held version', async () => {
    api.saveBroadcastAudience.mockResolvedValue(draft({ version: 4 }));
    await show();
    fireEvent.click(sendTo());
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    await waitFor(() => expect(api.saveBroadcastAudience).toHaveBeenCalledTimes(1));
    expect(api.saveBroadcastAudience.mock.calls[0]![0]).toBe(WS);
    expect(api.saveBroadcastAudience.mock.calls[0]![1]).toBe(DRAFT);
    expect(lastSave()).toEqual({
      expected_version: 3,
      kind: 'tags',
      mode: 'any',
      tag_ids: [VIP, KYIV],
      exclude_tag_ids: [STAFF],
    });
  });

  it('a tag chosen in Send to is disabled in Leave out, and a left-out tag is disabled in Send to', async () => {
    api.saveBroadcastAudience.mockResolvedValue(draft({ version: 4 }));
    await show();
    fireEvent.click(leaveOut());
    expect(screen.getByRole('checkbox', { name: /VIP/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Staff/ })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    await waitFor(() =>
      expect(lastSave()).toMatchObject({ tag_ids: [VIP], exclude_tag_ids: [STAFF, KYIV] }),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(sendTo());
    expect(screen.getByRole('checkbox', { name: /Staff/ })).toBeDisabled();
  });

  it('«No tags» disables Leave out and saves no left-out tags', async () => {
    api.saveBroadcastAudience.mockResolvedValue(
      draft({
        version: 4,
        audience: { kind: 'tags', mode: 'none', tags: [], dropped_tags: [] },
      }),
    );
    await show();
    fireEvent.click(sendTo());
    fireEvent.click(screen.getByRole('radio', { name: 'No tags' }));
    await waitFor(() =>
      expect(lastSave()).toMatchObject({ mode: 'none', tag_ids: [], exclude_tag_ids: [] }),
    );
    await waitFor(() => expect(leaveOut()).toBeDisabled());
  });

  it('a dropped tag: one notice per tag by its stored name', async () => {
    await show(
      draft({
        audience: {
          kind: 'tags',
          mode: 'any',
          tags: [{ tag_id: VIP, name: 'VIP', kind: 'include' }],
          dropped_tags: [{ tag_id: OLD, name: 'Old promo', kind: 'include' }],
        },
      }),
    );
    expect(
      screen.getByText('“Old promo” no longer exists, so it was left out of this audience.'),
    ).toBeInTheDocument();
  });

  it('over 10 000: the warning with the size; the draft stays saved', async () => {
    await show(
      draft({
        breakdown: {
          audience_size: 10_420,
          reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 10_420 },
        },
      }),
    );
    const n = new Intl.NumberFormat();
    expect(
      screen.getByText(
        `This audience holds ${n.format(10_420)} contacts. A broadcast can reach at most ${n.format(10_000)} — narrow it down to launch.`,
      ),
    ).toBeInTheDocument();
  });

  it('a tag gone on save: the tags are read again, it is unchecked with the notice, nothing saved', async () => {
    api.saveBroadcastAudience.mockRejectedValue(
      new ApiError(404, ErrorCode.TAG_NOT_FOUND, 'This tag no longer exists', { tag_id: KYIV }),
    );
    await show();
    api.listTags.mockResolvedValue({ items: [tag(STAFF, 'Staff', 3), tag(VIP, 'VIP', 40)] });
    fireEvent.click(sendTo());
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    expect(
      await screen.findByText('“Kyiv” no longer exists, so it was left out of this audience.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listTags).toHaveBeenCalledTimes(2));
    expect(sendTo()).toHaveTextContent('Send to · Any of 1');
    expect(screen.queryByRole('checkbox', { name: /Kyiv/ })).toBeNull();
    expect(api.saveBroadcastAudience).toHaveBeenCalledTimes(1);
    expect(useBroadcastDraftStore.getState().draft?.version).toBe(3);
  });

  it('saving: a spinner on the control used', async () => {
    let answer!: (d: BroadcastDraft) => void;
    api.saveBroadcastAudience.mockReturnValue(new Promise((r) => (answer = r)));
    await show();
    fireEvent.click(sendTo());
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    expect(await within(sendTo()).findByTestId('audience-saving')).toBeInTheDocument();
    expect(within(leaveOut()).queryByTestId('audience-saving')).toBeNull();
    await act(async () => answer(draft({ version: 4 })));
    await waitFor(() => expect(within(sendTo()).queryByTestId('audience-saving')).toBeNull());
  });
});
