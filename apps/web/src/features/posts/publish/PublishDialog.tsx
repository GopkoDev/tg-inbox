import { instantToLocal, type PublishConfirmation } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/features/inbox/StateChangedDialog';
import { ApiError } from '@/shared/api/client';
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
import { Skeleton } from '@/shared/ui/skeleton';
import { publishPost } from '../api';
import {
  BLOCKER_TEXT,
  BotSettingsLink,
  ErrorCode,
  KIND_LABEL,
  ProblemAlert,
  errorCode,
  isAuthError,
  useConfirmation,
} from './shared';

type Problem =
  | { kind: 'changed' }
  | { kind: 'bot' }
  | { kind: 'destination' }
  | { kind: 'daily'; at: string | null }
  | { kind: 'failed' };

const timeOf = (iso: string, zone: string | null) =>
  instantToLocal(new Date(iso), zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).slice(11);

/**
 * SCR-38: the last look at the destination and the exact text before publishing now (owner only).
 * The confirmation's version goes with the publish, so a changed draft publishes nothing (AC-08).
 */
export function PublishDialog({
  workspaceId,
  postId,
  onClose,
  onDone,
}: {
  workspaceId: string;
  postId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const { data, failed, reload } = useConfirmation(workspaceId, postId);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const inFlight = useRef(false);

  const confirm = async (c: PublishConfirmation) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await publishPost(workspaceId, postId, { expected_version: c.version });
      onDone();
    } catch (error) {
      const code = errorCode(error);
      if (code === ErrorCode.POST_DRAFT_CHANGED) {
        setProblem({ kind: 'changed' });
        await reload();
      } else if (code === ErrorCode.POSTS_NEED_WORKING_BOT) setProblem({ kind: 'bot' });
      else if (code === ErrorCode.DESTINATION_UNAVAILABLE) setProblem({ kind: 'destination' });
      else if (code === ErrorCode.POST_DAILY_LIMIT_REACHED) {
        const at = (error as ApiError).details as { frees_at?: string } | undefined;
        setProblem({ kind: 'daily', at: at?.frees_at ?? null });
      } else if (isAuthError(error)) {
        onClose();
        void guard(error as ApiError, workspaceId).catch(() => undefined);
      } else setProblem({ kind: 'failed' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const blocked = !data || data.blockers.length > 0;

  return (
    <AlertDialog
      open
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
          <AlertDialogTitle>
            {data?.destination ? `Publish to ${data.destination.title} now?` : 'Publish now?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The bot posts this text once, exactly as shown. It can&apos;t be edited afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!data ? (
          failed ? (
            <ProblemAlert>Couldn&apos;t load the post</ProblemAlert>
          ) : (
            <div data-testid="publish-skeleton" className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          )
        ) : (
          <div className="space-y-3">
            {data.destination ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{KIND_LABEL[data.destination.kind]}</span>
                {data.destination.username ? <span>@{data.destination.username}</span> : null}
              </div>
            ) : null}
            <div className="rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap break-words">
              {data.text}
            </div>
            {data.silent ? <p className="text-sm text-muted-foreground">Without sound</p> : null}
            <p className="text-sm text-muted-foreground">
              {`${data.sent_last_24h} of ${data.daily_limit} posts sent in the last 24 hours`}
            </p>
            {data.blockers.map((blocker) => (
              <ProblemAlert key={blocker}>
                {BLOCKER_TEXT[blocker]}
                {blocker === 'bot_not_working' ? (
                  <>
                    {' '}
                    <BotSettingsLink workspaceId={workspaceId} />
                  </>
                ) : null}
              </ProblemAlert>
            ))}
          </div>
        )}

        {problem?.kind === 'changed' ? (
          <ProblemAlert>The draft changed — check it again</ProblemAlert>
        ) : null}
        {problem?.kind === 'bot' ? (
          <ProblemAlert>
            The bot is not working. <BotSettingsLink workspaceId={workspaceId} />
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'destination' ? (
          <ProblemAlert>The bot can&apos;t post in this chat any more</ProblemAlert>
        ) : null}
        {problem?.kind === 'daily' ? (
          <ProblemAlert>
            {`The daily posting limit was reached.${
              problem.at
                ? ` You can post again at ${timeOf(problem.at, data?.time_zone ?? null)}.`
                : ''
            }`}
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'failed' ? (
          <ProblemAlert>Couldn&apos;t publish the post</ProblemAlert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={blocked || pending}
            onClick={() => data && void confirm(data)}
          >
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Publish
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
