import { ErrorCode, LinkToken, PASSWORD_MESSAGE } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { lookUpPasswordResetLink, redeemPasswordResetLink } from '@/features/auth/api';
import { LinkUnavailable } from '@/features/auth/link-unavailable/LinkUnavailable';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';

const GENERIC = 'Something went wrong';

const isInvalid = (error: unknown) =>
  error instanceof ApiError && error.code === ErrorCode.RESET_LINK_INVALID;

// On lookup only the token can fail validation: a damaged link is as dead as an expired one.
const isUnusableOnLookup = (error: unknown) =>
  isInvalid(error) || (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR);

export function ResetPasswordForm() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const malformed = !LinkToken.safeParse(token).success;

  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (malformed) return;
    let live = true;
    lookUpPasswordResetLink(token)
      .then(() => {
        if (live) setReady(true);
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (isUnusableOnLookup(error)) setUnavailable(true);
        else setLookupFailed(true);
      });
    return () => {
      live = false;
    };
  }, [token, attempt, malformed]);

  function retryLookup() {
    setLookupFailed(false);
    setAttempt((n) => n + 1);
  }

  if (malformed || unavailable) return <LinkUnavailable reason="reset-link-invalid" />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAlert(null);
    if (password.length < 10) {
      setPasswordError(PASSWORD_MESSAGE);
      return;
    }
    setPasswordError(null);
    setSubmitting(true);
    try {
      await redeemPasswordResetLink({ token, password });
      await resolveWorkspace((to) => void navigate(to));
      return;
    } catch (error) {
      if (isInvalid(error)) {
        setUnavailable(true);
        return;
      }
      if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR) {
        setPasswordError(error.message);
      } else {
        setAlert(GENERIC);
      }
    }
    setSubmitting(false);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1>Set a new password</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lookupFailed ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>{GENERIC}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={retryLookup}>
              Retry
            </Button>
          </div>
        ) : !ready ? (
          <div data-testid="reset-loading" className="space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
            {alert && (
              <Alert variant="destructive">
                <AlertDescription>{alert}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                disabled={submitting}
                value={password}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'password-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              {!passwordError && (
                <p className="text-muted-foreground text-sm">At least 10 characters</p>
              )}
              {passwordError && (
                <p id="password-error" className="text-destructive text-sm">
                  {passwordError}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              Set password
            </Button>
            <p className="text-muted-foreground text-sm">Every other device will be signed out.</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
