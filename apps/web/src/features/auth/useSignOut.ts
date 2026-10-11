import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { signOut } from './api';
import { useAuthStore } from './store';

/** AC-11: end the session (tolerating an already-ended one), clear every store, go to sign-in. */
export function useSignOut() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      // the session is gone either way; the outcome is the sign-in screen
    } finally {
      useAuthStore.getState().clear();
      useWorkspaceStore.getState().clear();
      void navigate('/sign-in');
    }
  }
  return { busy, signOut: run };
}
