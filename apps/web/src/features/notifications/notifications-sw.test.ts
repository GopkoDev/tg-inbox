import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../public/notifications-sw.js'),
  'utf8',
);
const WS = '0198f0c0-0000-7000-8000-000000000001';
const CONV = '0198f0c0-0000-7000-8000-0000000000c1';

interface FakeClient {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
const client = (path: string, focused = false): FakeClient => ({
  url: `https://panel.test${path}`,
  focused,
  focus: vi.fn(async function (this: FakeClient) {
    return this;
  }),
  postMessage: vi.fn(),
});

let handlers: Record<string, (e: unknown) => void>;
let clients: FakeClient[];
let showNotification: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn>;
let matchAll: ReturnType<typeof vi.fn>;

function load() {
  handlers = {};
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    location: { origin: 'https://panel.test' },
  };
  new Function('self', SOURCE)(self);
}
async function send(data: unknown) {
  const waits: Promise<unknown>[] = [];
  handlers.message?.({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}
const candidate = (over: Record<string, unknown> = {}) => ({
  type: 'candidate',
  workspaceId: WS,
  workspaceName: 'Acme Flowers',
  conversationId: CONV,
  messageId: 'm1',
  contactName: 'Olena Kravets',
  url: `/w/${WS}/inbox/${CONV}`,
  ...over,
});

beforeEach(() => {
  clients = [];
  showNotification = vi.fn(async () => undefined);
  openWindow = vi.fn(async () => null);
  matchAll = vi.fn(async () => clients);
  load();
});

describe('notifications-sw.js', () => {
  it('has no fetch (or push, sync) handler: notifications only', () => {
    expect(Object.keys(handlers).sort()).toEqual([
      'activate',
      'install',
      'message',
      'notificationclick',
    ]);
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/caches\b|fetch|'push'|'sync'/);
  });

  it('asks matchAll for window clients including uncontrolled ones', async () => {
    await send(candidate());
    expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  it('shows the title, «New message», the tag and renotify, and never any text', async () => {
    clients = [client(`/w/${WS}/contacts`, false)];
    await send({ ...candidate(), body: 'secret text', text: 'secret text' });
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0]!;
    expect(title).toBe('Olena Kravets · Acme Flowers');
    expect(options).toMatchObject({
      body: 'New message',
      tag: `${WS}:${CONV}`,
      renotify: true,
      icon: '/favicon.svg',
    });
    expect(JSON.stringify(options)).not.toContain('secret');
    expect(options.data).toEqual({
      workspaceId: WS,
      conversationId: CONV,
      url: `/w/${WS}/inbox/${CONV}`,
    });
  });

  it('shows nothing while a tab of the workspace is focused', async () => {
    clients = [client(`/w/${WS}/inbox`, false), client(`/w/${WS}/settings/bot`, true)];
    await send(candidate());
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('a focused tab of another workspace does not hold it back', async () => {
    clients = [
      client('/w/0198f0c0-0000-7000-8000-000000000002/inbox', true),
      client(`/w/${WS}/inbox`, false),
    ];
    await send(candidate());
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('a visible tab behind another window (not focused) does not hold it back', async () => {
    clients = [client(`/w/${WS}/inbox`, false)];
    await send(candidate());
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when no tab of the workspace is open in this browser', async () => {
    clients = [client('/sign-in', false)];
    await send(candidate());
    expect(showNotification).not.toHaveBeenCalled();
    clients = [];
    await send(candidate({ messageId: 'm2' }));
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('two tabs posting the same message produce one notification', async () => {
    clients = [client(`/w/${WS}/inbox`)];
    await Promise.all([send(candidate()), send(candidate())]);
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('a later message of the same conversation replaces it under the same tag', async () => {
    clients = [client(`/w/${WS}/inbox`)];
    await send(candidate());
    await send(candidate({ messageId: 'm2' }));
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[1]![1]).toMatchObject({ tag: `${WS}:${CONV}` });
  });

  it('keeps the contact name as plain text in the title', async () => {
    clients = [client(`/w/${WS}/inbox`)];
    await send(candidate({ contactName: '<b>x</b>' }));
    expect(showNotification.mock.calls[0]![0]).toBe('<b>x</b> · Acme Flowers');
  });

  it('ignores a malformed message', async () => {
    clients = [client(`/w/${WS}/inbox`)];
    await send(null);
    await send({ type: 'candidate' });
    await send({ type: 'other' });
    expect(showNotification).not.toHaveBeenCalled();
  });

  describe('click', () => {
    const click = async () => {
      const close = vi.fn();
      const waits: Promise<unknown>[] = [];
      handlers.notificationclick?.({
        notification: {
          close,
          data: { workspaceId: WS, conversationId: CONV, url: `/w/${WS}/inbox/${CONV}` },
        },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
      await Promise.all(waits);
      return close;
    };

    it('focuses the first workspace client (most recently focused) and asks it to open the conversation', async () => {
      const first = client(`/w/${WS}/settings/team`);
      const second = client(`/w/${WS}/inbox`);
      clients = [client('/w/0198f0c0-0000-7000-8000-000000000002/inbox'), first, second];
      const close = await click();
      expect(close).toHaveBeenCalled();
      expect(first.focus).toHaveBeenCalled();
      expect(first.postMessage).toHaveBeenCalledWith({
        type: 'open-conversation',
        workspaceId: WS,
        conversationId: CONV,
      });
      expect(second.focus).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("opens the conversation's address when no tab of the workspace is left", async () => {
      clients = [client('/sign-in')];
      await click();
      expect(openWindow).toHaveBeenCalledWith(`/w/${WS}/inbox/${CONV}`);
    });
  });
});
