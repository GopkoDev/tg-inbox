import { createContext, useContext } from 'react';
import type { GuardFn } from '@/features/workspaces/guard';

export const ShellGuardContext = createContext<GuardFn | null>(null);

/** The shared guard handler (401 / ACCESS_REMOVED / 404) wired by AppShell for its screens. */
export function useShellGuard(): GuardFn {
  const guard = useContext(ShellGuardContext);
  if (!guard) throw new Error('useShellGuard must be used inside <AppShell>');
  return guard;
}
