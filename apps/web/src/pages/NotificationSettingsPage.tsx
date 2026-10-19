import { useParams } from 'react-router';
import { TelegramPingsCard } from '@/features/notifications/TelegramPingsCard';
import { useWorkspaceStore } from '@/features/workspaces/store';

/**
 * SCR-16 Settings — Notifications, open to both roles: one card per opt-in, stacked. The Telegram
 * pings card is this workspace's; keyed by workspace so a switch remounts it.
 */
export function NotificationSettingsPage() {
  const { workspaceId = '' } = useParams();
  const workspaceName = useWorkspaceStore((s) => s.current?.name ?? 'workspace');
  return (
    <div className="max-w-xl space-y-4">
      <TelegramPingsCard
        key={workspaceId}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
      />
    </div>
  );
}
