import { ErrorCode, type BroadcastDraft } from '@tg/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  saveBroadcastAudience: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  saveBroadcastAudience: (...a: unknown[]) => api.saveBroadcastAudience(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { useBroadcastDraftStore } from './draft-store';
import { SwitchAudienceDialog } from './SwitchAudienceDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DRAFT = id(501);
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
  audience: { kind: 'group', size: 14 },
  breakdown: {
    audience_size: 14,
    reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 14 },
  },
  ...over,
});
const tagsDraft = () =>
  draft({
    version: 4,
    audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] },
    breakdown: {
      audience_size: 120,
      reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 120 },
    },
  });

const guard = vi.fn();
const closed = vi.fn();

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <SwitchAudienceDialog
      open={open}
      onClose={() => {
        setOpen(false);
        closed();
      }}
    />
  );
}

async function show(d: BroadcastDraft = draft()) {
  api.getBroadcast.mockResolvedValue(d);
  await useBroadcastDraftStore.getState().open(WS, DRAFT, guard);
  render(
    <ShellGuardContext.Provider value={guard}>
      <Host />
    </ShellGuardContext.Provider>,
  );
}

const switchButton = () => screen.getByRole('button', { name: 'Switch' });
const lastSave = () => api.saveBroadcastAudience.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
});

describe('SCR-32 — switch a hand-picked group to contacts with tags (AC-03)', () => {
  it('default: names the group size; Keep the group is focused and keeps the kind', async () => {
    await show();
    expect(screen.getByRole('heading', { name: 'Switch to contacts with tags?' })).toBeVisible();
    expect(
      screen.getByText('The hand-picked group of 14 contacts will be removed from this draft.'),
    ).toBeInTheDocument();
    const keep = screen.getByRole('button', { name: 'Keep the group' });
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.click(keep);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(api.saveBroadcastAudience).not.toHaveBeenCalled();
    expect(useBroadcastDraftStore.getState().draft?.audience.kind).toBe('group');
  });

  it('Switch sends the size it shows; switched closes the dialog with the tag audience held', async () => {
    api.saveBroadcastAudience.mockResolvedValue(tagsDraft());
    await show();
    fireEvent.click(switchButton());
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(lastSave()).toEqual({
      expected_version: 3,
      kind: 'tags',
      mode: 'any',
      tag_ids: [],
      exclude_tag_ids: [],
      expected_group_size: 14,
    });
    expect(useBroadcastDraftStore.getState().draft?.audience.kind).toBe('tags');
  });

  it('switching: a spinner and both buttons disabled', async () => {
    let answer!: (d: BroadcastDraft) => void;
    api.saveBroadcastAudience.mockReturnValue(new Promise((r) => (answer = r)));
    await show();
    fireEvent.click(switchButton());
    await waitFor(() => expect(switchButton()).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Keep the group' })).toBeDisabled();
    await act(async () => answer(tagsDraft()));
    await waitFor(() => expect(closed).toHaveBeenCalled());
  });

  it('asks again on BROADCAST_GROUP_CHANGED with the new size; the next confirm sends it', async () => {
    api.saveBroadcastAudience
      .mockRejectedValueOnce(
        new ApiError(409, ErrorCode.BROADCAST_GROUP_CHANGED, 'The group changed', {
          group_size: 16,
        }),
      )
      .mockResolvedValueOnce(tagsDraft());
    await show();
    fireEvent.click(switchButton());
    expect(
      await screen.findByText(
        'The hand-picked group of 16 contacts will be removed from this draft.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('The group changed while you were deciding.')).toBeInTheDocument();
    expect(closed).not.toHaveBeenCalled();
    fireEvent.click(switchButton());
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(lastSave()).toMatchObject({ expected_group_size: 16 });
  });

  it('stale: BROADCAST_DRAFT_CHANGED closes the dialog to the editor stale notice', async () => {
    api.saveBroadcastAudience.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', {
        draft: draft({ version: 5 }),
      }),
    );
    await show();
    fireEvent.click(switchButton());
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(useBroadcastDraftStore.getState().stale).not.toBeNull();
  });

  it("error: «Couldn't switch the audience», the dialog stays", async () => {
    api.saveBroadcastAudience.mockRejectedValue(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'),
    );
    await show();
    fireEvent.click(switchButton());
    expect(await screen.findByText("Couldn't switch the audience")).toBeInTheDocument();
    expect(closed).not.toHaveBeenCalled();
    expect(switchButton()).toBeEnabled();
  });
});
