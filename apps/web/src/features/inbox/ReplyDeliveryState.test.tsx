import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { InboxBotStatus, ThreadReply } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const api = {
  resendReply: vi.fn(),
  getInboxBotStatus: vi.fn(),
};
vi.mock('./api-source', () => ({
  resendReply: (...a: unknown[]) => api.resendReply(...a),
  getInboxBotStatus: (...a: unknown[]) => api.getInboxBotStatus(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: () => vi.fn(),
}));

import { ReplyDeliveryState } from './ReplyDeliveryState';
import { useInboxStore } from './store';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, min)).toISOString();
const bot = (state: InboxBotStatus['state'], can_reply = true): InboxBotStatus => ({
  workspace_id: WS,
  state,
  can_reply,
  receiving: state === 'connected',
});
const reply = (over: Partial<ThreadReply> = {}): ThreadReply => ({
  type: 'reply',
  id: id(701),
  workspace_id: WS,
  conversation_id: CONV,
  client_key: id(801),
  body: 'hello',
  author: { account_id: id(950), display_name: 'Olena Operator' },
  state: 'sending',
  failure_reason: null,
  position_at: at(1),
  sent_at: null,
  created_at: at(1),
  ...over,
});
const failed = (reason: NonNullable<ThreadReply['failure_reason']>) =>
  reply({ state: 'not_delivered', failure_reason: reason });
const refusal = (status: number, code: string, details: unknown) =>
  new ApiError(status, code as never, 'refused', details);
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => Promise.resolve());
};

