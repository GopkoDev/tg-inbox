import { Loader2, MoreHorizontal, TriangleAlert } from 'lucide-react';
import type { BroadcastListItem, BroadcastStatus } from '@tg/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuthStore } from '@/features/auth/store';
import { relativeTime } from '@/features/inbox/relative-time';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { duplicateBroadcast } from './api';
import { useBroadcastListStore } from './list-store';

const HIDDEN_ON_PHONE = 'hidden md:table-cell';
const AUDIENCE_LIMIT = 10_000;
const OVER_LIMIT = 'Over the 10 000 limit — cannot be launched';
const EMPTY =
  'No broadcasts yet. A broadcast sends one message from your business bot to a group of your contacts, chosen by tags or picked by hand.';

const numbers = new Intl.NumberFormat();
const contactsText = (n: number) => `${numbers.format(n)} ${n === 1 ? 'contact' : 'contacts'}`;

/** Decision 11: Draft secondary, Sending default with a pulsing dot, Sent outline, Stopped muted. */
function StatusBadge({ status }: { status: BroadcastStatus }) {
  switch (status) {
    case 'draft':
      return <Badge variant="secondary">Draft</Badge>;
    case 'sending':
      return (
        <Badge>
          <span
            data-testid="sending-dot"
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-current"
          />
          Sending
        </Badge>
      );
    case 'sent':
      return <Badge variant="outline">Sent</Badge>;
    case 'stopped':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Stopped
        </Badge>
      );
  }
}

function Audience({ item }: { item: BroadcastListItem }) {
  const over =
    item.status === 'draft' && item.audience_kind === 'tags' && item.audience_size > AUDIENCE_LIMIT;
  return (
    <span className="inline-flex items-center gap-1">
      {contactsText(item.audience_size)}
      {over ? (
        <TriangleAlert className="size-4 text-destructive" aria-label={OVER_LIMIT} role="img">
          <title>{OVER_LIMIT}</title>
        </TriangleAlert>
      ) : null}
    </span>
  );
}

/** «Test User · 3m», «Launched by …» / «Stopped by …» from the status; the full date-time in `title`. */
function LastChange({ item }: { item: BroadcastListItem }) {
  const who = item.last_changed_by.display_name;
  const prefix =
    item.status === 'stopped' ? 'Stopped by ' : item.status === 'draft' ? '' : 'Launched by ';
  return (
    <span title={new Date(item.last_changed_at).toLocaleString()}>
      {`${prefix}${who} · ${relativeTime(item.last_changed_at)}`}
    </span>
  );
}

interface RowActions {
  /** A launched broadcast's Duplicate opens SCR-30 (T36). Without it, a launched row has no Duplicate. */
  onDuplicateLaunched?: ((item: BroadcastListItem) => void) | undefined;
  /** Delete opens SCR-31 (T31). Without it, no row offers Delete. */
  onDelete?: ((item: BroadcastListItem) => void) | undefined;
}

