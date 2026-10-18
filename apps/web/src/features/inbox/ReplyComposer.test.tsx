import { act, fireEvent, render, screen } from '@testing-library/react';
import type { InboxBotStatus, ThreadReply } from '@tg/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const api = {
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  getInboxBotStatus: vi.fn(),
  sendReply: vi.fn(),
};
vi.mock('./api-source', () => ({
  listConversations: (...a: unknown[]) => api.listConversations(...a),
  getConversation: (...a: unknown[]) => api.getConversation(...a),
  getInboxBotStatus: (...a: unknown[]) => api.getInboxBotStatus(...a),
  sendReply: (...a: unknown[]) => api.sendReply(...a),
}));
const sockets: { handlers: { onFrame: (f: unknown) => void } }[] = [];
vi.mock('@/shared/api/realtime', () => ({
  openLiveSocket: (_ws: string, handlers: { onFrame: (f: unknown) => void }) => {
    const s = { handlers, close: vi.fn() };
    sockets.push(s);
    return s;
  },
}));

import { ReplyComposer } from './ReplyComposer';
import { useInboxStore } from './store';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const OTHER = '0198f0c0-0000-7000-8000-000000000102';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, min)).toISOString();
const bot = (state: InboxBotStatus['state'], can_reply: boolean): InboxBotStatus => ({
  workspace_id: WS,
  state,
  can_reply,
  receiving: true,
});
const reply = (n: number, min: number, over: Partial<ThreadReply> = {}): ThreadReply => ({
  type: 'reply',
  id: id(700 + n),
  workspace_id: WS,
  conversation_id: CONV,
  client_key: id(800 + n),
  body: `team ${n}`,
  author: { account_id: id(950), display_name: 'Olena Operator' },
  state: 'sending',
  failure_reason: null,
  position_at: at(min),
  sent_at: null,
  created_at: at(min),
  ...over,
});
const refusal = (status: number, code: string, details: unknown) =>
  new ApiError(status, code as never, 'refused', details);
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => Promise.resolve());
};

function seedThread(items: ThreadReply[] = []) {
  useInboxStore.setState({
    thread: {
      conversationId: CONV,
      status: 'ready',
      contact: null,
      older: 'idle',
      items,
      hasPrev: false,
      prevCursor: null,
      readThroughAt: null,
    },
  });
}

function renderComposer(conversationId = CONV) {
  return render(
    <MemoryRouter>
      <ReplyComposer workspaceId={WS} conversationId={conversationId} />
    </MemoryRouter>,
  );
}
const box = () => screen.getByRole('textbox', { name: 'Reply' });
const send = () => screen.getByRole('button', { name: /^Send$/ });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const enter = (shiftKey = false) => fireEvent.keyDown(box(), { key: 'Enter', shiftKey });

beforeEach(async () => {
  vi.resetAllMocks();
  stubRadixDom();
  sockets.length = 0;
  useWorkspaceStore.getState().clear();
  useInboxStore.getState().leave();
  api.listConversations.mockResolvedValue({
    workspace_id: WS,
    items: [],
    has_prev: false,
    has_next: false,
    next_cursor: null,
  });
  api.getInboxBotStatus.mockResolvedValue(bot('connected', true));
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  await useInboxStore.getState().enter(WS);
  seedThread();
});
afterEach(() => vi.useRealTimers());

