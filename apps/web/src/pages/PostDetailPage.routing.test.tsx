import { ErrorCode, type Post } from '@tg/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';

const api = vi.hoisted(() => ({ getPost: vi.fn(), listDestinations: vi.fn() }));
const live = vi.hoisted(() => ({ onFrame: null as null | ((f: unknown) => void) }));
const mounts = vi.hoisted(() => ({ editor: 0 }));

vi.mock('@/features/posts/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/posts/api')>()),
  getPost: (...a: unknown[]) => api.getPost(...a),
  listDestinations: (...a: unknown[]) => api.listDestinations(...a),
  markPostSeen: () => Promise.resolve({ outcome: 'seen' }),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, h: { onFrame: (f: unknown) => void }) => {
    live.onFrame = h.onFrame;
    return () => undefined;
  },
  liveStatus: () => 'idle',
}));
vi.mock('@/features/posts/editor/PostEditor', () => ({
  PostEditor: () => {
    useEffect(() => {
      mounts.editor += 1;
    }, []);
    return <div data-testid="editor" />;
  },
}));
vi.mock('@/features/posts/publish/PublishDialog', () => ({
  PublishDialog: () => <div data-testid="publish-dialog" />,
}));
vi.mock('@/features/posts/publish/ScheduleDialog', () => ({
  ScheduleDialog: (p: { changeTime?: boolean; initialLocalTime?: string }) => (
    <div
      data-testid="schedule-dialog"
      data-change-time={String(p.changeTime ?? false)}
      data-initial={p.initialLocalTime ?? ''}
    />
  ),
}));

import { PostDetailPage } from './PostDetailPage';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';
const ref = { account_id: '0198f0c0-0000-7000-8000-000000000011', display_name: 'Test User' };

const post = (over: Partial<Post> = {}): Post =>
  ({
    id: POST,
    workspace_id: WS,
    state: 'draft',
    version: 1,
    text: 'Hello',
    silent: false,
    destination: null,
    author: ref,
    last_changed_by: ref,
    last_changed_at: '2026-10-23T09:00:00Z',
    created_at: '2026-10-23T09:00:00Z',
    schedule: null,
    published_at: null,
    telegram_link: null,
    deletable_until: null,
    outcome_reason: null,
    outcome_at: null,
    needs_attention: false,
    draft_notice: null,
    deleted_at: null,
    deleted_by: null,
    ...over,
  }) as Post;

const scheduled = () =>
  post({
    state: 'scheduled',
    version: 2,
    schedule: {
      kind: 'time',
      scheduled_for: '2026-11-05T07:00:00Z',
      scheduled_by: ref,
    },
  } as Partial<Post>);

let go: (to: string) => void = () => undefined;
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    go = (to) => void navigate(to);
  });
  return null;
}

const NewAddress = () => <PostDetailPage />;
const IdAddress = () => <PostDetailPage />;
const PublishAddress = () => <PostDetailPage />;
const ScheduleAddress = () => <PostDetailPage />;

const renderAt = (path: string, role: 'owner' | 'operator' = 'owner') => {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={vi.fn().mockResolvedValue('handled')}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
        <Routes>
          {/* the app lazy-loads each address separately, so each is its own element type */}
          <Route path="/w/:workspaceId/posts/new" element={<NewAddress />} />
          <Route path="/w/:workspaceId/posts/:postId" element={<IdAddress />} />
          <Route path="/w/:workspaceId/posts/:postId/publish" element={<PublishAddress />} />
          <Route path="/w/:workspaceId/posts/:postId/schedule" element={<ScheduleAddress />} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
};
const flush = () => act(async () => {});

beforeEach(() => {
  vi.resetAllMocks();
  mounts.editor = 0;
  live.onFrame = null;
  api.listDestinations.mockResolvedValue({ time_zone: 'Europe/Kyiv', items: [] });
});

describe('post address (F14-F17)', () => {
  it('F17: an unknown post address shows the not-found card, not a retryable error', async () => {
    api.getPost.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'nope'));
    renderAt(`/w/${WS}/posts/${POST}`);
    await flush();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the post")).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  });

  it('F15: a live change from draft to scheduled switches the editor to the post page', async () => {
    api.getPost.mockResolvedValue(post());
    renderAt(`/w/${WS}/posts/${POST}`);
    await flush();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    api.getPost.mockResolvedValue(scheduled());
    await act(async () => live.onFrame?.({ type: 'post.changed', post_id: POST }));
    await flush();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByText(/Goes out/)).toBeInTheDocument();
  });

  it('F15: a live back-to-draft switches the post page to the editor', async () => {
    api.getPost.mockResolvedValue(scheduled());
    renderAt(`/w/${WS}/posts/${POST}`);
    await flush();
    expect(screen.getByText(/Goes out/)).toBeInTheDocument();
    api.getPost.mockResolvedValue(post({ version: 3 }));
    await act(async () => live.onFrame?.({ type: 'post.changed', post_id: POST }));
    await flush();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('F16: /:id to /:id/publish keeps the same editor instance', async () => {
    api.getPost.mockResolvedValue(post());
    renderAt(`/w/${WS}/posts/${POST}`);
    await flush();
    go(`/w/${WS}/posts/${POST}/publish`);
    await flush();
    expect(screen.getByTestId('publish-dialog')).toBeInTheDocument();
    expect(mounts.editor).toBe(1);
  });

  it('F16: /new to /:id keeps the same editor instance', async () => {
    api.getPost.mockResolvedValue(post());
    renderAt(`/w/${WS}/posts/new`);
    await flush();
    go(`/w/${WS}/posts/${POST}`);
    await flush();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(mounts.editor).toBe(1);
  });

  it('F14: an owner changes the time of a scheduled post in ScheduleDialog, prefilled in the workspace zone', async () => {
    api.getPost.mockResolvedValue(scheduled());
    renderAt(`/w/${WS}/posts/${POST}`);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Change time' }));
    await flush();
    const dialog = screen.getByTestId('schedule-dialog');
    expect(dialog).toHaveAttribute('data-change-time', 'true');
    expect(dialog.getAttribute('data-initial')).toMatch(/^2026-11-05T09:00/);
  });

  it('F14: /schedule on a scheduled post opens the dialog for an owner', async () => {
    api.getPost.mockResolvedValue(scheduled());
    renderAt(`/w/${WS}/posts/${POST}/schedule`);
    await flush();
    expect(screen.getByTestId('schedule-dialog')).toHaveAttribute('data-change-time', 'true');
  });

  it('F14: an operator is not offered Change time', async () => {
    api.getPost.mockResolvedValue(scheduled());
    renderAt(`/w/${WS}/posts/${POST}`, 'operator');
    await flush();
    expect(screen.queryByRole('button', { name: 'Change time' })).not.toBeInTheDocument();
  });
});
