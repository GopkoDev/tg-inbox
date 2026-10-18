import { useSignOut } from '@/features/auth/useSignOut';
import { useAuthStore } from '@/features/auth/store';
import { WorkspacePicker } from '@/features/workspaces/picker/WorkspacePicker';
import { Button } from '@/shared/ui/button';
import { AuthLayout } from '@/shared/ui/auth-layout';

/** SCR-04: choose a workspace (several memberships and no usable last-used one). */
export function WorkspacesPage() {
  const account = useAuthStore((s) => s.account);
  const { busy, signOut } = useSignOut();
  return (
    <AuthLayout title="Your workspaces" className="max-w-md">
      <div className="flex flex-col gap-4">
        <WorkspacePicker />
        {account && <p className="text-muted-foreground text-sm">Signed in as {account.email}</p>}
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
