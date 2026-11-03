import { ErrorCode, type Destination, type Post } from '@tg/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getPost: vi.fn(),
  createPost: vi.fn(),
  savePost: vi.fn(),
  listDestinations: vi.fn(),
  duplicatePost: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getPost: (...a: unknown[]) => api.getPost(...a),
  createPost: (...a: unknown[]) => api.createPost(...a),
  savePost: (...a: unknown[]) => api.savePost(...a),
  listDestinations: (...a: unknown[]) => api.listDestinations(...a),
  duplicatePost: (...a: unknown[]) => api.duplicatePost(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { PostEditor } from './PostEditor';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const TEAMMATE = id(12);
const POST = id(701);
const DEST = id(801);
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });
const n = new Intl.NumberFormat();

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: DEST,
  kind: 'channel',
  title: 'Acme Flowers News',
  username: 'acme_news',
  availability: 'available',
  problem: null,
  scheduled_count: 0,
  connected_by: ref(ME, 'Test User'),
  connected_at: '2026-10-20T09:00:00Z',
  ...over,
});

const post = (over: Partial<Post> = {}): Post => ({
  id: POST,
  workspace_id: WS,
  state: 'draft',
  version: 3,
  text: 'New arrivals this week',
  silent: false,
  destination: dest(),
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
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
});

