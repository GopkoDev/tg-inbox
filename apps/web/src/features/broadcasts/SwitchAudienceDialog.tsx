import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '@/features/inbox/StateChangedDialog';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { contactsText } from './AudienceBreakdown';
import { useBroadcastDraftStore } from './draft-store';

/**
 * SCR-32: switching a draft with a non-empty hand-picked group to contacts with tags (AC-03). The
 * switch goes through the draft store with the group size the dialog shows; a group that changed
 * meanwhile (`BROADCAST_GROUP_CHANGED`) is shown with its new size and asked again. A stale or
 * launched draft closes the dialog to the editor's own notice.
 */
export function SwitchAudienceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const draft = useBroadcastDraftStore((s) => s.draft);
  const save = useBroadcastDraftStore((s) => s.save);
  const groupChanged = useBroadcastDraftStore((s) => s.groupChanged);
  const stale = useBroadcastDraftStore((s) => s.stale);
  const status = useBroadcastDraftStore((s) => s.status);

  /** The size the last Switch sent; null while nothing is in flight. */
  const [sent, setSent] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // A newly opened dialog starts clean (state adjusted while rendering).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSent(null);
      setChanged(false);
      setFailed(false);
      setDone(false);
    }
  }

  const groupSize = draft?.audience.kind === 'group' ? draft.audience.size : 0;
  const shownSize = groupChanged ?? groupSize;
  const pending = sent !== null && save === 'saving';

  // The answer to the Switch sent: switched, refused as changed, stale / launched, or failed.
  if (sent !== null && save !== 'saving') {
    if (draft?.audience.kind === 'tags' || stale !== null || status !== 'ready') {
      setSent(null);
      setDone(true);
    } else if (groupChanged !== null && groupChanged !== sent) {
      setSent(null);
      setChanged(true);
    } else if (save === 'failed') {
      setSent(null);
      setFailed(true);
    }
  }

  // Closed once per answer, whatever the host passes as `onClose` meanwhile.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (done) closeRef.current();
  }, [done]);

  const confirm = () => {
    setChanged(false);
    setFailed(false);
    setSent(shownSize);
    useBroadcastDraftStore.getState().saveAudience(
      {
        kind: 'tags',
        mode: 'any',
        tag_ids: [],
        exclude_tag_ids: [],
        expected_group_size: shownSize,
      },
      guard,
    );
  };

  return (
    <AlertDialog
      open={open && !done}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent
        {...focus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to contacts with tags?</AlertDialogTitle>
          <AlertDialogDescription>
            {`The hand-picked group of ${contactsText(shownSize)} will be removed from this draft.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {changed ? (
          <Alert>
            <AlertDescription>The group changed while you were deciding.</AlertDescription>
          </Alert>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t switch the audience</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep the group</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={confirm}>
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Switch
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
