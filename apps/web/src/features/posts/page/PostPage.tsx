import type { Post, PostOutcomeReason } from '@tg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { BackToDraftDialog } from '../editor/BackToDraftDialog';
import { duplicatePost, getPost, listDestinations, markPostSeen } from '../api';
import { usePostsStore } from '../posts-store';
import { formatPostTime } from '../time';
import { DeleteFromTelegramDialog } from './DeleteFromTelegramDialog';

const STATE_LABEL = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Going out…',
  published: 'Published',
  failed: 'Failed',
  missed: 'Missed',
  not_confirmed: 'Not confirmed',
  deleted: 'Deleted',
} as const;

const REASONS: Record<PostOutcomeReason, string> = {
  bot_not_working: 'The bot was not working',
  not_current_bot: 'This chat is not connected to the current bot',
  destination_unavailable: 'The channel or group was not available',
  no_post_right: 'The bot can no longer post in this chat',
  chat_gone: 'This chat no longer exists',
  text_refused: 'Telegram refused the text',
  telegram_error: 'Telegram returned an error',
  daily_limit: 'The daily posting limit was reached',
  service_down: 'The service was down at the scheduled time',
  bot_paused: 'The bot was paused by Telegram',
  chat_rate_limited: 'Telegram limited posting to this chat',
};

const NOT_CONFIRMED =
  'Telegram did not answer. It may have been posted — check the chat. It is not sent again.';

const canDelete = (post: Post) =>
  post.state === 'published' &&
  post.deletable_until !== null &&
  Date.parse(post.deletable_until) > Date.now();

/**
 * SCR-40: a post that is not a draft, in every state (AC-07, AC-08, AC-12, AC-13, AC-15). Loads
 * itself, re-reads on a live `post.changed`, and marks a post that needs attention as seen once.
 * `onChangeTime` is the host's hook for the reschedule dialog.
 */
