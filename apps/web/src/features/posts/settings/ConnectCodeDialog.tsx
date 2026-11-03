import { Loader2 } from 'lucide-react';
import type { DestinationCodeCreated, DestinationCodeStatus } from '@tg/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
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
import { Skeleton } from '@/shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { createDestinationCode, getDestinationCode } from '../api';
import { useDestinationsStore } from '../destinations-store';

type View =
  | { kind: 'creating' }
  | { kind: 'refused'; code: 'POSTS_NEED_WORKING_BOT' | 'DESTINATION_LIMIT_REACHED' }
  | { kind: 'error' }
  | { kind: 'code'; created: DestinationCodeCreated; status: DestinationCodeStatus['status'] }
  | { kind: 'no_post_right'; created: DestinationCodeCreated; right: string };

const RIGHT: Record<string, string> = {
  post_messages: 'post messages',
  send_messages: 'send messages',
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2">
      <code className="min-w-0 break-all select-all">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

/** SCR-34: creates a connect code, shows it and follows its status until it is used or ends. */
export function ConnectCodeDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'creating' });
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setView({ kind: 'creating' });
    setAttempt((n) => n + 1);
  };
  const items = useDestinationsStore((s) => s.items);

  useEffect(() => {
    let cancelled = false;
    createDestinationCode(workspaceId).then(
      (created) => {
        if (!cancelled) setView({ kind: 'code', created, status: 'waiting' });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (
          error instanceof ApiError &&
          (error.code === 'POSTS_NEED_WORKING_BOT' || error.code === 'DESTINATION_LIMIT_REACHED')
        ) {
          setView({ kind: 'refused', code: error.code });
        } else setView({ kind: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  const created = view.kind === 'code' || view.kind === 'no_post_right' ? view.created : null;
  const done = view.kind === 'code' && view.status !== 'waiting';
  const [connectedId, setConnectedId] = useState<string | null>(null);

  const poll = useCallback(async () => {
    if (!created) return;
    try {
      const s = await getDestinationCode(workspaceId, created.id);
      if (s.status === 'waiting') setView({ kind: 'code', created, status: 'waiting' });
      else if (s.status === 'no_post_right')
        setView({
          kind: 'no_post_right',
          created,
          right: RIGHT[s.needed_right ?? ''] ?? 'post messages',
        });
      else {
        setView({ kind: 'code', created, status: s.status });
        if (s.status === 'connected') setConnectedId(s.destination_id);
      }
    } catch {
      // a failed background read is retried on the next tick
    }
  }, [workspaceId, created]);

  const createdId = created?.id ?? null;
  const expiresAt = created?.expires_at ?? null;
  useEffect(() => {
    if (!createdId || done) return;
    const first = setTimeout(() => void poll(), 0);
    const stop = subscribeLive(workspaceId, {
      onFrame: (frame) => {
        if (frame.type === 'destinations.changed' || frame.type === 'resync') void poll();
      },
      onReconnected: () => void poll(),
      onInvalidFrame: () => void poll(),
      onClosed: () => undefined,
    });
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [workspaceId, createdId, done, poll]);

  useEffect(() => {
    if (!createdId || !expiresAt || done) return;
    const left = new Date(expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () =>
        setView((v) =>
          v.kind === 'code' || v.kind === 'no_post_right'
            ? { kind: 'code', created: v.created, status: 'expired' }
            : v,
        ),
      Math.min(Math.max(0, left), 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [createdId, expiresAt, done]);

  const expired = view.kind === 'code' && (view.status === 'expired' || view.status === 'replaced');
  const connected = view.kind === 'code' && view.status === 'connected';
  const connectedTitle = items.find((d) => d.id === connectedId)?.title ?? 'The chat';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a channel or group</DialogTitle>
          <DialogDescription className="sr-only">
            Post the code in the chat to connect it
          </DialogDescription>
        </DialogHeader>
        {view.kind === 'creating' && <Skeleton className="h-20 w-full" />}
        {view.kind === 'refused' && view.code === 'POSTS_NEED_WORKING_BOT' && (
          <Alert variant="destructive">
            <AlertDescription>
              The bot isn't working, so there is nothing to connect yet.{' '}
              <Link className="underline" to={`/w/${workspaceId}/settings/bot`}>
                Open bot settings
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {view.kind === 'refused' && view.code === 'DESTINATION_LIMIT_REACHED' && (
          <Alert variant="destructive">
            <AlertDescription>You can connect up to 20 channels and groups</AlertDescription>
          </Alert>
        )}
        {view.kind === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>Couldn't create a code.</AlertDescription>
            <Button size="sm" onClick={retry}>
              Try again
            </Button>
          </Alert>
        )}
        {connected && <p>{connectedTitle} is connected</p>}
        {expired && (
          <Alert variant="destructive">
            <AlertDescription>
              {view.kind === 'code' && view.status === 'replaced'
                ? 'A newer code was created'
                : 'This code expired'}
            </AlertDescription>
            <Button size="sm" onClick={retry}>
              Get a new code
            </Button>
          </Alert>
        )}
        {created && !expired && !connected && (
          <>
            {view.kind === 'no_post_right' && (
              <Alert variant="destructive">
                <AlertDescription>
                  {`The bot can't post in this chat yet. Give it the right to ${view.right}, then post the code again.`}
                </AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="channel">
              <TabsList>
                <TabsTrigger value="channel">Channel</TabsTrigger>
                <TabsTrigger value="group">Group</TabsTrigger>
              </TabsList>
              <TabsContent value="channel" className="space-y-2">
                <p>1. Make the bot an admin who can post messages.</p>
                <p>2. Post this message in the channel:</p>
                <CodeLine text={created.code} />
              </TabsContent>
              <TabsContent value="group" className="space-y-2">
                <p>1. Add the bot to the group and let it send messages.</p>
                <p>2. Send this command in the group:</p>
                <CodeLine text={created.group_command} />
              </TabsContent>
            </Tabs>
            <p className="text-sm text-muted-foreground">
              {`Expires at ${clock(created.expires_at)} · Waiting for the code…`}
              {view.kind === 'code' && (
                <Loader2 className="ml-1 inline size-3 animate-spin" aria-hidden />
              )}
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant={connected ? 'default' : 'outline'} onClick={onClose}>
            {connected ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
