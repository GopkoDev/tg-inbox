import type { IssuedConnectLink, NotificationSettings } from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { subscribeLive } from '@/shared/api/live-connection';
import {
  connectRefusal,
  createConnectLink,
  disconnectTelegram,
  getNotificationSettings,
} from './api';

export type NotificationsStatus = 'loading' | 'ready' | 'error' | 'not_found';
export type NotificationsAction = 'idle' | 'connecting' | 'disconnecting';
/** A message under the status line; cleared by the next action, or (already connected) re-read. */
export type NotificationsNotice = 'already_connected' | 'connect_failed' | 'disconnect_failed';

/** What a connect attempt came to; the card opens SCR-17 on `issued`, the dialog shows the rest. */
export type ConnectOutcome =
  | { kind: 'issued'; link: IssuedConnectLink }
  | { kind: 'limit'; retryAt: string }
  | { kind: 'already_linked' }
  | { kind: 'no_working_bot' }
  | { kind: 'failed' }
  | { kind: 'busy' }
  /** The guard took over (session ended, access removed, not found). */
  | { kind: 'guarded' };

/**
 * SCR-16's Telegram pings card state for the workspace in `workspaceId` (US-03). Loaded when the
 * page opens, replaced by every action's answer, and re-read on the account's own live frames.
 * Holds the issued connect link only while SCR-17 shows it; the link is never persisted.
 */
interface NotificationsState {
  workspaceId: string | null;
  settings: NotificationSettings | null;
  status: NotificationsStatus;
  action: NotificationsAction;
  notice: NotificationsNotice | null;
  /** The 429's `retry_at`: connecting is off until then. */
  limitUntil: string | null;
  load: (workspaceId: string, guard: GuardFn, options?: { background?: boolean }) => Promise<void>;
  connect: (workspaceId: string, guard: GuardFn) => Promise<ConnectOutcome>;
  disconnect: (workspaceId: string, guard: GuardFn) => Promise<void>;
  clearLimit: (workspaceId: string) => void;
  /** Re-reads on this account's link changes, the bot's changes and a resync; returns the stop. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  clear: () => void;
}

const EMPTY = {
  workspaceId: null,
  settings: null,
  status: 'loading',
  action: 'idle',
  notice: null,
  limitUntil: null,
} as const;

const GUARD_STATUSES = new Set([401, 403, 404]);
const isGuardAnswer = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  GUARD_STATUSES.has((error as { status: number }).status);

export const useNotificationsStore = create<NotificationsState>()((set, get) => {
  /** Reads in flight per store lifetime: a background re-read asked during one runs once more. */
  let reading: { again: boolean } | null = null;

  const stillHere = (workspaceId: string) => get().workspaceId === workspaceId;

  /** A refusal of the shell guard's kind; true when it was one (the guard took over). */
  const guarded = async (error: unknown, workspaceId: string, guard: GuardFn) => {
    if (!isGuardAnswer(error)) return false;
    try {
      const outcome = await guard(error, workspaceId);
      if (outcome === 'not-found' && stillHere(workspaceId))
        set({ settings: null, status: 'not_found' });
    } catch {
      // the guard could not resolve; the screen keeps its state
    }
    return true;
  };

  const load: NotificationsState['load'] = async (workspaceId, guard, options) => {
    if (get().workspaceId !== workspaceId) set({ ...EMPTY, workspaceId });
    else if (!options?.background) set({ status: 'loading', notice: null });
    if (options?.background && reading) {
      reading.again = true;
      return;
    }
    const mine = { again: false };
    reading = mine;
    try {
      const settings = await getNotificationSettings(workspaceId, options);
      if (stillHere(workspaceId)) {
        set({
          settings,
          status: 'ready',
          notice: get().notice === 'already_connected' ? null : get().notice,
        });
      }
    } catch (error) {
      if (stillHere(workspaceId)) {
        if (await guarded(error, workspaceId, guard)) {
          // the guard decided
        } else if (!options?.background || !get().settings) {
          // a failed background re-read keeps the state shown
          set({ status: get().settings && options?.background ? 'ready' : 'error' });
        }
      }
    } finally {
      if (reading === mine) reading = null;
    }
    if (mine.again && stillHere(workspaceId)) await load(workspaceId, guard, { background: true });
  };

  return {
    ...EMPTY,
    load,
    async connect(workspaceId, guard) {
      if (!stillHere(workspaceId) || get().action !== 'idle') return { kind: 'busy' };
      set({ action: 'connecting', notice: null });
      try {
        const link = await createConnectLink(workspaceId);
        return { kind: 'issued', link };
      } catch (error) {
        const refusal = connectRefusal(error);
        if (refusal && stillHere(workspaceId)) {
          if (refusal.kind === 'limit') {
            set({ limitUntil: refusal.retryAt });
            return { kind: 'limit', retryAt: refusal.retryAt };
          }
          set({
            settings: refusal.settings,
            status: 'ready',
            notice: refusal.kind === 'already_linked' ? 'already_connected' : null,
          });
          return { kind: refusal.kind };
        }
        if (await guarded(error, workspaceId, guard)) return { kind: 'guarded' };
        if (stillHere(workspaceId)) set({ notice: 'connect_failed' });
        return { kind: 'failed' };
      } finally {
        if (stillHere(workspaceId)) set({ action: 'idle' });
      }
    },
    async disconnect(workspaceId, guard) {
      if (!stillHere(workspaceId) || get().action !== 'idle') return;
      set({ action: 'disconnecting', notice: null });
      try {
        const settings = await disconnectTelegram(workspaceId);
        if (stillHere(workspaceId)) set({ settings, status: 'ready' });
      } catch (error) {
        if (await guarded(error, workspaceId, guard)) return;
        if (stillHere(workspaceId)) set({ notice: 'disconnect_failed' });
      } finally {
        if (stillHere(workspaceId)) set({ action: 'idle' });
      }
    },
    clearLimit(workspaceId) {
      if (stillHere(workspaceId)) set({ limitUntil: null });
    },
    watch(workspaceId, guard) {
      const reread = () => void load(workspaceId, guard, { background: true });
      return subscribeLive(workspaceId, {
        onFrame: (frame) => {
          if (frame.workspace_id !== workspaceId) return;
          if (
            frame.type === 'telegram_link.changed' ||
            frame.type === 'bot.changed' ||
            frame.type === 'resync'
          )
            reread();
        },
        onReconnected: reread,
        onInvalidFrame: reread,
        onClosed: () => undefined, // the shell and the next request decide
      });
    },
    clear: () => {
      reading = null;
      set({ ...EMPTY });
    },
  };
});

// Workspace switch, access removed and sign-out all change the current workspace: drop its state.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useNotificationsStore.getState().clear();
});