export function PostPage({
  workspaceId,
  postId,
  isOwner,
  onChangeTime,
  onChanged,
}: {
  workspaceId: string;
  postId: string;
  isOwner: boolean;
  onChangeTime?: (post: Post) => void;
  onChanged?: () => void;
}) {
  const guard = useShellGuard();
  const navigate = useNavigate();
  const storeZone = usePostsStore((s) => s.timeZone);
  const [fetchedZone, setFetchedZone] = useState<string | null>(null);
  const zone = storeZone ?? fetchedZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (storeZone) return;
    let live = true;
    listDestinations(workspaceId, { background: true })
      .then((list) => {
        if (live) setFetchedZone(list.time_zone);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [storeZone, workspaceId]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [post, setPost] = useState<Post | null>(null);
  const [reloads, setReloads] = useState(0);
  const [dialog, setDialog] = useState<'delete' | 'back' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const changedRef = useRef(onChanged);
  useEffect(() => {
    changedRef.current = onChanged;
  }, [onChanged]);

  const load = useCallback(
    async (background: boolean, isLive: () => boolean) => {
      try {
        const loaded = await getPost(workspaceId, postId, { background });
        if (!isLive()) return;
        setPost(loaded);
        setStatus('ready');
      } catch (error) {
        if (!isLive()) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403))
          void guard(error, workspaceId).catch(() => undefined);
        if (background) return;
        setStatus(error instanceof ApiError && error.status === 404 ? 'missing' : 'error');
      }
    },
    [workspaceId, postId, guard],
  );

  useEffect(() => {
    let live = true;
    getPost(workspaceId, postId)
      .then((loaded) => {
        if (!live) return;
        setPost(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403))
          void guard(error, workspaceId).catch(() => undefined);
        setStatus(error instanceof ApiError && error.status === 404 ? 'missing' : 'error');
      });
    const unsubscribe = subscribeLive(workspaceId, {
      onFrame: (frame) => {
        if (
          frame.type === 'resync' ||
          (frame.type === 'post.changed' && frame.post_id === postId)
        ) {
          void load(true, () => live);
          changedRef.current?.();
        }
      },
      onReconnected: () => void load(true, () => live),
      onInvalidFrame: () => void load(true, () => live),
      onClosed: () => undefined,
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [load, guard, workspaceId, postId, reloads]);

  const needsAttention = post?.needs_attention === true;
  useEffect(() => {
    if (!needsAttention || seenRef.current === postId) return;
    seenRef.current = postId;
    markPostSeen(workspaceId, postId).catch(() => {
      seenRef.current = null;
    });
  }, [needsAttention, workspaceId, postId]);

  const duplicate = async () => {
    setProblem(null);
    try {
      const copy = await duplicatePost(workspaceId, postId);
      void navigate(`/w/${workspaceId}/posts/${copy.id}`);
    } catch {
      setProblem("Couldn't duplicate the post");
    }
  };

  if (status === 'loading') {
    return (
      <div data-testid="post-page-skeleton" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (status === 'missing' || status === 'error' || !post) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center gap-3">
          {status === 'missing' ? 'This post was not found' : "Couldn't load the post"}
          {status === 'error' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setStatus('loading');
                setReloads((n) => n + 1);
              }}
            >
              Retry
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  const state = post.state;
  const destination = post.destination;
  const reason = post.outcome_reason ? REASONS[post.outcome_reason] : null;
  const deletable = canDelete(post);
  const scheduledFor = post.schedule?.kind === 'time' ? post.schedule.scheduled_for : null;
  const publisher = post.schedule?.scheduled_by ?? post.author;
  const badgeVariant =
    state === 'failed' ? 'destructive' : state === 'published' ? 'default' : 'secondary';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={badgeVariant}>{STATE_LABEL[state]}</Badge>
        {destination ? (
          <span className="text-sm text-muted-foreground">To {destination.title}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        {state === 'scheduled' && scheduledFor ? (
          <p>Goes out {formatPostTime(scheduledFor, zone)}</p>
        ) : null}
        {state === 'published' && post.published_at ? (
          <p>
            Published {formatPostTime(post.published_at, zone)}
            {publisher ? ` · ${publisher.display_name}` : ''}
          </p>
        ) : null}
        {state === 'failed' && reason ? <p>{reason}</p> : null}
        {state === 'missed' ? (
          <>
            {reason ? <p>{reason}</p> : null}
            <p>It was not published later.</p>
          </>
        ) : null}
        {state === 'not_confirmed' ? <p>{NOT_CONFIRMED}</p> : null}
        {state === 'deleted' ? (
          <p>
            Deleted from Telegram by {post.deleted_by?.display_name ?? 'a business owner'}
            {post.deleted_at ? ` · ${formatPostTime(post.deleted_at, zone)}` : ''}
          </p>
        ) : null}
      </div>

      <div className="whitespace-pre-wrap rounded-md border p-4 text-sm">{post.text}</div>

      {problem ? (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {state === 'scheduled' ? (
          <>
            <Button type="button" variant="outline" onClick={() => setDialog('back')}>
              Back to draft
            </Button>
            {isOwner ? (
              <Button type="button" variant="outline" onClick={() => onChangeTime?.(post)}>
                Change time
              </Button>
            ) : null}
          </>
        ) : null}
        {state === 'published' && post.telegram_link ? (
          <Button asChild variant="outline">
            <a href={post.telegram_link} target="_blank" rel="noopener noreferrer">
              Open in Telegram
            </a>
          </Button>
        ) : null}
        {deletable && isOwner ? (
          <Button type="button" variant="destructive" onClick={() => setDialog('delete')}>
            Delete from Telegram
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => void duplicate()}>
          Duplicate
        </Button>
      </div>
      {state === 'scheduled' && !isOwner ? (
        <p className="text-sm text-muted-foreground">
          Only a business owner can change the time of this post.
        </p>
      ) : null}
      {deletable && !isOwner ? (
        <p className="text-sm text-muted-foreground">
          Only a business owner can delete this post from Telegram.
        </p>
      ) : null}

      {dialog === 'delete' && destination ? (
        <DeleteFromTelegramDialog
          workspaceId={workspaceId}
          postId={postId}
          destinationTitle={destination.title}
          onClose={() => setDialog(null)}
          onDeleted={(next) => {
            setPost(next);
            setDialog(null);
          }}
          onWindowPassed={() => void load(true, () => true)}
        />
      ) : null}
      {dialog === 'back' ? (
        <BackToDraftDialog
          workspaceId={workspaceId}
          postId={postId}
          version={post.version}
          onClose={() => setDialog(null)}
          onMoved={() => {
            void navigate(`/w/${workspaceId}/posts/${postId}`, { replace: true });
            onChanged?.();
          }}
          onTooLate={() => {
            void load(true, () => true);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
