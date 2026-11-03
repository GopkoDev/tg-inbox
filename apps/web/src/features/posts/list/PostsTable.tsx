import { TriangleAlert } from 'lucide-react';
import type { PostOutcomeReason, PostState, PostSummary } from '@tg/shared';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { PostFilter } from '../api';
import { useDestinationsStore } from '../destinations-store';
import { usePostsStore } from '../posts-store';
import { formatPostTime } from '../time';

const FILTERS: { value: PostFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'attention', label: 'Needs attention' },
];

const parseFilter = (raw: string | null): PostFilter =>
  FILTERS.find((f) => f.value === raw)?.value ?? 'all';

const STATE_LABEL: Record<PostState, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  published: 'Published',
  failed: 'Failed',
  missed: 'Missed',
  not_confirmed: 'Not confirmed',
  deleted: 'Deleted',
};

const REASON_TEXT: Record<PostOutcomeReason, string> = {
  bot_not_working: 'The bot is not working',
  not_current_bot: 'The workspace bot was changed',
  destination_unavailable: 'The destination is unavailable',
  no_post_right: 'The bot cannot post there',
  chat_gone: 'The chat no longer exists',
  text_refused: 'Telegram refused the text',
  telegram_error: 'Telegram returned an error',
  daily_limit: 'The daily posting limit was reached',
  service_down: 'The service was down at the scheduled time',
  bot_paused: 'The bot was paused by Telegram',
  chat_rate_limited: 'Telegram limited posting to the chat',
};

const KIND_LABEL = { channel: 'Channel', group: 'Group' } as const;

function stateLine(post: PostSummary, zone: string | null): string {
  const label = STATE_LABEL[post.state];
  const at = post.state === 'published' ? post.published_at : post.scheduled_for;
  const timed = post.state === 'scheduled' || post.state === 'published' || post.state === 'missed';
  return timed && at && zone ? `${label} · ${formatPostTime(at, zone)}` : label;
}

function RowView({
  workspaceId,
  post,
  zone,
}: {
  workspaceId: string;
  post: PostSummary;
  zone: string | null;
}) {
  const failed = post.state === 'failed' || post.state === 'missed';
  const timed = post.state === 'scheduled' || post.state === 'published';
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={`/w/${workspaceId}/posts/${post.id}`}
            className="truncate font-medium hover:underline"
          >
            {post.text_start || 'Untitled post'}
          </Link>
          {post.outcome_reason ? (
            <span className="text-xs text-muted-foreground">
              {REASON_TEXT[post.outcome_reason]}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {post.destination ? (
          <div className="flex flex-col">
            <span>{post.destination.title}</span>
            <span className="text-xs text-muted-foreground">
              {KIND_LABEL[post.destination.kind]}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">No destination</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {failed ? (
            <>
              <TriangleAlert
                data-testid="needs-attention"
                className="size-4 text-destructive"
                aria-label="Needs attention"
                role="img"
              />
              <Badge variant="destructive">{STATE_LABEL[post.state]}</Badge>
              {post.state === 'missed' && post.scheduled_for && zone ? (
                <span className="text-xs text-muted-foreground">
                  {formatPostTime(post.scheduled_for, zone)}
                </span>
              ) : null}
            </>
          ) : (
            <Badge variant={timed ? 'default' : 'secondary'}>{stateLine(post, zone)}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{post.last_changed_by.display_name}</TableCell>
    </TableRow>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 4 }, (_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-28" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** SCR-36's body: the filter tabs (kept in `?filter=`), the posts table and its states. */
export function PostsTable({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('filter'));
  const here = usePostsStore((s) => s.workspaceId === workspaceId);
  const status = usePostsStore((s) => (here ? s.status : 'idle'));
  const items = usePostsStore((s) => (here ? s.items : []));
  const zone = usePostsStore((s) => s.timeZone);
  const truncated = usePostsStore((s) => s.truncated);
  const destinations = useDestinationsStore((s) => s.items);
  const destinationsReady = useDestinationsStore(
    (s) => s.workspaceId === workspaceId && s.status === 'ready',
  );

  useEffect(() => {
    void usePostsStore.getState().load(workspaceId, filter, guard);
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, filter]);

  useEffect(() => {
    const stop = usePostsStore.getState().watch(workspaceId, guard);
    void useDestinationsStore.getState().load(workspaceId, guard);
    return () => {
      stop();
      usePostsStore.getState().clear();
      useDestinationsStore.getState().clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const select = (value: PostFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'all') next.delete('filter');
        else next.set('filter', value);
        return next;
      },
      { replace: true },
    );

  const tabs = (
    <div role="tablist" aria-label="Filter posts" className="flex flex-wrap gap-1">
      {FILTERS.map((f) => (
        <Button
          key={f.value}
          type="button"
          role="tab"
          size="sm"
          variant={f.value === filter ? 'default' : 'outline'}
          aria-selected={f.value === filter}
          onClick={() => select(f.value)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );

  if (status === 'error')
    return (
      <div className="flex flex-col gap-4">
        {tabs}
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Couldn&apos;t load posts
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void usePostsStore.getState().load(workspaceId, filter, guard)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );

  const loading = status !== 'ready';
  const empty = !loading && items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {tabs}
      {empty && filter !== 'all' ? (
        <Card>
          <EmptyFilterState
            message="No posts match this filter."
            actionLabel="Show all posts"
            onClear={() => select('all')}
          />
        </Card>
      ) : empty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            {destinationsReady && destinations.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">There is nowhere to post yet.</p>
                <Button asChild>
                  <Link to={`/w/${workspaceId}/settings/channels`}>
                    Connect a channel or group first
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Posts appear in your channels and groups from your bot. Write the first one.
                </p>
                <Button asChild>
                  <Link to={`/w/${workspaceId}/posts/new`}>New post</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table aria-label="Posts">
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last changed by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody data-testid={loading ? 'posts-loading' : undefined}>
              {loading ? (
                <SkeletonRows />
              ) : (
                items.map((post) => (
                  <RowView key={post.id} workspaceId={workspaceId} post={post} zone={zone} />
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      {truncated ? (
        <p className="text-center text-xs text-muted-foreground">Showing the newest 200 posts</p>
      ) : null}
    </div>
  );
}
