import type { Account } from '@tg/shared';
import { create } from 'zustand';

interface AuthState {
  account: Account | null;
  /** Address to return to after signing in again (set when the session ends). */
  returnTo: string | null;
  setAccount: (account: Account) => void;
  setReturnTo: (address: string | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  account: null,
  returnTo: null,
  setAccount: (account) => set({ account }),
  setReturnTo: (returnTo) => set({ returnTo }),
  clear: () => set({ account: null, returnTo: null }),
}));
