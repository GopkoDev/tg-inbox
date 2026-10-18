import { ChevronsUpDown, Contact, Inbox, LogOut, Settings, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect } from 'react';
import { NavLink, Outlet, useLocation, useMatches, useParams } from 'react-router';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { getMe } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useSignOut } from '@/features/auth/useSignOut';
import { useGuard, type GuardFn } from '@/features/workspaces/guard';
import { WorkspaceSwitcher } from '@/features/workspaces/picker/WorkspaceSwitcher';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { useWorkspaceFromUrl } from '@/features/workspaces/useWorkspaceFromUrl';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Separator } from '@/shared/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/shared/ui/sidebar';
import { Skeleton } from '@/shared/ui/skeleton';
import { ShellGuardContext } from './app-shell-context';

/** A route's `handle` may carry the breadcrumb label of its section. */
export interface CrumbHandle {
  crumb?: string;
}

const ACTIVE = 'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium';

/** Closes the phone drawer once a section is picked (the location changed). */
function CloseDrawerOnNavigate() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  return null;
}

function initials(source: string) {
  return source.slice(0, 2).toUpperCase();
}

function AccountMenu() {
  const account = useAuthStore((s) => s.account);
  const { busy, signOut } = useSignOut();
  const { isMobile } = useSidebar();
  const label = account?.email ?? 'Account';
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg" aria-hidden>
                <AvatarFallback className="rounded-lg">
                  {initials(account?.display_name || label)}
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-xs">{label}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            {account && (
              <DropdownMenuLabel className="font-normal">{account.email}</DropdownMenuLabel>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ShellBreadcrumb({ workspaceId }: { workspaceId: string }) {
  const name = useWorkspaceStore((s) => s.current?.name);
  const crumbs = useMatches().flatMap((m) => {
    const crumb = (m.handle as CrumbHandle | undefined)?.crumb;
    return crumb ? [{ label: crumb, to: m.pathname }] : [];
  });
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {name && (
          <BreadcrumbItem>
            {crumbs.length === 0 ? (
              <BreadcrumbPage role={undefined} aria-disabled={undefined}>
                {name}
              </BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <NavLink to={`/w/${workspaceId}`}>{name}</NavLink>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        )}
        {crumbs.map((c, i) => (
          <Fragment key={c.to}>
            {(name || i > 0) && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage role={undefined} aria-disabled={undefined}>
                  {c.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <NavLink to={c.to}>{c.label}</NavLink>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The workspace area frame (SCR-07): an inset sidebar (workspace switcher, Inbox / Contacts /
 * owner-only Settings, account menu with sign-out), an inset header (trigger + breadcrumb) and the
 * dismissible `access-removed` notice. It is the layout route of `/w/:workspaceId`: it enters the
 * workspace of the URL (`useWorkspaceFromUrl`) and renders the matched screen (`<Outlet/>`, keyed
 * on the workspace) only once that entry is `ready` — a skeleton before, not-found / a retry row
 * after a failure, so no workspace data outlives a refusal. It also wires the shared guard handler
 * and hands it to the screens inside via `useShellGuard`.
 */
export function AppShell() {
  const guard = useGuard();
  const { workspaceId = '' } = useParams();
  const entry = useWorkspaceFromUrl(workspaceId, guard);
  const { markError } = entry;
  // One address workspace for the shell: sign-out clears it, so a pending call from an
  // unmounted shell sees the address it left.
  useLayoutEffect(() => {
    useWorkspaceStore.getState().setAddressWorkspace(workspaceId);
    return () => useWorkspaceStore.getState().releaseAddressWorkspace(workspaceId);
  }, [workspaceId]);
  // A refusal for a workspace the person has left (or after sign-out) has no effect (no notice,
  // no resolution, no error row). A page call whose access-removed resolution fails leaves
  // nothing entered: show Retry, not a skeleton.
  const shellGuard = useCallback<GuardFn>(
    async (error, id) => {
      if (id !== undefined && id !== useWorkspaceStore.getState().addressWorkspaceId) {
        return 'handled';
      }
      try {
        return await guard(error, id);
      } catch (cause) {
        if (!useWorkspaceStore.getState().current) markError(id ?? workspaceId);
        throw cause;
      }
    },
    [guard, markError, workspaceId],
  );
  const current = useWorkspaceStore((s) => s.current);
  const notice = useWorkspaceStore((s) => s.accessRemovedNotice);
  const isOwner = current?.role === 'owner';
  const base = current ? `/w/${current.id}` : null;

  useEffect(() => {
    if (useAuthStore.getState().account) return;
    getMe()
      .then((me) => useAuthStore.getState().setAccount(me.account))
      .catch(() => undefined); // a dead session is reported by the screen's own workspace call
  }, []);

  const items = base
    ? [
        { to: `${base}/inbox`, label: 'Inbox', icon: Inbox },
        { to: `${base}/contacts`, label: 'Contacts', icon: Contact },
        ...(isOwner ? [{ to: `${base}/settings`, label: 'Settings', icon: Settings }] : []),
      ]
    : [];

  return (
    <ShellGuardContext.Provider value={shellGuard}>
      <SidebarProvider>
        <CloseDrawerOnNavigate />
        <Sidebar variant="inset">
          <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col">
            <SidebarHeader>
              <WorkspaceSwitcher />
            </SidebarHeader>
            <SidebarContent>
              {entry.status === 'ready' && (
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map(({ to, label, icon: Icon }) => (
                        <SidebarMenuItem key={label}>
                          <SidebarMenuButton asChild>
                            <NavLink to={to} className={ACTIVE}>
                              <Icon />
                              <span>{label}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )}
            </SidebarContent>
          </nav>
          <SidebarFooter>
            <AccountMenu />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            {entry.status === 'ready' && <ShellBreadcrumb workspaceId={workspaceId} />}
          </header>
          {notice && (
            <div className="px-4 pb-3">
              <Alert>
                <AlertDescription className="flex items-center justify-between gap-2">
                  Your access to {notice.name} was removed
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
            <div className="p-4 pt-0">
              <NotFoundCard headingLevel={1} />
            </div>
          ) : entry.status === 'error' ? (
            <div className="p-4 pt-0">
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-2">
                  Something went wrong
                  <Button size="sm" variant="outline" onClick={entry.retry}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : entry.status === 'entering' ? (
            <div className="space-y-3 p-4 pt-0" data-testid="shell-body-skeleton">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="min-w-0 flex-1 p-4 pt-0">
              <Outlet key={workspaceId} />
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>
    </ShellGuardContext.Provider>
  );
}
