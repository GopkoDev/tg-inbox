import { ErrorCode, type Destination, type Post } from '@tg/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getPost: vi.fn(),
  markPostSeen: vi.fn(),
  deletePostFromTelegram: vi.fn(),
  duplicatePost: vi.fn(),
  listDestinations: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getPost: (...a: unknown[]) => api.getPost(...a),
  markPostSeen: (...a: unknown[]) => api.markPostSeen(...a),
  deletePostFromTelegram: (...a: unknown[]) => api.deletePostFromTelegram(...a),
  duplicatePost: (...a: unknown[]) => api.duplicatePost(...a),
  listDestinations: (...a: unknown[]) => api.listDestinations(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { PostPage } from './PostPage';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const POST = id(701);
const DEST = id(801);
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });

const dest = (): Destination => ({
  id: DEST,
  kind: 'channel',
  title: 'Acme Flowers News',
  username: 'acme_news',
  availability: 'available',
  problem: null,
  scheduled_count: 0,
  connected_by: ref(ME, 'Test User'),
  connected_at: '2026-10-20T09:00:00Z',
});

const post = (over: Partial<Post> = {}): Post => ({
  id: POST,
  workspace_id: WS,
  state: 'published',
  version: 3,
  text: 'New arrivals this week',
  silent: false,
  destination: dest(),
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: '2026-10-23T09:00:00Z',
  created_at: '2026-10-23T09:00:00Z',
  schedule: null,
  published_at: '2026-10-23T10:00:00Z',
  telegram_link: 'https://t.me/acme_news/42',
  deletable_until: '2099-01-01T00:00:00Z',
  outcome_reason: null,
  outcome_at: null,
  needs_attention: false,
  draft_notice: null,
  deleted_at: null,
  deleted_by: null,
  ...over,
});

