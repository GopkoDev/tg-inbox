import { BotTokenPaste, ErrorCode, type BotIdentity } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/api/client';
import { firstIssue } from '@/shared/lib/validate';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
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
import { botRefusal, pasteBotToken } from '../api';
import { useBotStore } from '../store';

/** The pasted token, the bot it names and the server message, handed to SCR-04 in memory only. */
export interface TakeoverHandoff {
  token: string;
  bot: BotIdentity;
  message: string;
}

const EMPTY_TOKEN = 'Paste the token from BotFather';
const UNEXPECTED = 'Something went wrong — try again';
const HINT =
  'Open @BotFather in Telegram → /mybots → your bot → API Token, copy it and paste it here';

/** Refusals after which the pasted text is useless: the field is cleared. */
const CLEARS_FIELD: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.BOT_TOKEN_INVALID,
  ErrorCode.BOT_BELONGS_TO_ANOTHER_WORKSPACE,
  ErrorCode.WORKSPACE_KEEPS_ONE_BOT,
]);

interface BodyProps {
  workspaceId: string;
  mode: 'connect' | 'new';
  notice: string | null;
  /** Tells the dialog a paste is in flight, so closing is ignored meanwhile. */
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onTakeover: (handoff: TakeoverHandoff) => void;
}

/**
 * The token lives only in this body's local state (screens.md §Token secrecy): it unmounts on
 * close, so success, cancel and close all drop it. It is never written to the store.
 */
function PasteTokenBody({ workspaceId, mode, notice, onBusy, onClose, onTakeover }: BodyProps) {
  const guard = useShellGuard();
  const { replace, markRefused } = useBotStore.getState();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNonce > 0) input.current?.focus();
  }, [focusNonce]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAlert(null);
    const error = token.trim() === '' ? EMPTY_TOKEN : firstIssue(BotTokenPaste.shape.token, token);
    setFieldError(error);
    if (error) return;
    onBusy(true);
    setSubmitting(true);
    try {
      replace(workspaceId, await pasteBotToken(workspaceId, { token, confirm_takeover: false }));
      onBusy(false);
      onClose();
      return;
    } catch (failure) {
      onBusy(false);
      await handleError(failure);
    }
    setSubmitting(false);
  };

  const handleError = async (failure: unknown) => {
    const refusal = botRefusal(failure);
    if (refusal?.code === ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED && refusal.bot) {
      onTakeover({ token, bot: refusal.bot, message: refusal.message });
      return onClose();
    }
    if (refusal?.code === ErrorCode.VALIDATION_ERROR && (failure as ApiError).status === 400) {
      return setFieldError(refusal.message);
    }
    if (refusal && CLEARS_FIELD.has(refusal.code)) {
      setToken('');
      setAlert(refusal.message);
      if (refusal.code === ErrorCode.BOT_TOKEN_INVALID) setFocusNonce((n) => n + 1);
      return;
    }
    if (refusal?.code === ErrorCode.TELEGRAM_UNAVAILABLE) return setAlert(refusal.message);
    if (refusal?.code === ErrorCode.OWNER_ONLY) {
      markRefused(workspaceId, 'owners_only');
      return onClose();
    }
    try {
      const outcome = await guard(failure, workspaceId);
      if (outcome === 'not-found') markRefused(workspaceId, 'not_found');
      onClose();
    } catch {
      setAlert(UNEXPECTED);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{mode === 'connect' ? 'Connect bot' : 'New token'}</DialogTitle>
        <DialogDescription>{HINT}</DialogDescription>
      </DialogHeader>
      {notice && !alert && (
        <Alert variant="destructive">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {alert && (
        <Alert variant="destructive">
          <AlertDescription>{alert}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="bot-token">Bot token</Label>
        <Input
          ref={input}
          id="bot-token"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={token}
          disabled={submitting}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'bot-token-error' : undefined}
          onChange={(e) => setToken(e.target.value)}
        />
        {fieldError && (
          <p id="bot-token-error" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" data-testid="paste-spinner" />}
          {mode === 'connect' ? 'Connect' : 'Save token'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * SCR-03 Paste token. `mode` picks the wording (from not connected, or a replacement token);
 * `notice` is a server message shown above the field (reconnect → needs a new token). Closing is
 * ignored while a paste is in flight.
 */
export function PasteTokenDialog({
  workspaceId,
  open,
  mode,
  notice,
  onClose,
  onTakeover,
}: {
  workspaceId: string;
  open: boolean;
  mode: 'connect' | 'new';
  notice: string | null;
  onClose: () => void;
  onTakeover: (handoff: TakeoverHandoff) => void;
}) {
  const busy = useRef(false);
  const onBusy = useCallback((value: boolean) => {
    busy.current = value;
  }, []);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy.current && onClose()}>
      {open && (
        <DialogContent>
          <PasteTokenBody
            workspaceId={workspaceId}
            mode={mode}
            notice={notice}
            onBusy={onBusy}
            onClose={onClose}
            onTakeover={onTakeover}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
