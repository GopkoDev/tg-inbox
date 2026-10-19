import { Loader2 } from 'lucide-react';
import type { ContactRow } from '@tg/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getInboxBotStatus } from '@/features/inbox/api-source';
import { useTagsStore } from '@/features/tags/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { initials } from '@/shared/lib/initials';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { DataTableToolbar } from '@/shared/ui/data-table-toolbar';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { isFiltered, parseAddress, withAddress, type ContactsAddress } from './address';
import { contactFullName, firstWroteText, languageName, lastWrote } from './format';
import { useContactsStore } from './store';
import { TagFilter } from './TagFilter';

const DEBOUNCE_MS = 300;
const TAGS_SHOWN = 3;
const HIDDEN_ON_PHONE = 'hidden md:table-cell';
const NOTICE = 'One of the chosen tags no longer exists, so it was left out of the filter.';

function TagBadges({ tags }: { tags: ContactRow['tags'] }) {
  const shown = tags.slice(0, TAGS_SHOWN);
  const rest = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant="secondary">
          {t.name}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" title={tags.map((t) => t.name).join(', ')}>
          +{rest}
        </Badge>
      ) : null}
    </div>
  );
}

function ContactRowView({ workspaceId, contact }: { workspaceId: string; contact: ContactRow }) {
  const name = contactFullName(contact);
  const last = lastWrote(contact.last_wrote_at);
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <Link
              to={`/w/${workspaceId}/contacts/${contact.id}`}
              className="truncate font-medium hover:underline"
            >
              {name}
            </Link>
            {contact.username ? (
              <span className="truncate text-xs text-muted-foreground">@{contact.username}</span>
            ) : (
              <span className="text-xs text-muted-foreground">no username</span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <TagBadges tags={contact.tags} />
      </TableCell>
      <TableCell className={HIDDEN_ON_PHONE}>{languageName(contact.language_code)}</TableCell>
      <TableCell className={HIDDEN_ON_PHONE}>{firstWroteText(contact.first_wrote_at)}</TableCell>
      <TableCell>
        <span title={last.title}>{last.text}</span>
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <TableRow key={i} data-testid="contact-skeleton">
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16" />
          </TableCell>
          <TableCell className={HIDDEN_ON_PHONE}>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell className={HIDDEN_ON_PHONE}>
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-8" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

const countText = (n: number) => `${n} ${n === 1 ? 'contact' : 'contacts'}`;

/**
 * SCR-18's body: the workspace's real contacts with search, the tag filter, the counts, paging
 * (Show more) and every empty and error state. The search, mode and tag ids live in the address.
 */
export function ContactsTable({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const role = useWorkspaceStore((s) => s.current?.role);
  const [params, setParams] = useSearchParams();
  const { address, canonical } = useMemo(() => parseAddress(params), [params]);
  const list = useContactsStore((s) => s.list);
  const tags = useTagsStore((s) => s.items);
  const [notice, setNotice] = useState(false);
  const [input, setInput] = useState(address.q);
  const [botNotConnected, setBotNotConnected] = useState(false);
  const paramsRef = useRef(params);
  const addressRef = useRef(address);
  useEffect(() => {
    paramsRef.current = params;
    addressRef.current = address;
  });

  /** Writes the view to the address as a history entry (a back press returns to the one before). */
  const write = (next: ContactsAddress) => {
    setNotice(false);
    setParams(withAddress(paramsRef.current, next));
  };

  // What the API would refuse is dropped from the address before any request (no history entry).
  useEffect(() => {
    if (!canonical)
      setParams(withAddress(paramsRef.current, addressRef.current), { replace: true });
  }, [canonical, params, setParams]);

  // The search box follows the address (back button, a saved link); typing writes it back after 300 ms.
  const [seenQ, setSeenQ] = useState(address.q);
  if (address.q !== seenQ) {
    setSeenQ(address.q);
    setInput(address.q);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      const text = input.trim();
      if (text !== addressRef.current.q) write({ ...addressRef.current, q: text });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `write` only reads refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const tagKey = address.tagIds.join(',');
  useEffect(() => {
    void useContactsStore
      .getState()
      .loadList(workspaceId, { q: address.q, mode: address.mode, tagIds: address.tagIds }, guard);
    // the query is the address; `tagKey` stands for the ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, address.q, address.mode, tagKey]);
  useEffect(() => {
    void useTagsStore.getState().load(workspaceId, guard);
    // the shell's guard is stable per address; the list is loaded once per workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  useEffect(() => () => useContactsStore.getState().clearList(), []);

  // A tag the workspace no longer has: left out of the address, and the page says so.
  const missing = list?.status === 'ready' ? list.missingTagIds : [];
  const missingKey = missing.join(',');
  if (missing.length > 0 && !notice) setNotice(true);
  useEffect(() => {
    if (missing.length === 0) return;
    setParams(
      withAddress(paramsRef.current, {
        ...addressRef.current,
        tagIds: addressRef.current.tagIds.filter((t) => !missing.includes(t)),
      }),
      { replace: true },
    );
    // `missingKey` stands for the ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, setParams]);

  const filtered = isFiltered(address);
  const empty = list?.status === 'ready' && list.totalCount === 0 && !filtered;
  // An owner's empty card offers the way to the bot settings only when there is no connected bot.
  useEffect(() => {
    if (!empty || role !== 'owner') return;
    let stopped = false;
    void getInboxBotStatus(workspaceId)
      .then((bot) => !stopped && setBotNotConnected(bot.state === 'not_connected'))
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [empty, role, workspaceId]);

  const clear = () => {
    setInput('');
    write({ q: '', mode: 'any', tagIds: [] });
  };

  if (empty)
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {role === 'owner' && botNotConnected
              ? 'No contacts yet. A contact appears when a customer writes to your business bot.'
              : 'No contacts yet. A contact appears when a customer writes to the business bot.'}
          </p>
          {role === 'owner' && botNotConnected ? (
            <Button asChild>
              <Link to={`/w/${workspaceId}/settings/bot`}>Connect bot</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );

  const loading = !list || list.status === 'loading';
  let count: React.ReactNode;
  if (loading) count = <Skeleton data-testid="count-skeleton" className="h-4 w-24" />;
  else if (list.status === 'ready')
    count = filtered
      ? `${list.matchingCount} of ${countText(list.totalCount)} match`
      : countText(list.totalCount);

  let body: React.ReactNode;
  if (list?.status === 'error')
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load contacts
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void useContactsStore
                .getState()
                .loadList(
                  workspaceId,
                  { q: address.q, mode: address.mode, tagIds: address.tagIds },
                  guard,
                )
            }
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (list?.status === 'ready' && list.matchingCount === 0)
    body = (
      <Card className="py-0">
        <EmptyFilterState
          message="No contacts match your search and filter"
          actionLabel="Clear search and filter"
          onClear={clear}
        />
      </Card>
    );
  else
    body = (
      <>
        <Card className="py-0">
          <Table aria-label="Contacts">
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className={HIDDEN_ON_PHONE}>Language</TableHead>
                <TableHead className={HIDDEN_ON_PHONE}>First wrote</TableHead>
                <TableHead>Last wrote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonRows />
              ) : (
                list.items.map((c) => (
                  <ContactRowView key={c.id} workspaceId={workspaceId} contact={c} />
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        {list?.status === 'ready' && list.more === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              Couldn&apos;t load more contacts
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void useContactsStore.getState().loadMore(workspaceId, guard)}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : list?.status === 'ready' && list.hasNext ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={list.more === 'loading'}
              onClick={() => void useContactsStore.getState().loadMore(workspaceId, guard)}
            >
              {list.more === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Show more
            </Button>
          </div>
        ) : null}
      </>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataTableToolbar
          search={
            <Input
              type="text"
              aria-label="Search by name or username"
              placeholder="Search by name or username"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          }
          filters={
            <TagFilter
              tags={tags}
              mode={address.mode}
              tagIds={address.tagIds}
              onChange={(next) => write({ ...address, ...next })}
            />
          }
        />
        <p className="w-full text-sm text-muted-foreground sm:w-auto" aria-live="polite">
          {count}
        </p>
      </div>
      {notice ? (
        <Alert>
          <AlertDescription>{NOTICE}</AlertDescription>
        </Alert>
      ) : null}
      {body}
    </div>
  );
}
