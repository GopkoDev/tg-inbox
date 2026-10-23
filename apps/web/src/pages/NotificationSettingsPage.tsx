import { useParams } from 'react-router';
import { DesktopNotificationsCard } from '@/features/notifications/DesktopNotificationsCard';
import { TelegramPingsCard } from '@/features/notifications/TelegramPingsCard';
import { useWorkspaceStore } from '@/features/workspaces/store';

/**
 * SCR-16 Settings — Notifications, open to both roles: one card per opt-in, stacked: Desktop
 * notifications (this browser) above Telegram pings (this workspace). Both are keyed by workspace so
 * a switch remounts them.
 */
export function NotificationSettingsPage() {
  const { workspaceId = '' } = useParams();
  const workspaceName = useWorkspaceStore((s) => s.current?.name ?? 'workspace');
  return (
    <div className="max-w-xl space-y-4">
      <DesktopNotificationsCard
        key={`desktop-${workspaceId}`}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
      />
      <TelegramPingsCard
        key={workspaceId}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
      />
    </div>
  );
}