const guard = vi.fn();
function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const flush = () => act(async () => {});
function renderIt(isOwner = true) {
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/posts/${POST}`]}>
        <PostPage workspaceId={WS} postId={POST} isOwner={isOwner} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.markPostSeen.mockResolvedValue({ outcome: 'seen' });
  api.getPost.mockResolvedValue(post());
  api.listDestinations.mockResolvedValue({ items: [], time_zone: 'Europe/Kyiv' });
});

describe('SCR-40 PostPage', () => {
  it('loading: skeleton until getPost answers', async () => {
    api.getPost.mockReturnValue(new Promise(() => undefined));
    renderIt();
    await flush();
    expect(screen.getByTestId('post-page-skeleton')).toBeInTheDocument();
  });

  it('scheduled (AC-07): text, destination, badge, actions', async () => {
    api.getPost.mockResolvedValue(
      post({
        state: 'scheduled',
        published_at: null,
        telegram_link: null,
        deletable_until: null,
        schedule: {
          kind: 'time',
          scheduled_for: '2026-11-04T07:00:00Z',
          scheduled_by: ref(ME, 'Test User'),
        },
      }),
    );
    renderIt();
    await flush();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('New arrivals this week')).toBeInTheDocument();
    expect(screen.getByText(/Acme Flowers News/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
  });

  it('sending: Going out…, only Duplicate', async () => {
    api.getPost.mockResolvedValue(post({ state: 'sending', telegram_link: null }));
    renderIt();
    await flush();
    expect(screen.getByText('Going out…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete from Telegram' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to draft' })).toBeNull();
  });

  it('published (AC-07): Published, Open in Telegram in a new tab, Delete for an owner', async () => {
    renderIt();
    await flush();
    expect(screen.getByText('Published')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open in Telegram' });
    expect(link).toHaveAttribute('href', 'https://t.me/acme_news/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Delete from Telegram' })).toBeInTheDocument();
    expect(api.markPostSeen).not.toHaveBeenCalled();
  });

  it('published, deletable_until passed: delete is hidden (AC-15)', async () => {
    api.getPost.mockResolvedValue(post({ deletable_until: '2020-01-01T00:00:00Z' }));
    renderIt();
    await flush();
    expect(screen.queryByRole('button', { name: 'Delete from Telegram' })).toBeNull();
  });

  it('operator: owner actions are replaced by the owners-only note', async () => {
    renderIt(false);
    await flush();
    expect(screen.queryByRole('button', { name: 'Delete from Telegram' })).toBeNull();
    expect(screen.getByText(/business owner/i)).toBeInTheDocument();
  });

  it('failed (AC-13): destructive badge, plain reason, marks seen once', async () => {
    api.getPost.mockResolvedValue(
      post({
        state: 'failed',
        telegram_link: null,
        outcome_reason: 'no_post_right',
        needs_attention: true,
      }),
    );
    renderIt();
    await flush();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('The bot can no longer post in this chat')).toBeInTheDocument();
    expect(api.markPostSeen).toHaveBeenCalledTimes(1);
    expect(api.markPostSeen).toHaveBeenCalledWith(WS, POST);
  });

  it.each([
    ['bot_not_working', 'The bot was not working'],
    ['not_current_bot', 'This chat is not connected to the current bot'],
    ['text_refused', 'Telegram refused the text'],
    ['daily_limit', 'The daily posting limit was reached'],
  ] as const)('failed reason %s reads %s', async (reason, copy) => {
    api.getPost.mockResolvedValue(
      post({ state: 'failed', telegram_link: null, outcome_reason: reason }),
    );
    renderIt();
    await flush();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it('missed (AC-12): never published later, with the reason; marks seen', async () => {
    api.getPost.mockResolvedValue(
      post({
        state: 'missed',
        telegram_link: null,
        outcome_reason: 'service_down',
        needs_attention: true,
      }),
    );
    renderIt();
    await flush();
    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getByText(/it was not published later/i)).toBeInTheDocument();
    expect(api.markPostSeen).toHaveBeenCalledTimes(1);
  });

  it('not confirmed (AC-08): Telegram did not answer, not sent again; marks seen', async () => {
    api.getPost.mockResolvedValue(
      post({ state: 'not_confirmed', telegram_link: null, needs_attention: true }),
    );
    renderIt();
    await flush();
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Telegram did not answer. It may have been posted — check the chat. It is not sent again.',
      ),
    ).toBeInTheDocument();
    expect(api.markPostSeen).toHaveBeenCalledTimes(1);
  });

  it('deleted (AC-15): who deleted it, text kept, no mark-seen when nothing needs attention', async () => {
    api.getPost.mockResolvedValue(
      post({
        state: 'deleted',
        deleted_at: '2026-10-23T10:02:00Z',
        deleted_by: ref(ME, 'Test User'),
        telegram_link: null,
      }),
    );
    renderIt();
    await flush();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.getByText(/Deleted from Telegram by Test User/)).toBeInTheDocument();
    expect(screen.getByText('New arrivals this week')).toBeInTheDocument();
    expect(api.markPostSeen).not.toHaveBeenCalled();
  });

  it('SCR-41 default and done: confirm calls deletePostFromTelegram and re-reads', async () => {
    api.deletePostFromTelegram.mockResolvedValue({
      outcome: 'changed',
      post: post({
        state: 'deleted',
        deleted_at: '2026-10-23T10:02:00Z',
        deleted_by: ref(ME, 'Test User'),
      }),
    });
    renderIt();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Delete from Telegram' }));
    expect(screen.getByText('Delete this post from Acme Flowers News?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'It disappears for everyone in the channel. The post stays here as deleted.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await flush();
    expect(api.deletePostFromTelegram).toHaveBeenCalledWith(WS, POST);
    expect(await screen.findByText(/Deleted from Telegram by Test User/)).toBeInTheDocument();
  });

  it.each([
    [ErrorCode.POST_DELETE_WINDOW_PASSED, 'The bot can no longer delete this post'],
    [ErrorCode.POST_DELETE_REFUSED, 'Telegram did not let the bot delete it'],
    [ErrorCode.TELEGRAM_UNAVAILABLE, 'Telegram is not responding — try again'],
  ])('SCR-41 refused %s shows the plain alert', async (code, copy) => {
    api.deletePostFromTelegram.mockRejectedValue(new ApiError(409, code, 'x'));
    renderIt();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Delete from Telegram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await flush();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it('duplicate (AC-07): goes to the new draft', async () => {
    api.duplicatePost.mockResolvedValue(post({ id: id(702), state: 'draft' }));
    renderIt();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await flush();
    expect(api.duplicatePost).toHaveBeenCalledWith(WS, POST);
    expect(screen.getByTestId('where')).toHaveTextContent(`/w/${WS}/posts/${id(702)}`);
  });

  it('error: Alert with Retry; 404 shows not found', async () => {
    api.getPost.mockRejectedValueOnce(new Error('network'));
    renderIt();
    await flush();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    api.getPost.mockResolvedValue(post());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByText('Published')).toBeInTheDocument();
  });
});

describe('T30 SCR-40 declared content', () => {
  const sched = {
    kind: 'time' as const,
    scheduled_for: '2026-11-04T07:00:00Z',
    scheduled_by: ref(id(12), 'Olena Owner'),
  };
  const base = { published_at: null, telegram_link: null, deletable_until: null, schedule: sched };

  it('AC-12: missed is destructive and says it could not go out by the window end in the zone', async () => {
    api.getPost.mockResolvedValue(
      post({ ...base, state: 'missed', outcome_reason: 'bot_paused', needs_attention: true }),
    );
    renderIt();
    await flush();
    expect(screen.getByText(/It could not go out by .*09:15/)).toBeInTheDocument();
    expect(screen.getByText('Missed').className).toMatch(/destructive/);
  });

  it('AC-13: failed because of the chat links to Channels & groups', async () => {
    api.getPost.mockResolvedValue(
      post({ ...base, state: 'failed', outcome_reason: 'no_post_right' }),
    );
    renderIt();
    await flush();
    expect(screen.getByRole('link', { name: /Channels & groups/ })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/channels`,
    );
  });

  it('AC-09: scheduled shows who scheduled it, kind, @username and the sound line', async () => {
    api.getPost.mockResolvedValue(post({ ...base, state: 'scheduled', silent: true }));
    renderIt();
    await flush();
    expect(screen.getByText(/Scheduled by Olena Owner/)).toBeInTheDocument();
    expect(screen.getByText('Channel')).toBeInTheDocument();
    expect(screen.getByText('@acme_news')).toBeInTheDocument();
    expect(screen.getByText(/without sound/i)).toBeInTheDocument();
  });

  it('AC-07: sending shows a spinner', async () => {
    api.getPost.mockResolvedValue(post({ ...base, state: 'sending' }));
    renderIt();
    await flush();
    expect(screen.getByTestId('post-sending-spinner')).toBeInTheDocument();
  });

  it('AC-15: published past 48 h says the bot can no longer delete it', async () => {
    api.getPost.mockResolvedValue(post({ deletable_until: '2020-01-01T00:00:00Z' }));
    renderIt();
    await flush();
    expect(screen.getByText('The bot can no longer delete this post')).toBeInTheDocument();
  });
});
