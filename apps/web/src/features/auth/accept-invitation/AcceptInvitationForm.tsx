import { ErrorCode, LinkToken, PASSWORD_MESSAGE, type InvitationPreview } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { acceptInvitation, lookUpInvitation } from '@/features/auth/api';
import {
  LinkUnavailable,
  type LinkUnavailableProps,
} from '@/features/auth/link-unavailable/LinkUnavailable';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';

const GENERIC = 'Something went wrong';
const NAME_MESSAGE = 'Enter your name (up to 200 characters)';

type Fatal = LinkUnavailableProps | null;

/** 404 / 403 invitation errors turn into SCR-03; anything else is not fatal. */
function toUnavailable(error: unknown): Fatal {
  if (!(error instanceof ApiError)) return null;
  if (error.code === ErrorCode.INVITATION_FOR_ANOTHER_EMAIL) {
    return { reason: 'invitation-for-another-email' };
  }
  if (error.code === ErrorCode.INVITATION_INVALID) {
    const ask = (error.details as { ask?: string } | undefined)?.ask;
    return {
      reason: 'invitation-invalid',
      ask: ask === 'tg_inbox_team' ? 'tg_inbox_team' : 'business_owner',
    };
  }
  return null;
}

export function AcceptInvitationForm() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const malformed = !LinkToken.safeParse(token).success;
  const [unavailable, setUnavailable] = useState<Fatal>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (malformed) return;
    let live = true;
    lookUpInvitation(token)
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch((error: unknown) => {
        if (!live) return;
        // On lookup only the token can fail validation: a damaged link is as dead as an expired one.
        const fatal: Fatal =
          error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR
            ? { reason: 'invitation-invalid', ask: 'business_owner' }
            : toUnavailable(error);
        if (fatal) setUnavailable(fatal);
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

  if (malformed) return <LinkUnavailable reason="invitation-invalid" ask="business_owner" />;
  if (unavailable) return <LinkUnavailable {...unavailable} />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    const newAccount = !preview.account_exists;
    const trimmed = name.trim();
    const nextNameError = newAccount && (trimmed.length < 1 || trimmed.length > 200);
    const nextPasswordError = newAccount && password.length < 10;
    setNameError(nextNameError ? NAME_MESSAGE : null);
    setPasswordError(nextPasswordError ? PASSWORD_MESSAGE : null);
    setAlert(null);
    if (nextNameError || nextPasswordError) return;

    setSubmitting(true);
    try {
      const workspace = await acceptInvitation({
        token,
        password,
        ...(newAccount ? { display_name: trimmed } : {}),
      });
      void navigate(`/w/${workspace.id}`);
      return;
    } catch (error) {
      const fatal = toUnavailable(error);
      if (fatal) {
        setUnavailable(fatal);
      } else if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR) {
        const field = (error.details as { field?: string } | undefined)?.field;
        if (field === 'display_name') setNameError(error.message);
        else setPasswordError(error.message);
      } else if (error instanceof ApiError && error.code === ErrorCode.INVALID_CREDENTIALS) {
        setPassword('');
        setAlert(error.message);
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
          <h1>{preview ? `Join ${preview.workspace_name}` : 'Accept invitation'}</h1>
        </CardTitle>
        <CardDescription>
          {preview ? (
            <>
              You are invited as <Badge variant="secondary">{preview.role}</Badge>
            </>
          ) : (
            'Checking your invitation…'
          )}
        </CardDescription>
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
        ) : !preview ? (
          <div data-testid="invitation-loading" className="space-y-4">
            <Skeleton className="h-9 w-full" />
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
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" readOnly value={preview.email} />
            </div>
            {!preview.account_exists && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  disabled={submitting}
                  value={name}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'name-error' : undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                {nameError && (
                  <p id="name-error" className="text-destructive text-sm">
                    {nameError}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={preview.account_exists ? 'current-password' : 'new-password'}
                disabled={submitting}
                value={password}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'password-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              {!preview.account_exists && !passwordError && (
                <p className="text-muted-foreground text-sm">At least 10 characters</p>
              )}
              {preview.account_exists && (
                <p className="text-muted-foreground text-sm">
                  You already have an account — enter its password.
                </p>
              )}
              {passwordError && (
                <p id="password-error" className="text-destructive text-sm">
                  {passwordError}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {preview.account_exists ? 'Join workspace' : 'Create account and join'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
