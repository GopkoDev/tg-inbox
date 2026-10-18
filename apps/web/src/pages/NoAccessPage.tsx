import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getMe, signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { AuthLayout } from '@/shared/ui/auth-layout';

export function NoAccessPage() {
  const navigate = useNavigate();
  const account = useAuthStore((s) => s.account);
  const notice = useWorkspaceStore((s) => s.accessRemovedNotice);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) return;
    getMe()
      .then((me) => useAuthStore.getState().setAccount(me.account))
      .catch(() => void navigate('/sign-in'));
  }, [account, navigate]);

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      void navigate('/sign-in');
      useAuthStore.getState().clear();
      useWorkspaceStore.getState().clear();
    }
  }

  return (
    <AuthLayout title="You no longer have access to any workspace" className="max-w-md">
      <div className="flex flex-col gap-4">
        {notice && (
          <Alert>
            <AlertDescription>Your access to {notice.name} was removed</AlertDescription>
          </Alert>
        )}
        {account && <p className="text-muted-foreground text-sm">Signed in as {account.email}</p>}
        <Button className="w-full" disabled={busy} onClick={() => void onSignOut()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