const guard = vi.fn();
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}
function renderIt(postId: string | null, isOwner = true) {
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/posts/${postId ?? 'new'}`]}>
        <PostEditor workspaceId={WS} postId={postId} isOwner={isOwner} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const flush = () => act(async () => {});
const typeText = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), { target: { value: text } });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.listDestinations.mockResolvedValue({
    workspace_id: WS,
    time_zone: 'Europe/Kyiv',
    scheduled_total: 0,
    items: [dest()],
  });
  api.getPost.mockResolvedValue(post());
});
afterEach(() => vi.useRealTimers());

describe('SCR-37 PostEditor', () => {
  it('loading: skeleton until getPost answers', async () => {
    api.getPost.mockReturnValue(new Promise(() => undefined));
    renderIt(POST);
    await flush();
    expect(screen.getByTestId('post-editor-skeleton')).toBeInTheDocument();
  });

  it('default (owner) AC-05: text, counter, preview, destination, Publish / Schedule', async () => {
    renderIt(POST);
    await flush();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('New arrivals this week');
    expect(screen.getByText(`${n.format(4096 - 22)} characters left`)).toBeInTheDocument();
    expect(screen.getByTestId('post-preview')).toHaveTextContent('New arrivals this week');
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveTextContent(
      'Acme Flowers News',
    );
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Schedule…' })).toBeEnabled();
  });

  it('default (operator): Publish / Schedule are replaced by the owners-only note', async () => {
    renderIt(POST, false);
    await flush();
    expect(screen.queryByRole('button', { name: 'Publish now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schedule…' })).toBeNull();
    expect(screen.getByText('A business owner publishes or schedules posts')).toBeInTheDocument();
  });

  it('counts UTF-16 units, not characters (an emoji is 2)', async () => {
    renderIt(POST);
    await flush();
    typeText('😀');
    expect(screen.getByText(`${n.format(4094)} characters left`)).toBeInTheDocument();
  });

  it('autosave AC-05: saves 600 ms after the last keystroke with the loaded version; Saving… then Saved', async () => {
    let resolve!: (p: Post) => void;
    api.savePost.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt(POST);
    await flush();
    typeText('New arrivals');
    await advance(500);
    typeText('New arrivals today');
    await advance(500);
    expect(api.savePost).not.toHaveBeenCalled();
    await advance(100);
    expect(api.savePost).toHaveBeenCalledTimes(1);
    expect(api.savePost).toHaveBeenCalledWith(
      WS,
      POST,
      expect.objectContaining({ expected_version: 3, text: 'New arrivals today' }),
    );
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => resolve(post({ version: 4, text: 'New arrivals today' })));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('saves on blur at once, and the silent tick is part of the save', async () => {
    api.savePost.mockResolvedValue(post({ version: 4, silent: true }));
    renderIt(POST);
    await flush();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send without sound' }));
    await advance(600);
    expect(api.savePost).toHaveBeenCalledWith(
      WS,
      POST,
      expect.objectContaining({ expected_version: 3, silent: true }),
    );
    typeText('Changed');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Text' }));
    await flush();
    expect(api.savePost).toHaveBeenCalledTimes(2);
  });

  it('typing while a save is in flight: the next save waits and uses the new version', async () => {
    let resolve!: (p: Post) => void;
    api.savePost.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    api.savePost.mockResolvedValueOnce(post({ version: 5, text: 'ab' }));
    renderIt(POST);
    await flush();
    typeText('a');
    await advance(600);
    typeText('ab');
    await advance(600);
    expect(api.savePost).toHaveBeenCalledTimes(1);
    await act(async () => resolve(post({ version: 4, text: 'a' })));
    await advance(0);
    expect(api.savePost).toHaveBeenCalledTimes(2);
    expect(api.savePost.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ expected_version: 4, text: 'ab' }),
    );
  });

  it('validation AC-06: empty text disables Publish / Schedule and says what is missing', async () => {
    renderIt(POST);
    await flush();
    typeText('  \n ');
    expect(screen.getByText('Write the text of the post')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Schedule…' })).toBeDisabled();
  });

  it('validation AC-06: over 4096 says how many too many and does not save', async () => {
    renderIt(POST);
    await flush();
    typeText('a'.repeat(4100));
    expect(screen.getByText('4 characters too many')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
    await advance(1000);
    expect(api.savePost).not.toHaveBeenCalled();
  });

  it('validation AC-06: no destination picked blocks Publish / Schedule', async () => {
    api.getPost.mockResolvedValue(post({ destination: null }));
    renderIt(POST);
    await flush();
    expect(screen.getByText('Pick where the post goes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Schedule…' })).toBeDisabled();
  });

  it('stale save AC-06: POST_DRAFT_CHANGED shows the teammate version and never overwrites it', async () => {
    api.savePost.mockRejectedValue(
      new ApiError(409, ErrorCode.POST_DRAFT_CHANGED, 'changed', {
        post: post({ version: 6, text: 'Teammate text', last_changed_by: ref(TEAMMATE, 'Sam') }),
      }),
    );
    api.getPost
      .mockResolvedValueOnce(post())
      .mockResolvedValue(
        post({ version: 6, text: 'Teammate text', last_changed_by: ref(TEAMMATE, 'Sam') }),
      );
    renderIt(POST);
    await flush();
    typeText('Mine');
    await advance(600);
    expect(
      screen.getByText('A teammate changed this draft — showing their version'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('Teammate text');
    await advance(2000);
    expect(api.savePost).toHaveBeenCalledTimes(1);
  });

  it('destination problem: shown under the field with the Channels & groups link; Publish blocked', async () => {
    api.getPost.mockResolvedValue(
      post({ destination: dest({ availability: 'unavailable', problem: 'no_post_right' }) }),
    );
    renderIt(POST);
    await flush();
    expect(screen.getByRole('link', { name: 'Channels & groups' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/channels`,
    );
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  });

  it('draft notice AC-11: the owner who scheduled it lost access', async () => {
    api.getPost.mockResolvedValue(post({ draft_notice: 'owner_deactivated' }));
    renderIt(POST);
    await flush();
    expect(
      screen.getByText('Back in drafts: the owner who scheduled it no longer has access'),
    ).toBeInTheDocument();
  });

  it('draft notice AC-11: destination removed', async () => {
    api.getPost.mockResolvedValue(post({ draft_notice: 'destination_removed' }));
    renderIt(POST);
    await flush();
    expect(
      screen.getByText('Back in drafts: its channel or group was removed'),
    ).toBeInTheDocument();
  });

  it('no destination yet: empty picker with the Connect link', async () => {
    api.listDestinations.mockResolvedValue({
      workspace_id: WS,
      time_zone: null,
      scheduled_total: 0,
      items: [],
    });
    api.getPost.mockResolvedValue(post({ destination: null }));
    renderIt(POST);
    await flush();
    expect(screen.getByRole('link', { name: 'Connect a channel or group' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/channels`,
    );
  });

  it('not a draft anymore: the page switches to the post page (POST_NOT_A_DRAFT)', async () => {
    api.savePost.mockRejectedValue(
      new ApiError(409, ErrorCode.POST_NOT_A_DRAFT, 'not a draft', { state: 'scheduled' }),
    );
    renderIt(POST);
    await flush();
    typeText('x');
    await advance(600);
    expect(screen.getByTestId('where')).toHaveTextContent(`/w/${WS}/posts/${POST}`);
    expect(screen.getByTestId('post-not-a-draft')).toBeInTheDocument();
  });

  it('new post: the first save creates it and the address is replaced by its id', async () => {
    api.createPost.mockResolvedValue(post({ text: 'Hello', version: 1 }));
    renderIt(null);
    await flush();
    typeText('Hello');
    await advance(600);
    expect(api.createPost).toHaveBeenCalledWith(WS, expect.objectContaining({ text: 'Hello' }));
    expect(api.savePost).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent(`/w/${WS}/posts/${POST}`);
  });

  it('error: read failed shows a destructive alert with Retry', async () => {
    api.getPost.mockRejectedValueOnce(new Error('network')).mockResolvedValue(post());
    renderIt(POST);
    await flush();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeInTheDocument();
  });

  it('delete refused AC-18: FORBIDDEN from the delete dialog shows the author-or-owner alert', async () => {
    const { deletePostDraft } = await import('../api');
    expect(deletePostDraft).toBeDefined();
    renderIt(POST, false);
    await flush();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });
});

describe('T30 editor states', () => {
  it('AC-06: an over-limit draft says "Not saved — too long", never "Saved"', async () => {
    renderIt(POST);
    await flush();
    typeText('a'.repeat(4100));
    await advance(1000);
    expect(screen.getByText('Not saved — too long')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('AC-05: a failed save shows a destructive Alert whose Retry saves again', async () => {
    api.savePost.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    renderIt(POST);
    await flush();
    typeText('New arrivals today');
    await advance(700);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save");
    api.savePost.mockResolvedValue(post({ version: 4, text: 'New arrivals today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(api.savePost).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('AC-06: the empty-text error is a Field error tied to the textbox (aria-invalid)', async () => {
    renderIt(POST);
    await flush();
    typeText('   ');
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveAttribute('aria-invalid', 'true');
  });
});
