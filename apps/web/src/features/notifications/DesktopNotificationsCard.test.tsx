import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { DesktopNotificationsCard } from './DesktopNotificationsCard';

const ME = '0198f0c0-0000-7000-8000-0000000000aa';
const WS = '0198f0c0-0000-7000-8000-000000000001';
const WS2 = '0198f0c0-0000-7000-8000-000000000002';
const KEY = (ws: string) => `tg.desktop-notifications.${ME}.${ws}`;

let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;
let unregister: ReturnType<typeof vi.fn>;

function stubBrowser(
  opts: { permission?: NotificationPermission; answer?: NotificationPermission } = {},
) {
  permission = opts.permission ?? 'default';
  requestPermission = vi.fn(async () => {
    permission = opts.answer ?? 'granted';
    return permission;
  });
  const Fake = function () {} as unknown as typeof Notification;
  Object.defineProperty(Fake, 'permission', { get: () => permission });
  Fake.requestPermission = requestPermission as never;
  vi.stubGlobal('Notification', Fake);
  unregister = vi.fn(async () => true);
  register = vi.fn(async () => ({}));
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, getRegistration: vi.fn(async () => ({ unregister })) },
  });
}

const renderCard = () =>
  render(<DesktopNotificationsCard workspaceId={WS} workspaceName="Acme Flowers" />);

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setAccount({ id: ME, email: 'me@example.com', display_name: 'Me' });
  stubBrowser();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('DesktopNotificationsCard', () => {
  it('off by default, asks nothing on render', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Desktop notifications' })).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Get a notification on this computer when a customer writes in a conversation that is yours or unassigned and you're not looking at Acme Flowers.",
      ),
    ).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('asks only from the click: spinner and disabled while the prompt is open, then On', async () => {
    let answer!: (p: NotificationPermission) => void;
    requestPermission.mockImplementation(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          answer = (p) => {
            permission = p;
            resolve(p);
          };
        }),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on desktop notifications' }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Turn on desktop notifications' })).toBeDisabled();
    await act(async () => answer('granted'));
    await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
    expect(register).toHaveBeenCalledWith(expect.stringMatching(/^\/notifications-sw\.js\?v=/), {
      scope: '/',
    });
    expect(localStorage.getItem(KEY(WS))).toBe('1');
    expect(
      screen.getByText(
        "On for Acme Flowers in this browser. Notifications show the customer's name, never the message.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('already granted: turns on without a prompt', async () => {
    stubBrowser({ permission: 'granted' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on desktop notifications' }));
    await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('shows On on load when the flag and permission are both there', () => {
    stubBrowser({ permission: 'granted' });
    localStorage.setItem(KEY(WS), '1');
    renderCard();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('a dismissed prompt is blocked for this click (permission stays default, so a reload offers the button again)', async () => {
    stubBrowser({ answer: 'default' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on desktop notifications' }));
    await waitFor(() => expect(screen.getByText(/are blocked for this site/)).toBeInTheDocument());
    expect(localStorage.getItem(KEY(WS))).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('a refused prompt shows the blocked text with no button that asks again', async () => {
    stubBrowser({ answer: 'denied' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on desktop notifications' }));
    await waitFor(() => expect(screen.getByText(/are blocked for this site/)).toBeInTheDocument());
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('The count in the tab title and next to Inbox keeps working.'),
    ).toBeInTheDocument();
  });

  it('already denied, also when revoked while the flag was on: blocked, no prompt', () => {
    stubBrowser({ permission: 'denied' });
    localStorage.setItem(KEY(WS), '1');
    renderCard();
    expect(screen.getByText(/are blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  const unavailable = () => {
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This browser can't show desktop notifications. The count in the tab title and next to Inbox keeps working.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  };

  it('not available without the Notification API', () => {
    vi.stubGlobal('Notification', undefined);
    renderCard();
    unavailable();
  });

  it('not available without a service worker', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    renderCard();
    unavailable();
  });

  it('not available when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderCard();
    unavailable();
  });

  it('not available when the worker registration fails, and no flag is stored', async () => {
    register.mockRejectedValue(new Error('nope'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on desktop notifications' }));
    await waitFor(() => expect(screen.getByText('Not available')).toBeInTheDocument());
    expect(localStorage.getItem(KEY(WS))).toBeNull();
  });

  it('turn off clears the flag at once and unregisters the worker when no workspace keeps it', async () => {
    stubBrowser({ permission: 'granted' });
    localStorage.setItem(KEY(WS), '1');
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(localStorage.getItem(KEY(WS))).toBeNull();
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: 'Turn on desktop notifications' }),
    ).toBeInTheDocument();
  });

  it('turn off keeps the worker while another workspace keeps its flag', async () => {
    stubBrowser({ permission: 'granted' });
    localStorage.setItem(KEY(WS), '1');
    localStorage.setItem(KEY(WS2), '1');
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(localStorage.getItem(KEY(WS))).toBeNull());
    expect(unregister).not.toHaveBeenCalled();
  });
});
