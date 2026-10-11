import { useState } from 'react';
import { useNavigate } from 'react-router';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { ApiError } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/** SCR-10 body, rendered in place inside the shell (no landmark, `h2` under the page's `h1`). */
export function NotFoundCard({ headingLevel = 2 }: { headingLevel?: 1 | 2 }) {
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {headingLevel === 1 ? <h1>Page not found</h1> : <h2>Page not found</h2>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button className="w-full" disabled={busy} onClick={() => void onGo()}>
          Go to my workspace
        </Button>
      </CardContent>
    </Card>
  );
}

/** SCR-10 as a whole page (the `*` route, or the shell when the workspace is unknown). */
export function NotFoundPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-6">
      <NotFoundCard headingLevel={1} />
    </main>
  );
}
