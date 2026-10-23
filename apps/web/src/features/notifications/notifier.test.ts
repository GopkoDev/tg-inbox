import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ConversationSummary, LiveFrame } from '@tg/shared';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const ME = '0198f0c0-0000-7000-8000-0000000000aa';
const TEAMMATE = '0198f0c0-0000-7000-8000-0000000000bb';
const CONV = '0198f0c0-0000-7000-8000-0000000000c1';
const MSG = '0198f0c0-0000-7000-8000-0000000000d1';

const live = vi.hoisted(() => ({ handlers: null as null | { onFrame: (f: LiveFrame) => void } }));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, handlers: { onFrame: (f: LiveFrame) => void }) => {
    live.handlers = handlers;
    return () => {
      live.handlers = null;
    };
  },
}));
const api = vi.hoisted(() => ({ getConversation: vi.fn() }));
vi.mock('@/features/inbox/api-source', () => ({
  getConversation: (...a: unknown[]) => api.getConversation(...a),
}));
const desktop = vi.hoisted(() => ({ readState: vi.fn(), ensureWorker: vi.fn() }));
vi.mock('./desktop', () => ({
  readState: (...a: unknown[]) => desktop.readState(...a),
  ensureWorker: () => desktop.ensureWorker(),
}));

import { startNotifier } from './notifier';

const row = (over: Partial<ConversationSummary> = {}) =>
  ({
    id: CONV,
    workspace_id: WS,
    contact: { id: 'x', first_name: 'Olena', last_name: 'Kravets', username: null },
    status: 'open',
    assignee: null,
    ...over,
  }) as ConversationSummary;
const frame = (over: Record<string, unknown> = {}) =>
  ({
    v: 1,
    type: 'conversation.changed',
    workspace_id: WS,
    conversation_id: CONV,
    item: { type: 'message', id: MSG },
    change: 'created',
    ...over,
  }) as LiveFrame;

let postMessage: ReturnType<typeof vi.fn>;
let swListeners: Record<string, (e: unknown) => void>;
let navigate: Mock<(path: string) => void>;
let stop: () => void;

const flush = () => new Promise((r) => setTimeout(r, 0));
const emit = async (f: LiveFrame) => {
  live.handlers?.onFrame(f);
  await flush();
};

beforeEach(() => {
  postMessage = vi.fn();
  swListeners = {};
  navigate = vi.fn<(path: string) => void>();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => ({ active: { postMessage } })),
      addEventListener: (type: string, fn: (e: unknown) => void) => (swListeners[type] = fn),
      removeEventListener: (type: string) => delete swListeners[type],
    },
  });
  desktop.readState.mockReturnValue('on');
  desktop.ensureWorker.mockResolvedValue(true);
  api.getConversation.mockResolvedValue(row());
  stop = startNotifier({
    workspaceId: WS,
    workspaceName: 'Acme Flowers',
    accountId: ME,
    navigate,
  });
});
afterEach(() => {
  stop();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.clearAllMocks();
});

describe('notifier', () => {
  it('posts the candidate for a new message in an unassigned open conversation', async () => {
    await emit(frame());
    expect(postMessage).toHaveBeenCalledWith({
      type: 'candidate',
      workspaceId: WS,
      workspaceName: 'Acme Flowers',
      conversationId: CONV,
      messageId: MSG,
      contactName: 'Olena Kravets',
      url: `/w/${WS}/inbox/${CONV}`,
    });
  });

  it('posts for my own conversation', async () => {
    api.getConversation.mockResolvedValue(
      row({ assignee: { account_id: ME, display_name: 'Me' } }),
    );
    await emit(frame());
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('a customer message that reopens a closed conversation counts (the re-read row is open)', async () => {
    await emit(frame());
    expect(api.getConversation).toHaveBeenCalledWith(WS, CONV, expect.anything());
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a teammate's conversation",
      row({ assignee: { account_id: TEAMMATE, display_name: 'Bob' } }),
      frame(),
    ],
    ['a closed conversation', row({ status: 'closed' }), frame()],
    ['an edit', row(), frame({ change: 'edited' })],
    ['a reply', row(), frame({ item: { type: 'reply', id: MSG } })],
    ['an activity entry', row(), frame({ item: { type: 'activity', id: MSG } })],
    ['a state change', row(), frame({ change: 'state' })],
    ['a read', row(), frame({ item: null, change: 'read' })],
  ])('does not post for %s', async (_name, conversation, f) => {
    api.getConversation.mockResolvedValue(conversation);
    await emit(f);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not even read the row while the flag or permission is off', async () => {
    desktop.readState.mockReturnValue('off');
    await emit(frame());
    expect(api.getConversation).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('ignores a frame of another workspace', async () => {
    await emit(frame({ workspace_id: '0198f0c0-0000-7000-8000-000000000002' }));
    expect(api.getConversation).not.toHaveBeenCalled();
  });

  it('a failed re-read posts nothing and does not throw', async () => {
    api.getConversation.mockRejectedValue(new Error('network'));
    await emit(frame());
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('stops listening when stopped', () => {
    stop();
    expect(live.handlers).toBeNull();
  });

  it("navigates in place on the worker's open message for this workspace", () => {
    swListeners.message?.({
      data: { type: 'open-conversation', workspaceId: WS, conversationId: CONV },
    });
    expect(navigate).toHaveBeenCalledWith(`/w/${WS}/inbox/${CONV}`);
  });

  it('ignores an open message for another workspace or of another shape', () => {
    swListeners.message?.({
      data: { type: 'open-conversation', workspaceId: 'other', conversationId: CONV },
    });
    swListeners.message?.({ data: { type: 'something', workspaceId: WS } });
    swListeners.message?.({ data: null });
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('keeps the worker of an opt-in that is on (W8)', () => {
    const restart = () => {
      stop();
      stop = startNotifier({
        workspaceId: WS,
        workspaceName: 'Acme Flowers',
        accountId: ME,
        navigate,
      });
    };

    it('on start, with the opt-in on, makes sure the worker is registered', () => {
      desktop.ensureWorker.mockClear();
      desktop.readState.mockReturnValue('on');
      restart();
      expect(desktop.readState).toHaveBeenCalledWith(ME, WS);
      expect(desktop.ensureWorker).toHaveBeenCalledTimes(1);
    });

    it('registers nothing while the opt-in is off', () => {
      desktop.ensureWorker.mockClear();
      desktop.readState.mockReturnValue('off');
      restart();
      expect(desktop.ensureWorker).not.toHaveBeenCalled();
    });
  });
});
