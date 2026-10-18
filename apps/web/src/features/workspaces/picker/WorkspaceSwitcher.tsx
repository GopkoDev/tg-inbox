import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ROLE_LABEL } from '@/shared/lib/roles';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Skeleton } from '@/shared/ui/skeleton';
import { useEnterWorkspace } from './useEnterWorkspace';
import { useWorkspaceList } from './useWorkspaceList';

/** SCR-04 switcher variant: the workspace list as a menu in the workspace header. */
export function WorkspaceSwitcher() {
  const current = useWorkspaceStore((s) => s.current);
  const [open, setOpen] = useState(false);
  const list = useWorkspaceList(open);
  const { enteringId, error, enter } = useEnterWorkspace(() => void list.reload());

  if (!current) return <Skeleton className="h-12 w-full" data-testid="shell-name-skeleton" />;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-12 w-full justify-start gap-2 px-2 font-semibold">
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate">{current.name}</span>
            <span aria-hidden className="text-muted-foreground truncate text-xs font-normal">
              {ROLE_LABEL[current.role]}
            </span>
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {error === 'refused' && (
          <p role="status" className="text-destructive px-2 py-1.5 text-sm">
            That workspace is no longer available
          </p>
        )}
        {error === 'unexpected' && (
          <p role="status" className="text-destructive px-2 py-1.5 text-sm">
            Something went wrong
          </p>
        )}
        {list.status === 'loading' && list.items.length === 0 && (
          <Skeleton className="m-2 h-6 w-48" />
        )}
        {list.status === 'error' && (
          <DropdownMenuItem onSelect={(e) => (e.preventDefault(), void list.reload())}>
            Something went wrong. Retry
          </DropdownMenuItem>
        )}
        {list.items.map((w) => (
          <DropdownMenuItem
            key={w.id}
            aria-current={w.id === current.id ? 'true' : undefined}
            disabled={enteringId !== null && enteringId !== w.id}
            onSelect={(e) => {
              e.preventDefault();
              if (w.id === current.id) return setOpen(false);
              void enter(w.id).then((ok) => ok && setOpen(false));
            }}
          >
            {enteringId === w.id ? (
              <Loader2 className="animate-spin" />
            ) : w.id === current.id ? (
              <Check />
            ) : (
              <span className="size-4" />
            )}
            <span className="flex-1 truncate">{w.name}</span>
            <Badge variant="secondary">{ROLE_LABEL[w.role]}</Badge>
          </DropdownMenuItem>
        ))}
        {list.hasMore && (
          <DropdownMenuItem
            disabled={list.loadingMore}
            onSelect={(e) => (e.preventDefault(), void list.more())}
          >
            Show more
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
