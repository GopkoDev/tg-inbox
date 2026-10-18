import { CurrentPassword, EmailInput, ErrorCode } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getMe, signIn } from '@/features/auth/api';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { ApiError } from '@/shared/api/client';
import { firstIssue } from '@/shared/lib/validate';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { AuthLayout } from '@/shared/ui/auth-layout';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
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
  const [passwordError, setPasswordError] = useState<string | null>(null);
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
    const nextPasswordError = firstIssue(CurrentPassword, password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;
    setSubmitting(true);
    try {
      await signIn({ email, password });
      await resolveWorkspace((to) => void navigate(to));
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR) {
        const field = (error.details as { field?: string } | undefined)?.field;
        if (field === 'password') setPasswordError(error.message);
        else setEmailError(error.message);
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
    <AuthLayout title="Sign in" description="Answer your customers' Telegram messages together">
      {booting ? (
        <div data-testid="sign-in-loading" className="flex flex-col gap-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-6" noValidate>
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
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
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
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting}
              value={password}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? 'password-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {passwordError && (
              <p id="password-error" className="text-destructive text-sm">
                {passwordError}
              </p>
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
            Sign in
          </Button>
          <p className="text-muted-foreground text-sm">
            Forgot your password? Ask the tg-inbox team for a reset link.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
