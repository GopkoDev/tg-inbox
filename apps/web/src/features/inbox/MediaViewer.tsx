import { useEffect, useState, type RefObject } from 'react';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';
import { UNAVAILABLE_REASON_TEXT, type MediaState } from './media';

/** SCR-03: a photo or video at full size over the thread. State comes from the message's media hook. */
export function MediaViewer({
  open,
  onOpenChange,
  onRetry,
  kind,
  media,
  contactName,
  at,
  caption,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  kind: 'photo' | 'video';
  media: MediaState;
  contactName: string;
  at: string;
  caption?: string | null;
  /** The element that opened the viewer; focus goes back to it on close. */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const [playerFailed, setPlayerFailed] = useState(false);
  useEffect(() => {
    if (open && media.status === 'forbidden') onOpenChange(false);
  }, [open, media.status, onOpenChange]);

  const retry = () => {
    setPlayerFailed(false);
    onRetry();
  };
  const notResponding = media.status === 'not_responding' || playerFailed;

  let body: React.ReactNode;
  if (notResponding)
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Telegram is not responding — try again
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (media.status === 'unavailable')
    body = (
      <Alert variant="destructive">
        <AlertDescription>
          Content unavailable — {UNAVAILABLE_REASON_TEXT[media.reason]}
        </AlertDescription>
      </Alert>
    );
  else if (media.status === 'error' || media.status === 'forbidden')
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Something went wrong — try again
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (media.status === 'loading')
    body = <Skeleton data-testid="viewer-loading" className="h-[60vh] w-full" />;
  else if (kind === 'video')
    body = (
      <video
        data-testid="viewer-video"
        src={media.url}
        controls
        autoPlay
        onError={() => setPlayerFailed(true)}
        className="max-h-[70vh] w-full rounded-md"
      />
    );
  else
    body = (
      <img
        src={media.url}
        alt={caption ?? 'Photo'}
        className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
      />
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[95vh] max-w-[95vw] overflow-auto sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{contactName}</DialogTitle>
          <DialogDescription>{at}</DialogDescription>
        </DialogHeader>
        {body}
        {caption ? <p className="text-sm break-words whitespace-pre-wrap">{caption}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
