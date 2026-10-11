import { useState } from 'react';
import { useNavigate } from 'react-router';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { ApiError } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/** SCR-10. Deliberately shows no workspace name or id, and no hint that anything exists. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function onGo() {
    setBusy(true);
    try {
      await resolveWorkspace((to) => void navigate(to));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void navigate('/sign-in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>Page not found</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button className="w-full" disabled={busy} onClick={() => void onGo()}>
            Go to my workspace
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
