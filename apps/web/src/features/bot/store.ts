import { ErrorCode, type BotSettings } from '@tg/shared';
import { create } from 'zustand';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import type { GuardFn } from '@/features/workspaces/guard';
import { getBotSettings } from './api';

export type BotStatus = 'loading' | 'ready' | 'error' | 'owners_only' | 'not_found';

/** A one-line result shown above the settings (an action's success or the server's message). */
export interface BotNotice {
  tone: 'success' | 'info' | 'error';
  text: string;
}

/**
 * SCR-02 state for the workspace in `workspaceId`. Loaded on page open and replaced by the
 * BotSettings of every action response. Holds no token: the token lives only in the paste
 * dialog's input and component memory (screens.md §Token secrecy).
 */
interface BotStoreState {
  workspaceId: string | null;
  settings: BotSettings | null;
  status: BotStatus;
  notice: BotNotice | null;
  /** Loads the settings; refusals other than OWNER_ONLY go to the shell guard when given. */
  load: (workspaceId: string, guard?: GuardFn, options?: { background?: boolean }) => Promise<void>;
  replace: (settings: BotSettings, notice?: BotNotice | null) => void;
  setNotice: (notice: BotNotice | null) => void;
  /** An action was refused for the whole page (an operator, or no membership). */
  markRefused: (status: 'owners_only' | 'not_found') => void;
  clear: () => void;
}

const EMPTY = { workspaceId: null, settings: null, status: 'loading', notice: null } as const;

export const useBotStore = create<BotStoreState>()((set, get) => ({
  ...EMPTY,
  async load(workspaceId, guard, options) {
    if (get().workspaceId !== workspaceId) set({ ...EMPTY, workspaceId });
    // A foreground (re)load shows the loading state; a background refresh keeps what is shown.
    else if (!options?.background) set({ status: 'loading' });
    // A response for a workspace the store has since left is dropped.
    const stillHere = () => get().workspaceId === workspaceId;
    try {
      const settings = await getBotSettings(workspaceId, options);
      if (stillHere()) set({ settings, status: 'ready' });
    } catch (error) {
      if (!stillHere()) return;
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.code === ErrorCode.OWNER_ONLY
      ) {
        set({ settings: null, status: 'owners_only' });
        return;
      }
      if (!guard) {
        set({ status: 'error' });
        return;
      }
      try {
        const outcome = await guard(error, workspaceId);
        if (outcome === 'not-found' && stillHere()) set({ settings: null, status: 'not_found' });
      } catch {
        if (stillHere()) set({ status: 'error' });
      }
    }
  },
  replace: (settings, notice = null) => set({ settings, status: 'ready', notice }),
  setNotice: (notice) => set({ notice }),
  markRefused: (status) => set({ settings: null, status, notice: null }),
  clear: () => set({ ...EMPTY }),
}));

// Workspace switch, access removed and sign-out all change the current workspace: drop its bot.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useBotStore.getState().clear();
});