function seed(items: ThreadReply[], botState: InboxBotStatus = bot('connected')) {
  useInboxStore.setState({
    workspaceId: WS,
    bot: botState,
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
const show = (r: ThreadReply, takenOver = false) => {
  seed([r], takenOver ? bot('taken_over') : bot('connected'));
  return render(<ReplyDeliveryState reply={r} workspaceId={WS} />);
};

beforeEach(() => {
  stubRadixDom();
  Object.values(api).forEach((m) => m.mockReset());
});
afterEach(() => useInboxStore.getState().leave());

describe('ReplyDeliveryState lines', () => {
  it('shows Sending and Sent without any button', () => {
    const { rerender } = show(reply());
    expect(screen.getByText('Sending')).toBeInTheDocument();
    rerender(
      <ReplyDeliveryState reply={reply({ state: 'sent', sent_at: at(2) })} workspaceId={WS} />,
    );
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['customer_blocked', 'Not delivered — the customer blocked the bot'],
    ['customer_account_gone', "Not delivered — the customer's Telegram account no longer exists"],
    ['chat_not_found', "Not delivered — the customer's Telegram account no longer exists"],
    ['bot_not_working', 'Not delivered — the bot is not working'],
    ['author_access_removed', "Not delivered — the author's access was removed"],
  ] as const)('%s shows its reason and no button', (reason, text) => {
    show(failed(reason));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('adds the unblock hint only for a blocked customer', () => {
    const hint = 'They can be reached again only after they unblock the bot and write to it';
    const { unmount } = show(failed('customer_blocked'));
    expect(screen.getByText(hint)).toBeInTheDocument();
    unmount();
    show(failed('bot_not_working'));
    expect(screen.queryByText(hint)).toBeNull();
  });

  it.each([
    ['telegram_not_accepted', 'Not delivered — Telegram did not accept it'],
    ['delivery_interrupted', 'Not delivered — sending was interrupted'],
  ] as const)('%s offers Try again', (reason, text) => {
    show(failed(reason));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('not confirmed offers Send again', () => {
    show(reply({ state: 'not_confirmed' }));
    expect(
      screen.getByText('Not confirmed — it may or may not have reached the customer'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
  });

  it('adds the taken-over note next to every state', () => {
    const { unmount } = show(reply(), true);
    expect(screen.getByText('New customer messages are not arriving')).toBeInTheDocument();
    unmount();
    show(reply(), false);
    expect(screen.queryByText('New customer messages are not arriving')).toBeNull();
  });
});

describe('Try again', () => {
  const retry = () => fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

  it('disables the button while in flight and moves the reply to the end on 200', async () => {
    const r = failed('telegram_not_accepted');
    const later = reply({ id: id(702), client_key: id(802), position_at: at(5), body: 'later' });
    seed([r, later]);
    let done!: (v: ThreadReply) => void;
    api.resendReply.mockReturnValue(new Promise((res) => (done = res)));
    render(<ReplyDeliveryState reply={r} workspaceId={WS} />);
    retry();
    await flush();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDisabled();
    expect(api.resendReply).toHaveBeenCalledWith(WS, CONV, r.id, {}, expect.anything());
    done(reply({ id: r.id, client_key: r.client_key, position_at: at(9) }));
    await flush();
    expect(useInboxStore.getState().thread?.items.map((i) => i.id)).toEqual([later.id, r.id]);
  });

  it('redraws from details.reply on REPLY_NOT_RESENDABLE, with no message', async () => {
    const r = failed('telegram_not_accepted');
    seed([r]);
    const winner = reply({ id: r.id, position_at: at(8) });
    api.resendReply.mockRejectedValue(refusal(409, 'REPLY_NOT_RESENDABLE', { reply: winner }));
    render(<ReplyDeliveryState reply={r} workspaceId={WS} />);
    retry();
    await flush();
    expect(useInboxStore.getState().thread?.items[0]).toEqual(winner);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it('shows the seconds on REPLY_LIMIT_REACHED and keeps the state', async () => {
    show(failed('telegram_not_accepted'));
    api.resendReply.mockRejectedValue(
      refusal(429, 'REPLY_LIMIT_REACHED', {
        limit: 30,
        window_seconds: 60,
        retry_at: new Date(Date.now() + 12_000).toISOString(),
      }),
    );
    retry();
    await flush();
    expect(
      screen.getByText(/Replies are limited to 30 per minute — you can send again in \d+ seconds?/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('turns the composer unavailable on BOT_CANNOT_REPLY and keeps the state', async () => {
    show(failed('telegram_not_accepted'));
    api.resendReply.mockRejectedValue(
      refusal(409, 'BOT_CANNOT_REPLY', { bot: bot('needs_token', false) }),
    );
    retry();
    await flush();
    expect(useInboxStore.getState().bot?.can_reply).toBe(false);
    expect(screen.getByText(/Not delivered — Telegram did not accept it/)).toBeInTheDocument();
  });

  it('says Something went wrong on a network error', async () => {
    show(failed('delivery_interrupted'));
    api.resendReply.mockRejectedValue(new Error('offline'));
    retry();
    await flush();
    expect(screen.getByText('Something went wrong — try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});

describe('SCR-05 Send again', () => {
  const r = () => reply({ state: 'not_confirmed' });
  const open = async () => {
    seed([r()]);
    render(<ReplyDeliveryState reply={r()} workspaceId={WS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await flush();
  };
  const dialog = () => screen.getByRole('alertdialog');

  it('opens the warning and cancel sends nothing', async () => {
    await open();
    expect(within(dialog()).getByText('Send this reply again?')).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        'tg-inbox could not confirm that it reached the customer. If it did, the customer will receive it twice.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.resendReply).not.toHaveBeenCalled();
    expect(screen.getByText(/Not confirmed/)).toBeInTheDocument();
  });

  it('sends with confirm_duplicate_risk, pending then closes and moves to the end', async () => {
    let done!: (v: ThreadReply) => void;
    api.resendReply.mockReturnValue(new Promise((res) => (done = res)));
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(api.resendReply).toHaveBeenCalledWith(
      WS,
      CONV,
      r().id,
      { confirm_duplicate_risk: true },
      expect.anything(),
    );
    expect(within(dialog()).getByRole('button', { name: /Send again/ })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    done(reply({ position_at: at(9) }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useInboxStore.getState().thread?.items[0]).toMatchObject({ state: 'sending' });
  });

  it('stays open when confirmation is still required', async () => {
    api.resendReply.mockRejectedValue(refusal(409, 'DUPLICATE_RISK_CONFIRMATION_REQUIRED', {}));
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole('alert')).toBeInTheDocument();
  });

  it('closes and redraws on REPLY_NOT_RESENDABLE', async () => {
    const winner = reply({ position_at: at(8) });
    api.resendReply.mockRejectedValue(refusal(409, 'REPLY_NOT_RESENDABLE', { reply: winner }));
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useInboxStore.getState().thread?.items[0]).toEqual(winner);
  });

  it('closes on 429 and shows the seconds under the reply', async () => {
    api.resendReply.mockRejectedValue(
      refusal(429, 'REPLY_LIMIT_REACHED', {
        limit: 30,
        window_seconds: 60,
        retry_at: new Date(Date.now() + 5_000).toISOString(),
      }),
    );
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText(/you can send again in \d+ seconds?/)).toBeInTheDocument();
  });

  it('closes on BOT_CANNOT_REPLY', async () => {
    api.resendReply.mockRejectedValue(
      refusal(409, 'BOT_CANNOT_REPLY', { bot: bot('needs_token', false) }),
    );
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useInboxStore.getState().bot?.can_reply).toBe(false);
  });

  it('shows Something went wrong inside the dialog on a network error', async () => {
    api.resendReply.mockRejectedValue(new Error('offline'));
    await open();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Send again' }));
    await flush();
    expect(within(dialog()).getByText('Something went wrong — try again')).toBeInTheDocument();
  });
});
