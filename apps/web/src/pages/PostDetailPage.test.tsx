import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';

vi.mock('@/features/posts/editor/PostEditor', () => ({
  PostEditor: () => <div data-testid="editor" />,
}));
vi.mock('@/features/posts/publish/PublishDialog', () => ({
  PublishDialog: () => <div data-testid="publish-dialog" />,
}));
vi.mock('@/features/posts/publish/ScheduleDialog', () => ({
  ScheduleDialog: () => <div data-testid="schedule-dialog" />,
}));

import { PostDetailPage } from './PostDetailPage';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const renderAt = (path: string, role: 'owner' | 'operator') => {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId/posts/:postId/*" element={<PostDetailPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
};

beforeEach(() => vi.resetAllMocks());

describe('PostDetailPage owner-only addresses (AC-03)', () => {
  it('owner on /publish sees the publish dialog over the editor', async () => {
    await act(async () => void renderAt(`/w/${WS}/posts/${POST}/publish`, 'owner'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByTestId('publish-dialog')).toBeInTheDocument();
  });

  it('owner on /schedule sees the schedule dialog', async () => {
    await act(async () => void renderAt(`/w/${WS}/posts/${POST}/schedule`, 'owner'));
    expect(screen.getByTestId('schedule-dialog')).toBeInTheDocument();
  });

  it.each(['publish', 'schedule'])('operator on /%s is replaced to the post', async (step) => {
    await act(async () => void renderAt(`/w/${WS}/posts/${POST}/${step}`, 'operator'));
    expect(screen.getByTestId('where')).toHaveTextContent(`/w/${WS}/posts/${POST}`);
    expect(screen.getByTestId('where').textContent).not.toMatch(/publish|schedule/);
    expect(screen.queryByTestId('publish-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('schedule-dialog')).not.toBeInTheDocument();
  });
});
