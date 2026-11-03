import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame, PostList, PostSummary } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ listPosts: vi.fn(), listDestinations: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listPosts: (...a: unknown[]) => api.listPosts(...a),
  listDestinations: (...a: unknown[]) => api.listDestinations(...a),
}));
const live = vi.hoisted(() => ({ onFrame: null as ((f: LiveFrame) => void) | null }));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, handlers: { onFrame: (f: LiveFrame) => void }) => {
    live.onFrame = handlers.onFrame;
    return () => {
      live.onFrame = null;
    };
  },
  liveStatus: () => 'idle',
}));

import { PostsTable } from './PostsTable';
import { PostsPage } from '@/pages/PostsPage';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ZONE = 'Europe/Kyiv';
const channel = {
  id: id(300),
  kind: 'channel' as const,
  title: 'Test Channel',
  username: null,
  availability: 'available' as const,
  problem: null,
};
const group = { ...channel, id: id(301), kind: 'group' as const, title: 'Test Group' };
const me = { account_id: id(11), display_name: 'Test User' };

const post = (n: number, over: Partial<PostSummary> = {}): PostSummary => ({
  id: id(500 + n),
  text_start: `Post text ${n}`,
  destination: channel,
  state: 'draft',
  scheduled_for: null,
  published_at: null,
  outcome_reason: null,
  needs_attention: false,
  last_changed_by: me,
  last_changed_at: new Date().toISOString(),
  ...over,
});
const list = (items: PostSummary[], over: Partial<PostList> = {}): PostList => ({
  workspace_id: WS,
  time_zone: ZONE,
  truncated: false,
  items,
  ...over,
});

const guard = vi.fn();
const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
};
const where = () => screen.getByTestId('where').textContent;