function RowView({
  workspaceId,
  item,
  mayDelete,
  actions,
  onDuplicateDraft,
  duplicating,
}: {
  workspaceId: string;
  item: BroadcastListItem;
  mayDelete: boolean;
  actions: RowActions;
  onDuplicateDraft: (item: BroadcastListItem) => void;
  duplicating: boolean;
}) {
  const draft = item.status === 'draft';
  const canDuplicate = draft || actions.onDuplicateLaunched !== undefined;
  const canDelete = draft && mayDelete && actions.onDelete !== undefined;
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              to={`/w/${workspaceId}/broadcasts/${item.id}`}
              className="truncate font-medium hover:underline"
            >
              {item.name}
            </Link>
            <span className="md:hidden">
              <StatusBadge status={item.status} />
            </span>
          </div>
          <div
            data-testid="phone-details"
            className="flex flex-col text-xs text-muted-foreground md:hidden"
          >
            <Audience item={item} />
            <LastChange item={item} />
          </div>
        </div>
      </TableCell>
      <TableCell className={HIDDEN_ON_PHONE}>
        <StatusBadge status={item.status} />
      </TableCell>
      <TableCell className={HIDDEN_ON_PHONE}>
        <Audience item={item} />
      </TableCell>
      <TableCell className={`${HIDDEN_ON_PHONE} text-muted-foreground`}>
        <LastChange item={item} />
      </TableCell>
      <TableCell className="w-10 text-right">
        {canDuplicate || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${item.name}`}
                disabled={duplicating}
              >
                {duplicating ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <MoreHorizontal aria-hidden />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDuplicate ? (
                <DropdownMenuItem
                  onSelect={() =>
                    draft ? onDuplicateDraft(item) : actions.onDuplicateLaunched?.(item)
                  }
                >
                  Duplicate
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete?.(item)}>
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <TableRow key={i} data-testid="broadcast-skeleton">
          <TableCell>
            <Skeleton className="h-4 w-40" />
          </TableCell>
          <TableCell className={HIDDEN_ON_PHONE}>
            <Skeleton className="h-5 w-16" />
          </TableCell>
          <TableCell className={HIDDEN_ON_PHONE}>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell className={HIDDEN_ON_PHONE}>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

/**
 * SCR-24's body: every broadcast of the workspace, most recently changed first, re-read live on
 * `broadcast.changed`, with the empty and error states and the role-aware row actions.
 */
export function BroadcastsTable({
  workspaceId,
  onDuplicateLaunched,
  onDelete,
}: { workspaceId: string } & RowActions) {
  const guard = useShellGuard();
  const navigate = useNavigate();
  const role = useWorkspaceStore((s) => s.current?.role);
  const me = useAuthStore((s) => s.account?.id);
  const status = useBroadcastListStore((s) => (s.workspaceId === workspaceId ? s.status : 'idle'));
  const items = useBroadcastListStore((s) => (s.workspaceId === workspaceId ? s.items : []));
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [duplicateFailed, setDuplicateFailed] = useState(false);

  useEffect(() => {
    const store = useBroadcastListStore.getState();
    void store.load(workspaceId, guard);
    const stop = store.watch(workspaceId, guard);
    return () => {
      stop();
      useBroadcastListStore.getState().clear();
    };
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const duplicateDraft = (item: BroadcastListItem) => {
    setDuplicateFailed(false);
    setDuplicating(item.id);
    duplicateBroadcast(workspaceId, item.id, { audience: 'same', include_not_confirmed: false })
      .then((copy) => void navigate(`/w/${workspaceId}/broadcasts/${copy.id}`))
      .catch(() => setDuplicateFailed(true))
      .finally(() => setDuplicating(null));
  };

  if (status === 'error')
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load broadcasts
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useBroadcastListStore.getState().load(workspaceId, guard)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );

  if (status === 'ready' && items.length === 0)
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">{EMPTY}</p>
          <Button asChild>
            <Link to={`/w/${workspaceId}/broadcasts/new`}>New broadcast</Link>
          </Button>
        </CardContent>
      </Card>
    );

  const loading = status !== 'ready';
  return (
    <div className="flex flex-col gap-4">
      {duplicateFailed ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t duplicate the broadcast</AlertDescription>
        </Alert>
      ) : null}
      <Card className="py-0">
        <Table aria-label="Broadcasts">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className={HIDDEN_ON_PHONE}>Status</TableHead>
              <TableHead className={HIDDEN_ON_PHONE}>Audience</TableHead>
              <TableHead className={HIDDEN_ON_PHONE}>Last change</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <SkeletonRows />
            ) : (
              items.map((item) => (
                <RowView
                  key={item.id}
                  workspaceId={workspaceId}
                  item={item}
                  mayDelete={role === 'owner' || item.author.account_id === me}
                  actions={{ onDuplicateLaunched, onDelete }}
                  onDuplicateDraft={duplicateDraft}
                  duplicating={duplicating === item.id}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
