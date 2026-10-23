import { Navigate } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';

/** `/settings` opens the Bot section for an owner and Notifications for an operator. */
export function SettingsIndexRedirect() {
  const role = useWorkspaceStore((s) => s.current?.role);
  return <Navigate to={role === 'owner' ? 'bot' : 'notifications'} replace />;
}