function renderPage(search = '') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/posts${search}`]}>
        <Where />
        <Routes>
          <Route path="/w/:workspaceId/posts" element={<PostsPage />} />
          <Route path="/w/:workspaceId/posts/new" element={<p>new post</p>} />
          <Route path="/w/:workspaceId/posts/:postId" element={<p>post page</p>} />
          <Route path="/w/:workspaceId/settings/channels" element={<p>channels page</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  live.onFrame = null;
  api.listDestinations.mockResolvedValue({
    workspace_id: WS,
    time_zone: ZONE,
    scheduled_total: 0,
    items: [],
  });
});

describe('PostsTable (SCR-36)', () => {
  it('shows skeleton rows while loading', () => {
    api.listPosts.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('posts-loading')).toBeInTheDocument();
  });

  it('lists posts with text start, destination and kind, state and who last changed (AC-05)', async () => {
    api.listPosts.mockResolvedValue(list([post(1), post(2, { destination: group })]));
    renderPage();
    const row = (await screen.findByText('Post text 1')).closest('tr')!;
    expect(within(row).getByText('Test Channel')).toBeInTheDocument();
    expect(within(row).getByText('Channel')).toBeInTheDocument();
    expect(within(row).getByText(/Draft/)).toBeInTheDocument();
    expect(within(row).getByText(/Test User/)).toBeInTheDocument();
    const second = screen.getByText('Post text 2').closest('tr')!;
    expect(within(second).getByText('Group')).toBeInTheDocument();
  });

  it('shows a scheduled time in the workspace zone and names the zone', async () => {
    api.listPosts.mockResolvedValue(
      list([post(1, { state: 'scheduled', scheduled_for: '2026-11-04T07:00:00Z' })]),
    );
    renderPage();
    expect(await screen.findByText(/Scheduled · Wed 4 Nov, 09:00 \(Europe\/Kyiv\)/)).toBeVisible();
  });

  it('marks failed and missed posts as needing attention (AC-12, AC-13)', async () => {
    api.listPosts.mockResolvedValue(
      list([
        post(1, { state: 'failed', outcome_reason: 'no_post_right', needs_attention: true }),
        post(2, { state: 'missed', outcome_reason: 'service_down', needs_attention: true }),
        post(3, { state: 'published', published_at: new Date().toISOString() }),
      ]),
    );
    renderPage();
    const failed = (await screen.findByText('Post text 1')).closest('tr')!;
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(failed).getByTestId('needs-attention')).toBeInTheDocument();
    const missed = screen.getByText('Post text 2').closest('tr')!;
    expect(within(missed).getByText('Missed')).toBeInTheDocument();
    expect(within(missed).getByTestId('needs-attention')).toBeInTheDocument();
    const ok = screen.getByText('Post text 3').closest('tr')!;
    expect(within(ok).getByText(/Published/)).toBeInTheDocument();
    expect(within(ok).queryByTestId('needs-attention')).toBeNull();
  });

  it('keeps the filter in the address and asks the API for it', async () => {
    api.listPosts.mockResolvedValue(list([post(1)]));
    renderPage();
    await screen.findByText('Post text 1');
    fireEvent.click(screen.getByRole('tab', { name: /Needs attention/ }));
    await waitFor(() => expect(where()).toContain('filter=attention'));
    await waitFor(() =>
      expect(api.listPosts).toHaveBeenLastCalledWith(WS, 'attention', expect.anything()),
    );
  });

  it('reads the filter from the address on open', async () => {
    api.listPosts.mockResolvedValue(list([post(1)]));
    renderPage('?filter=drafts');
    await screen.findByText('Post text 1');
    expect(api.listPosts).toHaveBeenCalledWith(WS, 'drafts', expect.anything());
    expect(screen.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers to show all posts when a filter matches nothing', async () => {
    api.listPosts.mockResolvedValue(list([]));
    renderPage('?filter=published');
    fireEvent.click(await screen.findByRole('button', { name: 'Show all posts' }));
    await waitFor(() => expect(where()).not.toContain('filter=published'));
  });

  it('empty with a destination invites a new post; without one points to channels', async () => {
    api.listPosts.mockResolvedValue(list([]));
    api.listDestinations.mockResolvedValue({
      workspace_id: WS,
      time_zone: ZONE,
      scheduled_total: 0,
      items: [
        {
          ...channel,
          scheduled_count: 0,
          connected_by: me,
          connected_at: new Date().toISOString(),
        },
      ],
    });
    const first = renderPage();
    expect(
      await screen.findByText(/Posts appear in your channels and groups from your bot/),
    ).toBeInTheDocument();
    first.unmount();

    api.listDestinations.mockResolvedValue({
      workspace_id: WS,
      time_zone: ZONE,
      scheduled_total: 0,
      items: [],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: /Connect a channel or group first/ }));
    expect(await screen.findByText('channels page')).toBeInTheDocument();
  });

  it('shows the truncation line', async () => {
    api.listPosts.mockResolvedValue(list([post(1)], { truncated: true }));
    renderPage();
    expect(await screen.findByText('Showing the newest 200 posts')).toBeInTheDocument();
  });

  it('shows an error with Retry', async () => {
    api.listPosts.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    api.listPosts.mockResolvedValue(list([post(1)]));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Post text 1')).toBeInTheDocument();
  });

  it('re-reads in place on post.changed', async () => {
    api.listPosts.mockResolvedValue(list([post(1)]));
    renderPage();
    await screen.findByText('Post text 1');
    api.listPosts.mockResolvedValue(list([post(1), post(2)]));
    live.onFrame?.({ v: 1, workspace_id: WS, type: 'post.changed', post_id: id(502) });
    expect(await screen.findByText('Post text 2')).toBeInTheDocument();
  });

  it('opens a post and the New post button', async () => {
    api.listPosts.mockResolvedValue(list([post(1)]));
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: /Post text 1/ }));
    expect(await screen.findByText('post page')).toBeInTheDocument();
  });
});

describe('PostsTable props', () => {
  it('is exported', () => {
    expect(PostsTable).toBeTypeOf('function');
  });
});
