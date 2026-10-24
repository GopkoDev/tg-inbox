import {
  ErrorCode,
  type BroadcastGroupMatching,
  type ContactRow,
  type TagFilterMode,
} from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listContacts } from '@/features/contacts/api';
import { MAX_SEARCH_LENGTH, searchText } from '@/features/contacts/address';
import { contactFullName, formatFullDay } from '@/features/contacts/format';
import { TagFilter } from '@/features/contacts/TagFilter';
import { useTagsStore } from '@/features/tags/store';
import { ApiError } from '@/shared/api/client';
import { initials } from '@/shared/lib/initials';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { DataTableToolbar } from '@/shared/ui/data-table-toolbar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Skeleton } from '@/shared/ui/skeleton';
import { countBroadcastGroupMatching, getBroadcastGroupMembership } from './api';
import { formatCount } from './AudienceBreakdown';
import { useBroadcastDraftStore } from './draft-store';
import { TagBadges } from './tag-badges';

const DEBOUNCE_MS = 300;
const ALREADY_MS = 3_000;
const NOTICE = 'One of the chosen tags no longer exists, so it was left out of the filter.';
const GONE = 'This contact is no longer available.';

interface Filter {
  q: string;
  mode: TagFilterMode;
  tagIds: string[];
}

type RowState = 'adding' | 'already' | 'failed';

interface Page {
  status: 'loading' | 'ready' | 'error';
  items: ContactRow[];
  hasNext: boolean;
  nextCursor: string | null;
  matchingCount: number;
  totalCount: number;
  more: 'idle' | 'loading' | 'error';
}

type Footer =
  | { step: 'idle' }
  | { step: 'confirm'; count: number }
  | { step: 'adding'; count: number }
  | { step: 'too_large'; canAdd: number };

const contactsText = (n: number) => `${formatCount(n)} ${n === 1 ? 'contact' : 'contacts'}`;

/** «… at most 10 000 contacts — 10 more can be added.» (`can_add`; «no more» at 0). */
export const tooLargeText = (canAdd: number) =>
  `A broadcast's audience can hold at most 10 000 contacts — ${
    canAdd === 0 ? 'no more can be added.' : `${formatCount(canAdd)} more can be added.`
  }`;

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : null);
/** A teammate switched the draft to tags or launched it: the picker has nothing left to do. */
const draftGone = (error: unknown) =>
  codeOf(error) === ErrorCode.BROADCAST_DRAFT_CHANGED ||
  codeOf(error) === ErrorCode.BROADCAST_NOT_A_DRAFT;

/**
 * SCR-26: the Contacts list read inside a large dialog (screens.md Decision 8) — the same search
 * (300 ms) and tag filter, so matching and counts are the Contacts list's (AC-04); each row marks
 * whether the contact is in this draft's group, adds one at a time, and the footer adds all matching
 * in two steps against the count it showed. Writes go through the draft store's group chain.
 */
