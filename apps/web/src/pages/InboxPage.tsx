import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useInboxStore } from '@/features/inbox/store';

/**
 * SCR-01/SCR-02 host. This foundation step only joins the workspace's live inbox (one socket
 * per tab, closed on leaving); the list and the thread are drawn on top of the store by T24/T25.
 */
export function InboxPage() {
  const { workspaceId } = useParams();
  useEffect(() => {
    if (!workspaceId) return;
    void useInboxStore.getState().enter(workspaceId);
    return () => useInboxStore.getState().leave();
  }, [workspaceId]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Inbox</h1>
    </div>
  );
}