describe('composer: empty / ready (AC-06, AC-07)', () => {
  it('empty: Send disabled and Enter sends nothing; no preview note', () => {
    renderComposer();
    expect(send()).toBeDisabled();
    enter();
    type('   \n ');
    expect(send()).toBeDisabled();
    enter();
    expect(api.sendReply).not.toHaveBeenCalled();
    expect(screen.queryByText(/Preview/)).not.toBeInTheDocument();
  });

  it('ready: Enter sends, Shift+Enter does not', async () => {
    api.sendReply.mockResolvedValue(reply(1, 6, { body: 'Hello' }));
    renderComposer();
    type('Hello');
    expect(send()).toBeEnabled();
    enter(true);
    expect(api.sendReply).not.toHaveBeenCalled();
    enter();
    await flush();
    expect(api.sendReply).toHaveBeenCalledTimes(1);
    const [ws, conv, body] = api.sendReply.mock.calls[0]!;
    expect([ws, conv]).toEqual([WS, CONV]);
    expect(body).toMatchObject({ body: 'Hello', last_seen_reply_id: null });
    expect(body.client_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('validation (AC-07)', () => {
  it('over 4096 UTF-16 units: aria-invalid, message, Send disabled, text kept', () => {
    renderComposer();
    type('😀'.repeat(4096));
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Replies are limited to 4096 characters')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    enter();
    expect(api.sendReply).not.toHaveBeenCalled();
    expect((box() as HTMLTextAreaElement).value).toHaveLength(8192);
  });

  it('a server 400 shows its message in the same slot and keeps the text', async () => {
    api.sendReply.mockRejectedValue(refusal(400, 'VALIDATION_ERROR', undefined));
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('refused');
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect((box() as HTMLTextAreaElement).value).toBe('Hello');
  });
});

describe('sending and success (AC-06, AC-11)', () => {
  it('locks while in flight, double Enter is one request, then appends, clears and rekeys', async () => {
    let resolve!: (r: ThreadReply) => void;
    api.sendReply.mockReturnValue(new Promise<ThreadReply>((r) => (resolve = r)));
    renderComposer();
    type('Hello');
    enter();
    enter();
    expect(api.sendReply).toHaveBeenCalledTimes(1);
    expect(box()).toHaveAttribute('readonly');
    expect(send()).toBeDisabled();
    const firstKey = api.sendReply.mock.calls[0]![2].client_key;
    await act(async () => resolve(reply(1, 6, { body: 'Hello' })));
    await flush();
    expect(useInboxStore.getState().thread!.items.map((i) => i.id)).toEqual([id(701)]);
    expect((box() as HTMLTextAreaElement).value).toBe('');
    expect(box()).not.toHaveAttribute('readonly');

    api.sendReply.mockResolvedValue(reply(2, 7));
    type('Again');
    enter();
    await flush();
    const second = api.sendReply.mock.calls[1]![2];
    expect(second.client_key).not.toBe(firstKey);
    expect(second.last_seen_reply_id).toBe(id(701));
  });

  it('network failure keeps text and key; the retry reuses the key and a 200 replay ends it', async () => {
    api.sendReply.mockRejectedValueOnce(new TypeError('network'));
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(
      screen.getByText('Your reply was not sent — check your connection and send again'),
    ).toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('Hello');
    api.sendReply.mockResolvedValueOnce(reply(1, 6));
    enter();
    await flush();
    expect(api.sendReply.mock.calls[1]![2].client_key).toBe(
      api.sendReply.mock.calls[0]![2].client_key,
    );
    expect(screen.queryByText(/check your connection/)).not.toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('');
  });
});

describe('draft kept (per conversation)', () => {
  it('each conversation keeps its own text; switching back restores it', () => {
    const view = renderComposer();
    type('draft one');
    view.unmount();
    renderComposer(OTHER);
    expect((box() as HTMLTextAreaElement).value).toBe('');
    type('draft two');
    cleanup2();
    renderComposer();
    expect((box() as HTMLTextAreaElement).value).toBe('draft one');
  });
});
function cleanup2() {
  document.body.innerHTML = '';
}

describe('teammate replied (AC-16, SCR-04)', () => {
  const conflict = () =>
    refusal(409, 'TEAMMATE_REPLIED', {
      reply: {
        id: id(709),
        author: { account_id: id(951), display_name: 'Olena Operator' },
        position_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    });

  it('sends last_seen_reply_id of the newest reply shown when typing began', async () => {
    seedThread([reply(1, 1, { state: 'sent', sent_at: at(1) })]);
    api.sendReply.mockResolvedValue(reply(2, 6));
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(api.sendReply.mock.calls[0]![2].last_seen_reply_id).toBe(id(701));
  });

  it('opens the dialog, keeps the text; Keep editing sets last_seen to the teammate reply', async () => {
    api.sendReply.mockRejectedValueOnce(conflict());
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(
      screen.getByRole('alertdialog', { name: 'A teammate just replied' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Olena Operator replied to this customer 5m ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('Hello');
    expect(box()).toHaveFocus();
    api.sendReply.mockResolvedValueOnce(reply(3, 7));
    enter();
    await flush();
    const [, , again] = api.sendReply.mock.calls[1]!;
    expect(again.last_seen_reply_id).toBe(id(709));
    expect(again.client_key).toBe(api.sendReply.mock.calls[0]![2].client_key);
    expect(again.confirm_teammate_reply).toBeFalsy();
  });

  it('Send anyway repeats the request with the same key and confirm flag, then closes', async () => {
    api.sendReply.mockRejectedValueOnce(conflict());
    renderComposer();
    type('Hello');
    enter();
    await flush();
    api.sendReply.mockResolvedValueOnce(reply(3, 7));
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await flush();
    const [, , again] = api.sendReply.mock.calls[1]!;
    expect(again.confirm_teammate_reply).toBe(true);
    expect(again.client_key).toBe(api.sendReply.mock.calls[0]![2].client_key);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('');
  });

  it('a network error leaves the dialog open with the message', async () => {
    api.sendReply.mockRejectedValueOnce(conflict());
    renderComposer();
    type('Hello');
    enter();
    await flush();
    api.sendReply.mockRejectedValueOnce(new TypeError('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await flush();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Your reply was not sent — try again',
    );
  });

  it('a 429 from the dialog closes it and shows the rate limit', async () => {
    api.sendReply.mockRejectedValueOnce(conflict());
    renderComposer();
    type('Hello');
    enter();
    await flush();
    api.sendReply.mockRejectedValueOnce(
      refusal(429, 'REPLY_LIMIT_REACHED', {
        limit: 30,
        window_seconds: 60,
        retry_at: new Date(Date.now() + 20_000).toISOString(),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Replies are limited to 30 per minute/)).toBeInTheDocument();
  });

  it('a BOT_CANNOT_REPLY from the dialog closes it and turns the composer unavailable', async () => {
    api.sendReply.mockRejectedValueOnce(conflict());
    renderComposer();
    type('Hello');
    enter();
    await flush();
    api.sendReply.mockRejectedValueOnce(
      refusal(409, 'BOT_CANNOT_REPLY', { bot: bot('needs_token', false) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box()).toBeDisabled();
  });
});

describe('rate-limited (AC-12b)', () => {
  it('counts down to retry_at, keeps the text, then enables Send again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    api.sendReply.mockRejectedValue(
      refusal(429, 'REPLY_LIMIT_REACHED', {
        limit: 30,
        window_seconds: 60,
        retry_at: '2026-10-18T10:00:12Z',
      }),
    );
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(
      screen.getByText('Replies are limited to 30 per minute — you can send again in 12 seconds'),
    ).toBeInTheDocument();
    expect(send()).toBeDisabled();
    enter();
    expect(api.sendReply).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/you can send again in 7 seconds/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByText(/Replies are limited to 30/)).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect((box() as HTMLTextAreaElement).value).toBe('Hello');
  });
});

describe('bot unavailable (AC-13)', () => {
  const setBot = (b: ReturnType<typeof bot>) => act(() => useInboxStore.setState({ bot: b }));

  it('owner, needs_token: disabled box, message, settings link, draft kept', () => {
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'owner' } });
    renderComposer();
    type('kept');
    setBot(bot('needs_token', false));
    expect(box()).toBeDisabled();
    expect(send()).toBeDisabled();
    expect(
      screen.getByText("Replies can't be sent — the bot is not working and needs a new token."),
    ).toBeInTheDocument();
    expect(screen.getByText('They can be sent again once the bot works.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/bot`,
    );
    expect((box() as HTMLTextAreaElement).value).toBe('kept');
  });

  it('owner, not_connected: the disconnected message', () => {
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'owner' } });
    renderComposer();
    setBot(bot('not_connected', false));
    expect(
      screen.getByText("Replies can't be sent — the bot is disconnected."),
    ).toBeInTheDocument();
  });

  it('operator: asked to contact an owner, no link', () => {
    renderComposer();
    setBot(bot('not_connected', false));
    expect(screen.getByText('Ask a business owner to fix the bot.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('available again on bot.changed without a reload, draft intact', () => {
    renderComposer();
    type('kept');
    setBot(bot('needs_token', false));
    expect(box()).toBeDisabled();
    setBot(bot('connected', true));
    expect(box()).toBeEnabled();
    expect(screen.queryByText(/Replies can't be sent/)).not.toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('kept');
    expect(send()).toBeEnabled();
  });

  it('409 BOT_CANNOT_REPLY turns the composer unavailable from details.bot, text kept', async () => {
    api.sendReply.mockRejectedValue(
      refusal(409, 'BOT_CANNOT_REPLY', { bot: bot('not_connected', false) }),
    );
    renderComposer();
    type('Hello');
    enter();
    await flush();
    expect(box()).toBeDisabled();
    expect(screen.getByText('Ask a business owner to fix the bot.')).toBeInTheDocument();
    expect((box() as HTMLTextAreaElement).value).toBe('Hello');
  });
});
