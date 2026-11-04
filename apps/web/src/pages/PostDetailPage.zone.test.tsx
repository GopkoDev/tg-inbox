import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';

const h = vi.hoisted(() => {
  const state = {
    post: {
      id: '0198f0c0-0000-7000-8000-000000000701',
      state: 'scheduled',
      schedule: { kind: 'time', scheduled_for: '2026-11-05T07:00:00.000Z' },
    },
    status: 'ready',
    open: () => Promise.resolve(),
    watch: () => () => undefined,
    reload: () => Promise.resolve(),
    close: () => undefined,
  };
  const store = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state,
  });
  return { store, list: vi.fn(), scheduleProps: vi.fn() };
});
vi.mock('@/features/posts/post-store', () => ({ usePostStore: h.store }));
vi.mock('@/features/posts/api', () => ({ listDestinations: (...a: unknown[]) => h.list(...a) }));
vi.mock('@/features/posts/page/PostPage', () => ({ PostPage: () => <div /> }));
vi.mock('@/features/posts/editor/PostEditor', () => ({ PostEditor: () => <div /> }));
vi.mock('@/features/posts/publish/PublishDialog', () => ({ PublishDialog: () => <div /> }));
vi.mock('@/features/posts/publish/ScheduleDialog', () => ({
  ScheduleDialog: (p: { initialLocalTime?: string }) => {
    h.scheduleProps(p);
    return <div data-testid="schedule-dialog">{p.initialLocalTime}</div>;
  },
}));

import { PostDetailPage } from './PostDetailPage';

const renderIt = () => {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme', role: 'owner' } });
  return render(
    <MemoryRouter initialEntries={[`/w/${WS}/posts/${POST}/schedule`]}>
      <Routes>
        <Route path="/w/:workspaceId/posts/:postId/*" element={<PostDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => vi.resetAllMocks());

describe('PostDetailPage change-time prefill (AC-09)', () => {
  it('does not open the change-time dialog before the workspace zone is known', async () => {
    h.list.mockReturnValue(new Promise(() => undefined));
    await act(async () => void renderIt());
    expect(screen.queryByTestId('schedule-dialog')).not.toBeInTheDocument();
  });

  it('prefills the change-time dialog in the workspace zone once it is known', async () => {
    h.list.mockResolvedValue({ items: [], time_zone: 'Europe/Kyiv', scheduled_total: 0 });
    await act(async () => void renderIt());
    expect(await screen.findByTestId('schedule-dialog')).toHaveTextContent('2026-11-05T09:00');
  });
});
