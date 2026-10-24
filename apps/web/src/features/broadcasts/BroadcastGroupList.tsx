import type { BroadcastGroupRow } from '@tg/shared';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { contactFullName, formatFullDay } from '@/features/contacts/format';
import { initials } from '@/shared/lib/initials';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatCount } from './AudienceBreakdown';
import { useBroadcastDraftStore } from './draft-store';
import { GroupPicker } from './GroupPicker';
import { TagBadges } from './tag-badges';

const ON_WIDE = 'hidden sm:table-cell';

const sizeText = (n: number) => `${formatCount(n)} ${n === 1 ? 'contact' : 'contacts'}`;

/**
 * SCR-25's hand-picked group (screens.md Decision 9): the size with **Add contacts** (SCR-26), the
 * contacts newest added first with name, @username, tags («+N» after 3), the «Blocked the bot»
 * marker and **Remove**, 50 at a time. Removes go through the draft store's group chain; the size
 * follows each answer and the breakdown is read again.
 */
export function BroadcastGroupList({
  workspaceId,
  broadcastId,
}: {
  workspaceId: string;
  broadcastId: string;
}) {
  const guard = useShellGuard();
  const group = useBroadcastDraftStore((s) => s.group);
  const size = useBroadcastDraftStore((s) =>
    s.draft?.audience.kind === 'group' ? s.draft.audience.size : 0,
  );
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    void useBroadcastDraftStore.getState().loadGroup(guard);
    // the shell's guard is stable per address; the group is read once per draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, broadcastId]);

  const remove = async (row: BroadcastGroupRow) => {
    const id = row.contact.id;
    setFailed(null);
    setRemoving((r) => new Set(r).add(id));
    const store = useBroadcastDraftStore.getState();
    try {
      const answer = await store.removeContact(id, guard);
      if (answer) void store.reread(guard);
    } catch {
      setFailed(contactFullName(row.contact));
    } finally {
      setRemoving((r) => {
        const next = new Set(r);
        next.delete(id);
        return next;
      });
    }
  };

  const closePicker = () => {
    setPicking(false);
    const store = useBroadcastDraftStore.getState();
    void store.loadGroup(guard);
    void store.reread(guard);
  };

  const loading = !group || group.status === 'loading';
  let body: React.ReactNode;
  if (group?.status === 'error')
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load the group
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useBroadcastDraftStore.getState().loadGroup(guard)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (!loading && group.items.length === 0)
    body = <p className="text-sm text-muted-foreground">No contacts in this group yet.</p>;
  else
    body = (
      <Table aria-label="Hand-picked group">
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead className={ON_WIDE}>Tags</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i} data-testid="group-skeleton">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-8 rounded-full" />
                      <div className="flex flex-col gap-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={ON_WIDE}>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="size-8" />
                  </TableCell>
                </TableRow>
              ))
            : group.items.map((row) => (
                <GroupRow
                  key={row.contact.id}
                  row={row}
                  removing={removing.has(row.contact.id)}
                  onRemove={() => void remove(row)}
                />
              ))}
        </TableBody>
      </Table>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {loading ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          <p className="text-sm font-medium">{sizeText(size)}</p>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
          Add contacts
        </Button>
      </div>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{`Couldn't remove ${failed}`}</AlertDescription>
        </Alert>
      ) : null}
      {body}
      {group?.status === 'ready' && group.more === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Couldn&apos;t load more contacts
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void useBroadcastDraftStore.getState().showMoreGroup(guard)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : group?.status === 'ready' && group.hasNext ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={group.more === 'loading'}
            onClick={() => void useBroadcastDraftStore.getState().showMoreGroup(guard)}
          >
            {group.more === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Show more
          </Button>
        </div>
      ) : null}
      {picking ? (
        <GroupPicker
          workspaceId={workspaceId}
          broadcastId={broadcastId}
          open
          onClose={closePicker}
        />
      ) : null}
    </div>
  );
}

function GroupRow({
  row,
  removing,
  onRemove,
}: {
  row: BroadcastGroupRow;
  removing: boolean;
  onRemove: () => void;
}) {
  const { contact } = row;
  const name = contactFullName(contact);
  return (
    <TableRow data-testid={`group-row-${contact.id}`}>
      <TableCell className="whitespace-normal">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{name}</span>
              {contact.blocked_since ? (
                <Badge
                  variant="outline"
                  className="text-destructive"
                  title={`Blocked the bot since ${formatFullDay(contact.blocked_since)}`}
                >
                  Blocked the bot
                </Badge>
              ) : null}
            </div>
            {contact.username ? (
              <span className="truncate text-xs text-muted-foreground">@{contact.username}</span>
            ) : (
              <span className="text-xs text-muted-foreground">no username</span>
            )}
            {/* Stacked under the name on a phone. */}
            <div className="sm:hidden">
              <TagBadges tags={contact.tags} />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className={ON_WIDE}>
        <TagBadges tags={contact.tags} />
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${name} from this group`}
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
        </Button>
      </TableCell>
    </TableRow>
  );
}
