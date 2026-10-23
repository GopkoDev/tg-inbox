import type { TagHistoryEntry } from '@tg/shared';
import { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { formatHistoryTime } from './format';
import { useContactsStore } from './store';

/** One line composed from the kind, the names the tag had then, the actor and the time (names are plain text). */
export function historyLine(e: TagHistoryEntry): string {
  const actor = e.actor.display_name;
  const time = formatHistoryTime(e.created_at);
  switch (e.kind) {
    case 'added':
      return `${actor} added «${e.tag_name}» · ${e.source} · ${time}`;
    case 'removed':
      return `${actor} removed «${e.tag_name}» · ${e.source} · ${time}`;
    case 'merged':
      return `${actor} merged «${e.tag_name}» into «${e.merged_into_name ?? ''}» · ${time}`;
    case 'deleted':
      return `«${e.tag_name}» removed by ${actor}'s delete · ${time}`;
  }
}

function LineSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} data-testid="history-skeleton" className="px-4 py-3">
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </>
  );
}

/** SCR-19's Tag history tab: the contact's entries newest first, older ones by `after` on scrolling. */
export function TagHistoryList({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const history = useContactsStore((s) => s.history);
  const sentinel = useRef<HTMLLIElement>(null);
  const watching = history?.status === 'ready' && history.hasNext && history.more === 'idle';
  const more = () => void useContactsStore.getState().loadMoreHistory(workspaceId, guard);
  const moreRef = useRef(more);
  useEffect(() => {
    moreRef.current = more;
  });
  const count = history?.items.length ?? 0;
  useEffect(() => {
    const el = sentinel.current;
    if (!watching || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) moreRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [watching, count]);

  if (!history || history.status === 'loading')
    return (
      <Card className="py-0">
        <ul>
          <LineSkeletons count={5} />
        </ul>
      </Card>
    );
  if (history.status === 'error')
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load the tag history
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useContactsStore.getState().retryHistory(workspaceId, guard)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (history.items.length === 0)
    return (
      <Card className="py-0">
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tag changes yet</p>
      </Card>
    );
  return (
    <div className="flex flex-col gap-3">
      <Card className="py-0">
        <ul>
          {history.items.map((e) => (
            <li key={e.id} className="border-t px-4 py-3 text-sm first:border-t-0">
              {historyLine(e)}
            </li>
          ))}
          {history.more === 'loading' ? <LineSkeletons count={1} /> : null}
          {watching ? <li ref={sentinel} aria-hidden className="h-px" /> : null}
        </ul>
      </Card>
      {history.more === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Couldn&apos;t load more tag changes
            <Button type="button" size="sm" variant="outline" onClick={more}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
