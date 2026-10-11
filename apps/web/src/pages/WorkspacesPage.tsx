import { useSignOut } from '@/features/auth/useSignOut';
import { useAuthStore } from '@/features/auth/store';
import { WorkspacePicker } from '@/features/workspaces/picker/WorkspacePicker';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/** SCR-04: choose a workspace (several memberships and no usable last-used one). */
export function WorkspacesPage() {
  const account = useAuthStore((s) => s.account);
  const { busy, signOut } = useSignOut();
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>Your workspaces</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <WorkspacePicker />
          {account && <p className="text-muted-foreground text-sm">Signed in as {account.email}</p>}
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