export function GroupPicker({
  workspaceId,
  broadcastId,
  open,
  onClose,
}: {
  workspaceId: string;
  broadcastId: string;
  open: boolean;
  onClose: () => void;
}) {
  const guard = useShellGuard();
  const tags = useTagsStore((s) => s.items);
  const tagsStatus = useTagsStore((s) => s.status);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<Filter>({ q: '', mode: 'any', tagIds: [] });
  const [page, setPage] = useState<Page>({
    status: 'loading',
    items: [],
    hasNext: false,
    nextCursor: null,
    matchingCount: 0,
    totalCount: 0,
    more: 'idle',
  });
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [matching, setMatching] = useState<BroadcastGroupMatching | null>(null);
  const [footer, setFooter] = useState<Footer>({ step: 'idle' });
  const [result, setResult] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [gone, setGone] = useState(false);
  /** Counts every read of the first page: late answers of an earlier filter are dropped. */
  const readId = useRef(0);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  const fail = useCallback(
    (error: unknown) => {
      if (isGuardAnswer(error)) void guard(error, workspaceId);
    },
    [guard, workspaceId],
  );

  const readMembership = useCallback(
    async (ids: string[], read: number) => {
      if (ids.length === 0) return;
      try {
        const answer = await getBroadcastGroupMembership(workspaceId, broadcastId, ids);
        if (read !== readId.current) return;
        setMembers((m) => {
          const next = new Set(m);
          for (const id of ids) next.delete(id);
          for (const id of answer.contact_ids) next.add(id);
          return next;
        });
      } catch (error) {
        fail(error);
      }
    },
    [workspaceId, broadcastId, fail],
  );

  const readMatching = useCallback(
    async (f: Filter, read: number) => {
      try {
        const answer = await countBroadcastGroupMatching(workspaceId, broadcastId, {
          q: f.q,
          mode: f.mode,
          tag: f.tagIds,
        });
        if (read === readId.current) setMatching(answer);
      } catch (error) {
        if (draftGone(error)) onClose();
        else fail(error);
      }
    },
    [workspaceId, broadcastId, fail, onClose],
  );

  /** The first page for the filter, then its membership marks and the matching count. */
  const readFirst = useCallback(
    async (f: Filter, background = false) => {
      const read = ++readId.current;
      if (!background) setPage((p) => ({ ...p, status: 'loading', items: [], more: 'idle' }));
      setMatching(null);
      setFooter({ step: 'idle' });
      try {
        const answer = await listContacts(workspaceId, { q: f.q, mode: f.mode, tag: f.tagIds });
        if (read !== readId.current) return;
        setPage({
          status: 'ready',
          items: answer.items,
          hasNext: answer.has_next,
          nextCursor: answer.next_cursor,
          matchingCount: answer.matching_count,
          totalCount: answer.total_count,
          more: 'idle',
        });
        setMissing(answer.missing_tag_ids.length > 0);
        void readMembership(
          answer.items.map((c) => c.id),
          read,
        );
        void readMatching(f, read);
      } catch (error) {
        if (read !== readId.current) return;
        fail(error);
        setPage((p) => ({ ...p, status: 'error' }));
      }
    },
    [workspaceId, readMembership, readMatching, fail],
  );

  const tagKey = filter.tagIds.join(',');
  useEffect(() => {
    if (!open) return;
    void readFirst(filterRef.current);
    // the filter is (q, mode, tag ids); `tagKey` stands for the ids
  }, [open, filter.q, filter.mode, tagKey, readFirst]);

  useEffect(() => {
    if (!open) return;
    void useTagsStore.getState().load(workspaceId, guard);
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  // The search box writes the filter after a 300 ms pause, cleaned like the Contacts address.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = searchText(input);
      if (q !== filterRef.current.q) setFilter((f) => ({ ...f, q }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const showMore = async () => {
    if (!page.nextCursor || page.more === 'loading') return;
    const read = readId.current;
    const f = filterRef.current;
    setPage((p) => ({ ...p, more: 'loading' }));
    try {
      const answer = await listContacts(workspaceId, {
        q: f.q,
        mode: f.mode,
        tag: f.tagIds,
        after: page.nextCursor,
      });
      if (read !== readId.current) return;
      setPage((p) => ({
        ...p,
        items: [...p.items, ...answer.items],
        hasNext: answer.has_next,
        nextCursor: answer.next_cursor,
        more: 'idle',
      }));
      void readMembership(
        answer.items.map((c) => c.id),
        read,
      );
    } catch (error) {
      if (read !== readId.current) return;
      fail(error);
      setPage((p) => ({ ...p, more: 'error' }));
    }
  };

  const setRow = (contactId: string, state: RowState | null) =>
    setRows((r) => {
      const next = { ...r };
      if (state) next[contactId] = state;
      else delete next[contactId];
      return next;
    });

  const addOne = async (contactId: string) => {
    setRow(contactId, 'adding');
    setGone(false);
    try {
      const answer = await useBroadcastDraftStore.getState().addContact(contactId, guard);
      if (!answer) {
        // launched meanwhile: the editor shows the read-only page
        onClose();
        return;
      }
      setMembers((m) => new Set(m).add(contactId));
      if (answer.outcome === 'unchanged') {
        setRow(contactId, 'already');
        setTimeout(
          () => setRows((r) => (r[contactId] === 'already' ? omit(r, contactId) : r)),
          ALREADY_MS,
        );
      } else setRow(contactId, null);
      void readMatching(filterRef.current, readId.current);
    } catch (error) {
      if (draftGone(error)) {
        onClose();
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setRow(contactId, null);
        setGone(true);
        void readFirst(filterRef.current, true);
        return;
      }
      setRow(contactId, isGuardAnswer(error) ? null : 'failed');
    }
  };

  const askAll = () => {
    if (!matching) return;
    setResult(null);
    if (matching.to_add_count > matching.can_add)
      setFooter({ step: 'too_large', canAdd: matching.can_add });
    else setFooter({ step: 'confirm', count: matching.to_add_count });
  };

  const addAll = async (count: number) => {
    const f = filterRef.current;
    setFooter({ step: 'adding', count });
    try {
      const answer = await useBroadcastDraftStore.getState().addMatching(
        {
          q: f.q === '' ? null : f.q,
          mode: f.mode,
          tag_ids: f.mode === 'none' ? [] : f.tagIds,
          expected_count: count,
        },
        guard,
      );
      if (!answer) {
        onClose();
        return;
      }
      setResult(
        answer.added_count === answer.expected_count
          ? `${contactsText(answer.added_count)} added.`
          : `The matching contacts changed — ${formatCount(answer.added_count)} were added.`,
      );
      setFooter({ step: 'idle' });
      void readFirst(f, true);
    } catch (error) {
      if (draftGone(error)) {
        onClose();
        return;
      }
      if (codeOf(error) === ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE) {
        const canAdd = (error as ApiError & { details?: { can_add?: number } }).details?.can_add;
        setFooter({ step: 'too_large', canAdd: canAdd ?? 0 });
        return;
      }
      fail(error);
      setFooter({ step: 'idle' });
      setResult("Couldn't add the matching contacts");
    }
  };

  const clear = () => {
    setInput('');
    setFilter({ q: '', mode: 'any', tagIds: [] });
  };

  const filtered = filter.q !== '' || filter.mode === 'none' || filter.tagIds.length > 0;
  const empty = page.status === 'ready' && page.totalCount === 0;
  const loading = page.status === 'loading';

  let count: React.ReactNode = null;
  if (loading) count = <Skeleton className="h-4 w-24" />;
  else if (page.status === 'ready' && !empty)
    count = filtered
      ? `${formatCount(page.matchingCount)} of ${contactsText(page.totalCount)} match`
      : contactsText(page.totalCount);

  let body: React.ReactNode;
  if (page.status === 'error')
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load contacts
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void readFirst(filterRef.current)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (empty)
    body = (
      <p className="px-2 py-10 text-center text-sm text-muted-foreground">
        No contacts yet. A contact appears when a customer writes to the business bot.
      </p>
    );
  else if (page.status === 'ready' && page.matchingCount === 0)
    body = (
      <EmptyFilterState
        message="No contacts match your search and filter"
        actionLabel="Clear search and filter"
        onClear={clear}
      />
    );
  else
    body = (
      <ul className="flex flex-col divide-y" aria-label="Contacts">
        {loading
          ? Array.from({ length: 8 }, (_, i) => (
              <li key={i} data-testid="picker-skeleton" className="flex items-center gap-3 py-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-8 w-14" />
              </li>
            ))
          : page.items.map((c) => (
              <PickerRow
                key={c.id}
                contact={c}
                inGroup={members.has(c.id)}
                state={rows[c.id] ?? null}
                onAdd={() => void addOne(c.id)}
              />
            ))}
      </ul>
    );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-4 rounded-none sm:h-auto sm:max-h-[85vh] sm:max-w-3xl sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Add contacts</DialogTitle>
          <DialogDescription>
            Search and filter as on the Contacts list, then add contacts to this group.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DataTableToolbar
            search={
              <Input
                type="text"
                aria-label="Search by name or username"
                placeholder="Search by name or username"
                maxLength={MAX_SEARCH_LENGTH}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            }
            filters={
              <TagFilter
                tags={tags}
                status={tagsStatus}
                onRetry={() => void useTagsStore.getState().load(workspaceId, guard)}
                mode={filter.mode}
                tagIds={filter.tagIds}
                onChange={(next) => setFilter((f) => ({ ...f, ...next }))}
              />
            }
          />
          <p className="w-full text-sm text-muted-foreground sm:w-auto" aria-live="polite">
            {count}
          </p>
        </div>
        {missing ? (
          <Alert>
            <AlertDescription>{NOTICE}</AlertDescription>
          </Alert>
        ) : null}
        {gone ? (
          <Alert>
            <AlertDescription>{GONE}</AlertDescription>
          </Alert>
        ) : null}
        <ScrollArea className="min-h-0 flex-1 sm:max-h-[50vh]">
          {body}
          {page.status === 'ready' && page.more === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                Couldn&apos;t load more contacts
                <Button type="button" size="sm" variant="outline" onClick={() => void showMore()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : page.status === 'ready' && page.hasNext ? (
            <div className="flex justify-center py-2">
              <Button
                type="button"
                variant="outline"
                disabled={page.more === 'loading'}
                onClick={() => void showMore()}
              >
                {page.more === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Show more
              </Button>
            </div>
          ) : null}
        </ScrollArea>
        {result ? (
          <p className="text-sm" aria-live="polite">
            {result}
          </p>
        ) : null}
        {footer.step === 'too_large' ? (
          <Alert variant="destructive">
            <AlertDescription>{tooLargeText(footer.canAdd)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {footer.step === 'confirm' || footer.step === 'adding' ? (
            <>
              <p className="text-sm sm:mr-auto">
                {`Add ${contactsText(footer.count)} to this group?`}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={footer.step === 'adding'}
                onClick={() => setFooter({ step: 'idle' })}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={footer.step === 'adding'}
                onClick={() => void addAll(footer.count)}
              >
                {footer.step === 'adding' ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {`Add ${formatCount(footer.count)}`}
              </Button>
            </>
          ) : (
            <>
              {matching && matching.to_add_count > 0 ? (
                <Button type="button" variant="outline" className="sm:mr-auto" onClick={askAll}>
                  {`Add all matching (${formatCount(matching.to_add_count)})`}
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function PickerRow({
  contact,
  inGroup,
  state,
  onAdd,
}: {
  contact: ContactRow;
  inGroup: boolean;
  state: RowState | null;
  onAdd: () => void;
}) {
  const name = contactFullName(contact);
  let action: React.ReactNode;
  if (state === 'adding')
    action = (
      <Button type="button" variant="ghost" size="sm" disabled aria-label={`Adding ${name}`}>
        <Loader2 data-testid="add-spinner" className="animate-spin" aria-hidden />
      </Button>
    );
  else if (state === 'failed')
    action = (
      <span className="flex items-center gap-2 text-sm text-destructive">
        Couldn&apos;t add
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          Retry
        </Button>
      </span>
    );
  else if (inGroup)
    action = (
      <span className="flex flex-col items-end text-sm text-muted-foreground">
        In group ✓
        {state === 'already' ? <span className="text-xs">Already in this group</span> : null}
      </span>
    );
  else
    action = (
      <Button type="button" variant="ghost" size="sm" aria-label={`Add ${name}`} onClick={onAdd}>
        Add
      </Button>
    );
  return (
    <li data-testid={`picker-row-${contact.id}`} className="flex items-center gap-3 py-2">
      <Avatar>
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        <TagBadges tags={contact.tags} />
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}
