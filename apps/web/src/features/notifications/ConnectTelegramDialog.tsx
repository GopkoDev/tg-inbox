import type { IssuedConnectLink } from '@tg/shared';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatBotClock } from '@/features/bot/settings/format';
import type { GuardFn } from '@/features/workspaces/guard';
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
import { Separator } from '@/shared/ui/separator';
import { useNotificationsStore } from './store';

const COPIED_MS = 2000;

/** Time left until `iso`, never negative. */
const until = (iso: string) => Math.max(0, new Date(iso).getTime() - Date.now());

/**
 * SCR-17: the issued connect link with Copy and Open in Telegram, its expiry, the wait for Start,
 * the live turn to «Connected», new-link refusals in place and the bot-stopped state. Opened by
 * the card with a `201`; closing it loses nothing (the link stays valid for its 10 minutes).
 * No scannable code in v1 (screens.md Decision 6).
 */
export function ConnectTelegramDialog({
  workspaceId,
  workspaceName,
  issued,
  guard,
  onClose,
  returnFocus,
}: {
  workspaceId: string;
  workspaceName: string;
  issued: IssuedConnectLink;
  guard: GuardFn;
  onClose: () => void;
  /** Puts focus back on Connect Telegram, which may have been disabled while the link was made. */
  returnFocus: () => void;
}) {
  const settings = useNotificationsStore((s) => s.settings);
  const action = useNotificationsStore((s) => s.action);
  const [link, setLink] = useState(issued);
  const [expired, setExpired] = useState(() => until(issued.expires_at) === 0);
  const [copied, setCopied] = useState(false);
  const [canCopy, setCanCopy] = useState(
    () => typeof navigator.clipboard?.writeText === 'function',
  );
  const [limitUntil, setLimitUntil] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The link stops working at `expires_at`: hide it then, without waiting for any frame.
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), until(link.expires_at));
    return () => clearTimeout(timer);
  }, [link.expires_at]);

  // The link limit lifts at `retry_at`: the alert goes and a new link can be asked for.
  useEffect(() => {
    if (!limitUntil) return;
    const timer = setTimeout(() => setLimitUntil(null), until(limitUntil));
    return () => clearTimeout(timer);
  }, [limitUntil]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCanCopy(false); // the clipboard refuses: the link stays selectable
    }
  };

  const renew = async () => {
    setFailed(false);
    const outcome = await useNotificationsStore.getState().connect(workspaceId, guard);
    switch (outcome.kind) {
      case 'issued':
        setLink(outcome.link);
        setExpired(until(outcome.link.expires_at) === 0);
        setCopied(false);
        setLimitUntil(null);
        return;
      case 'limit':
        setLimitUntil(outcome.retryAt);
        return;
      case 'failed':
        setFailed(true);
        return;
      case 'guarded':
        onClose();
        return;
      default:
        return; // already connected / bot stopped: the settings in the store decide the view
    }
  };

  const telegram = settings?.telegram;
  const isConnected = telegram?.state === 'connected';
  const botStopped = !isConnected && settings !== null && !settings.can_connect;
  const renewing = action === 'connecting';

  let body;
  let footer;
  if (telegram?.state === 'connected') {
    body = (
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <Check className="text-primary size-8" aria-hidden />
        <p className="font-medium">Connected as {telegram.display_name}.</p>
        <p className="text-muted-foreground text-sm">
          The {workspaceName} bot sent you a message in Telegram.
        </p>
      </div>
    );
    footer = <Button onClick={onClose}>Done</Button>;
  } else if (botStopped) {
    body = (
      <div className="space-y-3">
        <p>Telegram pings need a working bot that receives messages.</p>
        {settings.caller_role === 'owner' ? (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to={`/w/${workspaceId}/settings/bot`} onClick={onClose}>
              Open bot settings
            </Link>
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Ask a business owner to fix the bot.</p>
        )}
      </div>
    );
    footer = (
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    );
  } else {
    const renewButton = (
      <Button
        variant={expired ? 'default' : 'ghost'}
        disabled={renewing || limitUntil !== null}
        aria-busy={renewing}
        onClick={() => void renew()}
      >
        {renewing && <Loader2 className="animate-spin" aria-hidden />}
        Get a new link
      </Button>
    );
    const closeButton = (
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    );
    body = (
      <div className="space-y-3">
        {expired ? (
          <p>This link has expired.</p>
        ) : (
          <>
            <Button asChild className="w-full">
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                Open in Telegram
              </a>
            </Button>
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground min-w-0 flex-1 text-sm break-all select-all">
                {link.url}
              </p>
              {canCopy && (
                <Button variant="outline" size="sm" onClick={() => void copy()}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              This link works once, until {formatBotClock(link.expires_at)}.
            </p>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Waiting for you to press Start in Telegram…
            </p>
          </>
        )}
        {limitUntil && (
          <Alert>
            <AlertDescription>
              Connect links are limited to 5 per 10 minutes — try again at{' '}
              {formatBotClock(limitUntil)}.
            </AlertDescription>
          </Alert>
        )}
        {failed && (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t create a new link — try again.</AlertDescription>
          </Alert>
        )}
      </div>
    );
    footer = expired ? (
      <>
        {closeButton}
        {renewButton}
      </>
    ) : (
      <>
        {renewButton}
        {closeButton}
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Connect Telegram</DialogTitle>
          <DialogDescription
            className={isConnected || botStopped || expired ? 'sr-only' : undefined}
          >
            {isConnected || botStopped || expired
              ? 'Connect your Telegram account to get pings.'
              : `Open the link in Telegram, then press Start in the chat with @${link.bot_username}.`}
          </DialogDescription>
        </DialogHeader>
        {body}
        <Separator />
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
