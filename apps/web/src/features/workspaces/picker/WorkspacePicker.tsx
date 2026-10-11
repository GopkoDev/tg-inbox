import { Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { ROLE_LABEL } from '@/shared/lib/roles';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { useEnterWorkspace } from './useEnterWorkspace';
import { useWorkspaceList } from './useWorkspaceList';

/** SCR-04 page variant: one row per workspace; picking one enters it. */
export function WorkspacePicker() {
  const notice = useWorkspaceStore((s) => s.accessRemovedNotice);
  const list = useWorkspaceList();
  const { enteringId, error, enter } = useEnterWorkspace(() => void list.reload());
  const entering = enteringId !== null;

  return (
    <div className="space-y-3">
      {notice && (
        <Alert>
          <AlertDescription>Your access to {notice} was removed</AlertDescription>
        </Alert>
      )}
      {error === 'refused' && (
        <Alert variant="destructive">
          <AlertDescription>That workspace is no longer available</AlertDescription>
        </Alert>
      )}
      {error === 'unexpected' && (
        <Alert variant="destructive">
          <AlertDescription>Something went wrong</AlertDescription>
        </Alert>
      )}
      {list.status === 'loading' && (
        <div className="space-y-2" data-testid="picker-skeleton">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {list.status === 'error' && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Something went wrong
            <Button size="sm" variant="outline" onClick={() => void list.reload()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {list.status === 'ready' && (
        <ul className="space-y-1">
          {list.items.map((w) => (
            <li key={w.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between py-2"
                disabled={entering}
                onClick={() => void enter(w.id)}
              >
                <span className="truncate">{w.name}</span>
                {enteringId === w.id ? (
                  <Loader2 className="animate-spin" data-testid="entering-spinner" />
                ) : (
                  <Badge variant="secondary">{ROLE_LABEL[w.role]}</Badge>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.status === 'ready' && list.hasMore && (
        <Button
          variant="outline"
          className="w-full"
          disabled={list.loadingMore}
          onClick={() => void list.more()}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
