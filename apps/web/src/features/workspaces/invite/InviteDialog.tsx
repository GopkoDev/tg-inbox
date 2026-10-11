import type { IssuedInvitation } from '@tg/shared';
import { ErrorCode } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/api/client';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { createInvitation } from '../api';

type Role = 'owner' | 'operator';
export type InviteFailure = 'owner-only' | 'not-found';

const ALREADY_MEMBER =
  'This person is already a member — reactivate them instead if they are deactivated';
const ROLE_LABEL: Record<Role, string> = { operator: 'Operator', owner: 'Business owner' };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

interface BodyProps {
  workspaceId: string;
  onCreated: () => void;
  onDone: () => void;
  onFail: (failure: InviteFailure) => void;
}

/** Holds the form and — only in local state, never a store — the one-time link. Unmounts on close. */
function InviteBody({ workspaceId, onCreated, onDone, onFail }: BodyProps) {
  const guard = useShellGuard();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFieldError(null);
    setAlert(null);
    try {
      setIssued(await createInvitation(workspaceId, { email, role }));
      onCreated();
    } catch (error) {
      await handleError(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleError = async (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 400 && error.code === ErrorCode.VALIDATION_ERROR) {
        return setFieldError(error.message);
      }
      if (error.status === 409 && error.code === ErrorCode.ALREADY_A_MEMBER) {
        return setAlert(ALREADY_MEMBER);
      }
      if (error.status === 403 && error.code === ErrorCode.OWNER_ONLY) return onFail('owner-only');
    }
    try {
      if ((await guard(error, workspaceId)) === 'not-found') onFail('not-found');
    } catch {
      setAlert('Something went wrong');
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
    } catch {
      return; // the link stays selectable in the read-only field
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  if (issued) {
    const { invitation, link } = issued;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitation created</DialogTitle>
          <DialogDescription>
            Invitation created for {invitation.email} ({ROLE_LABEL[invitation.role]}), valid until{' '}
            {formatDate(invitation.expires_at)}. Any earlier pending invitation for this email was
            replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Invitation link"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Alert>
            <AlertDescription>You won&apos;t see this link again — copy it now</AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button onClick={() => onDone()}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>Invite member</DialogTitle>
        <DialogDescription>
          Create an invitation link for a new operator or business owner.
        </DialogDescription>
      </DialogHeader>
      {alert && (
        <Alert variant="destructive">
          <AlertDescription>{alert}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          disabled={submitting}
          aria-invalid={fieldError ? true : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
      </div>
      <RadioGroup
        value={role}
        onValueChange={(v) => setRole(v as Role)}
        disabled={submitting}
        aria-label="Role"
      >
        {(['operator', 'owner'] as const).map((r) => (
          <div key={r} className="flex items-center gap-2">
            <RadioGroupItem id={`invite-role-${r}`} value={r} />
            <Label htmlFor={`invite-role-${r}`}>{ROLE_LABEL[r]}</Label>
          </div>
        ))}
      </RadioGroup>
      <DialogFooter>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Create invitation
        </Button>
      </DialogFooter>
    </form>
  );
}

/** SCR-08. `onClose(created)` fires on Done / ✕ / Esc; `created` tells the screen to refetch. */
export function InviteDialog({
  workspaceId,
  open,
  onClose,
  onFail,
}: {
  workspaceId: string;
  open: boolean;
  onClose: (created: boolean) => void;
  onFail: (failure: InviteFailure) => void;
}) {
  const createdRef = useRef(false);
  const finish = () => {
    const created = createdRef.current;
    createdRef.current = false;
    onClose(created);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      {open && (
        <DialogContent>
          <InviteBody
            workspaceId={workspaceId}
            onCreated={() => (createdRef.current = true)}
            onDone={finish}
            onFail={(f) => {
              createdRef.current = false;
              onFail(f);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
