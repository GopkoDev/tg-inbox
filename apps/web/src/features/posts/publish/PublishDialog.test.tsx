import { ErrorCode, type PublishConfirmation } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ getPublishConfirmation: vi.fn(), publishPost: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getPublishConfirmation: (...a: unknown[]) => api.getPublishConfirmation(...a),
  publishPost: (...a: unknown[]) => api.publishPost(...a),
}));

import { PublishDialog } from './PublishDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';
const DEST = '0198f0c0-0000-7000-8000-000000000801';
const guard = vi.fn();
const handlers = { onClose: vi.fn(), onDone: vi.fn() };

const confirmation = (over: Partial<PublishConfirmation> = {}): PublishConfirmation => ({
  post_id: POST,
  version: 3,
  text: 'New arrivals this week',
  silent: false,
  destination: {
    id: DEST,
    kind: 'channel',
    title: 'Test Channel',
    username: 'test_channel',
    availability: 'available',
    problem: null,
  },
  time_zone: 'Europe/Kyiv',
  sent_last_24h: 4,
  daily_limit: 30,
  frees_at: null,
  scheduled_waiting: 3,
  scheduled_limit: 100,
  blockers: [],
  ...over,
});

const renderIt = () =>
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <PublishDialog workspaceId={WS} postId={POST} {...handlers} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.getPublishConfirmation.mockResolvedValue(confirmation());
});

describe('SCR-38 PublishDialog', () => {
  it('loading: skeleton until the confirmation arrives', () => {
    api.getPublishConfirmation.mockReturnValue(new Promise(() => undefined));
    renderIt();
    expect(screen.getByTestId('publish-skeleton')).toBeInTheDocument();
  });

  it('default (AC-07): destination, kind, username, exact text and the daily headroom', async () => {
    renderIt();
    expect(await screen.findByText('Publish to Test Channel now?')).toBeInTheDocument();
    expect(screen.getByText('Channel')).toBeInTheDocument();
    expect(screen.getByText('@test_channel')).toBeInTheDocument();
    expect(screen.getByText('New arrivals this week')).toBeInTheDocument();
    expect(screen.getByText('4 of 30 posts sent in the last 24 hours')).toBeInTheDocument();
    expect(screen.queryByText('Without sound')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('silent post says Without sound', async () => {
    api.getPublishConfirmation.mockResolvedValue(confirmation({ silent: true }));
    renderIt();
    expect(await screen.findByText('Without sound')).toBeInTheDocument();
  });

  it('blocked: an alert per blocker and Publish disabled (AC-14, AC-16)', async () => {
    api.getPublishConfirmation.mockResolvedValue(
      confirmation({ blockers: ['bot_not_working', 'destination_unavailable'] }),
    );
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('pending: publishes the shown version once, spinner, Cancel disabled (AC-08)', async () => {
    let resolve!: (v: unknown) => void;
    api.publishPost.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(api.publishPost).toHaveBeenCalledTimes(1);
    expect(api.publishPost).toHaveBeenCalledWith(WS, POST, { expected_version: 3 });
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    resolve({ outcome: 'queued', post: {} });
    await waitFor(() => expect(handlers.onDone).toHaveBeenCalled());
  });

  it('done: already_scheduled also closes to the post', async () => {
    api.publishPost.mockResolvedValue({ outcome: 'already_scheduled', post: {} });
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(handlers.onDone).toHaveBeenCalled());
  });

  it('changed: POST_DRAFT_CHANGED publishes nothing and shows the current version (AC-08)', async () => {
    api.publishPost.mockRejectedValue(new ApiError(409, ErrorCode.POST_DRAFT_CHANGED, 'changed'));
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    api.getPublishConfirmation.mockResolvedValue(confirmation({ version: 4, text: 'Edited text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('The draft changed — check it again')).toBeInTheDocument();
    expect(await screen.findByText('Edited text')).toBeInTheDocument();
    expect(handlers.onDone).not.toHaveBeenCalled();
    api.publishPost.mockResolvedValue({ outcome: 'queued', post: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(api.publishPost).toHaveBeenLastCalledWith(WS, POST, { expected_version: 4 }),
    );
  });

  it('refused: bot not working offers Open bot settings (AC-14)', async () => {
    api.publishPost.mockRejectedValue(
      new ApiError(409, ErrorCode.POSTS_NEED_WORKING_BOT, 'no bot'),
    );
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const link = await screen.findByRole('link', { name: 'Open bot settings' });
    expect(link).toHaveAttribute('href', `/w/${WS}/settings/bot`);
  });

  it('refused: destination unavailable', async () => {
    api.publishPost.mockRejectedValue(new ApiError(409, ErrorCode.DESTINATION_UNAVAILABLE, 'gone'));
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('refused: daily limit says when posting is possible again (AC-16)', async () => {
    api.publishPost.mockRejectedValue(
      new ApiError(409, ErrorCode.POST_DAILY_LIMIT_REACHED, 'limit', {
        frees_at: '2026-11-04T08:12:00Z',
      }),
    );
    renderIt();
    await screen.findByText('Publish to Test Channel now?');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/You can post again at 10:12/)).toBeInTheDocument();
  });
});
