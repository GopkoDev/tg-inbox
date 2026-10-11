import { EmailInput, ErrorCode } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getMe, signIn } from '@/features/auth/api';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { ApiError } from '@/shared/api/client';
import { firstIssue } from '@/shared/lib/validate';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';

const GENERIC = 'Something went wrong';

export function SignInForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionEnded = (location.state as { reason?: string } | null)?.reason === 'session-ended';

  const [booting, setBooting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMe()
      .then((me) => resolveWorkspace((to) => void navigate(to), me))
      .catch(() => undefined)
      .finally(() => {
        if (live) setBooting(false);
      });
    return () => {
      live = false;
    };
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAlert(null);
    const nextEmailError = firstIssue(EmailInput, email);
    setEmailError(nextEmailError);
    if (nextEmailError) return;
    setSubmitting(true);
    try {
      await signIn({ email, password });
      await resolveWorkspace((to) => void navigate(to));
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR) {
        setEmailError(error.message);
      } else if (error instanceof ApiError && error.code === ErrorCode.INVALID_CREDENTIALS) {
        setPassword('');
        setAlert(error.message);
      } else if (error instanceof ApiError && error.code === ErrorCode.TOO_MANY_ATTEMPTS) {
        setAlert(error.message);
      } else {
        setAlert(GENERIC);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>Sign in to your tg-inbox account.</CardDescription>
      </CardHeader>
      <CardContent>
        {booting ? (
          <div data-testid="sign-in-loading" className="space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {sessionEnded && (
              <Alert>
                <AlertDescription>Sign in to continue</AlertDescription>
              </Alert>
            )}
            {alert && (
              <Alert variant="destructive">
                <AlertDescription>{alert}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="text"
                autoComplete="email"
                required
                disabled={submitting}
                value={email}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'email-error' : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailError && (
                <p id="email-error" className="text-destructive text-sm">
                  {emailError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={submitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              Sign in
            </Button>
            <p className="text-muted-foreground text-sm">
              Forgot your password? Ask the tg-inbox team for a reset link.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
