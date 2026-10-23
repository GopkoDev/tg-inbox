import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { InboxList } from '@/features/inbox/InboxList';
import { parseLens, withLens } from '@/features/inbox/lens';
import { useInboxStore } from '@/features/inbox/store';
import { useGuard } from '@/features/workspaces/guard';

/**
 * SCR-01/SCR-02 host. Joins the workspace's live inbox (one socket per tab, closed on leaving)
 * and draws the list on top of the store. The status and assignee lenses are the page's search
 * parameters: the address is the source, the store follows it, and an unknown value is rewritten
 * in place to the default. A workspace switch navigates without them, so it starts at open · all.
 */
export function InboxPage() {
  const { workspaceId } = useParams();
  const guard = useGuard();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseLens(searchParams), [searchParams]);
  const { status, assignee } = parsed.lens;
  const guardError = useInboxStore((s) => s.guardError);
  // A 401/403 from any inbox call ends the session or shows the access-removed notice (AC-09).
  useEffect(() => {
    if (guardError) void guard(guardError, workspaceId).catch(() => undefined);
  }, [guardError, guard, workspaceId]);
  useEffect(() => {
    if (!parsed.canonical) setSearchParams(withLens(searchParams, parsed.lens), { replace: true });
  }, [parsed, searchParams, setSearchParams]);
  useEffect(() => {
    if (!workspaceId) return;
    void useInboxStore.getState().enter(workspaceId, { status, assignee });
    return () => useInboxStore.getState().leave();
    // the lenses reach a joined inbox through setLens below, not by rejoining
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  useEffect(() => {
    if (workspaceId) void useInboxStore.getState().setLens(workspaceId, { status, assignee });
  }, [workspaceId, status, assignee]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <InboxList key={workspaceId} />
    </div>
  );
}
