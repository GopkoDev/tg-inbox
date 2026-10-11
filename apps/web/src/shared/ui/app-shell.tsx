import { Menu, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { getMe } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useSignOut } from '@/features/auth/useSignOut';
import { useGuard, type GuardFn } from '@/features/workspaces/guard';
import { WorkspaceSwitcher } from '@/features/workspaces/picker/WorkspaceSwitcher';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { useWorkspaceFromUrl } from '@/features/workspaces/useWorkspaceFromUrl';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { ShellGuardContext } from './app-shell-context';

/**
 * The workspace area frame (SCR-06/07/08): switcher, owner-only Team link, account menu with
 * sign-out (collapsed into a menu at phone width) and the dismissible `access-removed` notice.
 * It enters the workspace of the URL (`useWorkspaceFromUrl`) and shows SCR-10 / a retry row when
 * that fails, and renders the page body only once that entry is `ready` (a skeleton before, so no
 * workspace data outlives a refusal). It also wires the shared guard handler and hands it to the screens inside via `useShellGuard`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const guard = useGuard();
  const { workspaceId = '' } = useParams();
  const entry = useWorkspaceFromUrl(workspaceId, guard);
  const { markError } = entry;
  // A page call whose access-removed resolution fails leaves nothing entered: show Retry, not a skeleton.
  const shellGuard = useCallback<GuardFn>(
    async (error, id) => {
      try {
        return await guard(error, id);
      } catch (cause) {
        if (!useWorkspaceStore.getState().current) markError();
        throw cause;
      }
    },
    [guard, markError],
  );
  const current = useWorkspaceStore((s) => s.current);
  const notice = useWorkspaceStore((s) => s.accessRemovedNotice);
  const account = useAuthStore((s) => s.account);
  const { busy, signOut } = useSignOut();
  const isOwner = current?.role === 'owner';
  const teamHref = current ? `/w/${current.id}/team` : null;

  useEffect(() => {
    if (useAuthStore.getState().account) return;
    getMe()
      .then((me) => useAuthStore.getState().setAccount(me.account))
      .catch(() => undefined); // a dead session is reported by the screen's own workspace call
  }, []);

  return (
    <ShellGuardContext.Provider value={shellGuard}>
      <div className="min-h-svh">
        <header className="flex items-center gap-2 border-b px-4 py-2">
          <WorkspaceSwitcher />
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {isOwner && teamHref && (
              <Button asChild variant="ghost">
                <Link to={teamHref}>Team</Link>
              </Button>
            )}
          </nav>
          <div className="flex-1 sm:hidden" />
          <div className="hidden sm:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-1">
                  <UserRound />
                  {account?.email ?? 'Account'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Menu">
                  <Menu />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {account && <DropdownMenuLabel>{account.email}</DropdownMenuLabel>}
                {isOwner && teamHref && (
                  <DropdownMenuItem asChild>
                    <Link to={teamHref}>Team</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {notice && (
          <div className="px-4 pt-3">
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                Your access to {notice} was removed
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss"
                  onClick={() => useWorkspaceStore.getState().setAccessRemovedNotice(null)}
                >
                  <X />
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        {entry.status === 'not-found' ? (
          <main className="p-4">
            <NotFoundCard headingLevel={1} />
          </main>
        ) : entry.status === 'error' ? (
          <main className="p-4">
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                Something went wrong
                <Button size="sm" variant="outline" onClick={entry.retry}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </main>
        ) : entry.status === 'entering' ? (
          <main className="space-y-3 p-4" data-testid="shell-body-skeleton">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full" />
          </main>
        ) : (
          <main className="p-4">{children}</main>
        )}
      </div>
    </ShellGuardContext.Provider>
  );
}
