/**
 * The per-browser desktop-notification opt-in (US-02, AC-03). The flag lives in `localStorage`
 * keyed by account and workspace; it is a per-viewer convenience, so every read and write is in
 * try/catch and storage that throws means "not available". The browser is asked for permission
 * only inside `turnOn`, which the card calls from its button's click handler.
 */

export const WORKER_URL = '/notifications-sw.js?v=1';
const FLAG_PREFIX = 'tg.desktop-notifications.';

export type DesktopPermission = NotificationPermission | 'unsupported';
export type DesktopState = 'off' | 'on' | 'blocked' | 'unavailable';

const flagKey = (accountId: string, workspaceId: string) =>
  `${FLAG_PREFIX}${accountId}.${workspaceId}`;

function storageWorks(): boolean {
  try {
    const probe = `${FLAG_PREFIX}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** The browser can show notifications (Notification + service worker) and keep the flag. */
export function capability(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    storageWorks()
  );
}

export function permission(): DesktopPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function flagOn(accountId: string, workspaceId: string): boolean {
  try {
    return localStorage.getItem(flagKey(accountId, workspaceId)) === '1';
  } catch {
    return false;
  }
}

function anyFlagOn(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(FLAG_PREFIX) && localStorage.getItem(key) === '1') return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** The card's state, read without asking the browser for anything. */
export function readState(accountId: string, workspaceId: string): DesktopState {
  if (!capability()) return 'unavailable';
  const granted = permission();
  if (granted === 'denied') return 'blocked';
  return granted === 'granted' && flagOn(accountId, workspaceId) ? 'on' : 'off';
}

/**
 * Turn the opt-in on. Call it straight from the click handler: the permission request is the
 * first thing it does, and nothing else in the panel calls `Notification.requestPermission()`.
 */
export async function turnOn(
  accountId: string,
  workspaceId: string,
): Promise<Exclude<DesktopState, 'off'>> {
  if (!capability()) return 'unavailable';
  let result = Notification.permission;
  if (result === 'default') result = await Notification.requestPermission();
  if (result !== 'granted') return 'blocked';
  try {
    await navigator.serviceWorker.register(WORKER_URL, { scope: '/' });
    localStorage.setItem(flagKey(accountId, workspaceId), '1');
  } catch {
    return 'unavailable';
  }
  return 'on';
}

/** Clear the flag at once; the worker goes when no workspace in this browser keeps a flag. */
export async function turnOff(accountId: string, workspaceId: string): Promise<void> {
  try {
    localStorage.removeItem(flagKey(accountId, workspaceId));
  } catch {
    return;
  }
  if (anyFlagOn()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration?.unregister();
  } catch {
    // The flag is already off, so the worker shows nothing even if it stays registered.
  }
}
