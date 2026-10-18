import { Link2Off, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getMe, signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Button, buttonVariants } from '@/shared/ui/button';
import { AuthLayout } from '@/shared/ui/auth-layout';

export type LinkUnavailableProps =
  | { reason: 'invitation-invalid'; ask: 'business_owner' | 'tg_inbox_team'; reload?: () => void }
  | { reason: 'invitation-for-another-email'; reload?: () => void }
  | { reason: 'reset-link-invalid'; reload?: () => void };

const defaultReload = () => window.location.reload();

export function LinkUnavailable(props: LinkUnavailableProps) {
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getMe()
      .then(() => {
        if (live) setHasSession(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      useAuthStore.getState().clear();
      useWorkspaceStore.getState().clear();
      (props.reload ?? defaultReload)();
    }
  }

  const anotherEmail = props.reason === 'invitation-for-another-email';
  const who =
    props.reason === 'invitation-invalid' && props.ask === 'tg_inbox_team'
      ? 'the tg-inbox team'
      : 'a business owner';

  return (
    <AuthLayout
      className="max-w-md"
      title={anotherEmail ? 'This invitation is for another email' : "This link can't be used"}
    >
      <div className="flex flex-col gap-4">
        <Link2Off className="text-muted-foreground mx-auto size-6" aria-hidden="true" />
        <p className="text-center">
          {anotherEmail
            ? 'This invitation belongs to another email — sign out and open the link again'
            : props.reason === 'reset-link-invalid'
              ? 'This reset link is no longer valid — ask the tg-inbox team for a new one'
              : `This invitation is no longer valid — ask ${who} for a new one`}
        </p>
        {anotherEmail && (
          <Button className="w-full" disabled={busy} onClick={() => void onSignOut()}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            Sign out
          </Button>
        )}
        {hasSession ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void resolveWorkspace((to) => void navigate(to))}
          >
            Go to my workspace
          </Button>
        ) : (
          <Link
            to="/sign-in"
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            Go to sign-in
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
