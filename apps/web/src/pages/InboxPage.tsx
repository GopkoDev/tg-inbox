import { useEffect } from 'react';
import { useParams } from 'react-router';
import { InboxList } from '@/features/inbox/InboxList';
import { useInboxStore } from '@/features/inbox/store';
import { useGuard } from '@/features/workspaces/guard';

/**
 * SCR-01/SCR-02 host. Joins the workspace's live inbox (one socket per tab, closed on leaving)
 * and draws the list on top of the store; the thread pane is T25's.
 */
export function InboxPage() {
  const { workspaceId } = useParams();
  const guard = useGuard();
  const guardError = useInboxStore((s) => s.guardError);
  // A 401/403 from any inbox call ends the session or shows the access-removed notice (AC-09).
  useEffect(() => {
    if (guardError) void guard(guardError, workspaceId).catch(() => undefined);
  }, [guardError, guard, workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    void useInboxStore.getState().enter(workspaceId);
    return () => useInboxStore.getState().leave();
  }, [workspaceId]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <InboxList key={workspaceId} />
    </div>
  );
}
