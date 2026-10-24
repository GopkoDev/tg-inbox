import { ErrorCode, type LaunchedBroadcast } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { duplicateBroadcast } from './api';
import { audienceText } from './audience-text';
import { contactsText, formatCount } from './AudienceBreakdown';

type Choice = 'same_tags' | 'all_recipients' | 'not_reached';

const NOT_ENDED = 'It is still sending — choose another option or wait until it ends.';

/**
 * SCR-30 (AC-13): who a copy of a launched broadcast goes to — the same tags (a tag audience
 * only, counted again at launch), all its recipients, or only the recipients it did not reach
 * (once it has ended; recipients whose send was not confirmed only on request). The copy opens in
 * its editor. Any member, either role.
 */
export function DuplicateBroadcastDialog({
  workspaceId,
  broadcast,
  onClose,
}: {
  workspaceId: string;
  /** The broadcast to copy; null = closed. */
  broadcast: LaunchedBroadcast | null;
  onClose: () => void;
}) {
  const guard = useShellGuard();
  const navigate = useNavigate();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>('all_recipients');
  const [includeNotConfirmed, setIncludeNotConfirmed] = useState(false);
  const [notEnded, setNotEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const defaultChoice = (b: LaunchedBroadcast): Choice =>
    b.audience.kind === 'tags' ? 'same_tags' : 'all_recipients';

  // A newly opened broadcast starts clean (state adjusted while rendering).
  if (broadcast && shownFor !== broadcast.id) {
    setShownFor(broadcast.id);
    setChoice(defaultChoice(broadcast));
    setIncludeNotConfirmed(false);
    setNotEnded(false);
    setFailed(false);
  }

  const close = () => {
    setShownFor(null);
    onClose();
  };

  const notReachedOff = broadcast?.status === 'sending' || notEnded;
  const notConfirmed = broadcast?.totals.not_confirmed ?? 0;

  const create = async () => {
    if (!broadcast) return;
    setPending(true);
    setFailed(false);
    try {
      const copy = await duplicateBroadcast(workspaceId, broadcast.id, {
        audience: choice,
        include_not_confirmed: choice === 'not_reached' && includeNotConfirmed,
      });
      close();
      void navigate(`/w/${workspaceId}/broadcasts/${copy.id}`);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.BROADCAST_NOT_ENDED) {
        setNotEnded(true);
        setChoice(defaultChoice(broadcast));
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        close();
        void guard(error, workspaceId);
      } else setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={broadcast !== null}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">{`Duplicate “${broadcast?.name ?? ''}”`}</DialogTitle>
          <DialogDescription>
            The copy is a new draft; this broadcast stays as it is.
          </DialogDescription>
        </DialogHeader>
        {broadcast ? (
          <RadioGroup
            aria-label="Who should the copy go to?"
            value={choice}
            onValueChange={(v) => setChoice(v as Choice)}
            className="flex flex-col gap-3"
          >
            <p className="text-sm font-medium">Who should the copy go to?</p>
            {broadcast.audience.kind === 'tags' ? (
              <Option value="same_tags" label="The same tags">
                {`${audienceText(broadcast.audience)} — counted again when you launch`}
              </Option>
            ) : null}
            <Option value="all_recipients" label="All recipients">
              {`${contactsText(broadcast.launch_breakdown.recipient_count)} — those who blocked the bot stay in the group, counted as unreachable`}
            </Option>
            <Option
              value="not_reached"
              label="Only recipients it didn't reach"
              disabled={notReachedOff}
            >
              {notReachedOff
                ? 'Available once the broadcast has ended'
                : `${contactsText(broadcast.not_reached_count)} whose send failed for a reason a new attempt can fix`}
            </Option>
            {choice === 'not_reached' && notConfirmed > 0 ? (
              <div className="ml-6 flex flex-col gap-1">
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={includeNotConfirmed}
                    onCheckedChange={(v) => setIncludeNotConfirmed(v === true)}
                  />
                  {`Also include ${formatCount(notConfirmed)} ${notConfirmed === 1 ? 'recipient' : 'recipients'} whose send was not confirmed`}
                </Label>
                <p className="text-sm text-muted-foreground">They may already have received it.</p>
              </div>
            ) : null}
          </RadioGroup>
        ) : null}
        {notEnded ? (
          <Alert>
            <AlertDescription>{NOT_ENDED}</AlertDescription>
          </Alert>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t create the copy</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={() => void create()}>
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  value,
  label,
  disabled,
  children,
}: {
  value: Choice;
  label: string;
  disabled?: boolean;
  children: string;
}) {
  const inputId = `duplicate-${value}`;
  return (
    <div className="flex items-start gap-2" aria-disabled={disabled || undefined}>
      <RadioGroupItem id={inputId} value={value} disabled={disabled} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={inputId} className="aria-disabled:opacity-50" aria-disabled={disabled}>
          {label}
        </Label>
        <span className="text-sm text-muted-foreground">{children}</span>
      </div>
    </div>
  );
}
