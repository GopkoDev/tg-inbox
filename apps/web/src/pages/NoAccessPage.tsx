import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getMe, signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

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
    <main className="flex min-h-svh items-center justify-center px-4 py-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>You no longer have access to any workspace</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice && (
            <Alert>
              <AlertDescription>Your access to {notice} was removed</AlertDescription>
            </Alert>
          )}
          {account && <p className="text-muted-foreground text-sm">Signed in as {account.email}</p>}
          <Button className="w-full" disabled={busy} onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
