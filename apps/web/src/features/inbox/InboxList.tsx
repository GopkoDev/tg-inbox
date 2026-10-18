import type { Conversation } from '@tg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { ScrollArea } from '@/shared/ui/scroll-area';
import * as source from './api-source';
import { ConversationList, ConversationSkeletons } from './ConversationList';
import { Thread } from './Thread';
import { useInboxStore } from './store';

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 300;

interface Extra {
  rows: Conversation[];
  hasNext: boolean;
  cursor: string | null;
}

const merge = (base: Conversation[], more: Conversation[]) => {
  const seen = new Set(base.map((c) => c.id));
  return [...base, ...more.filter((c) => !seen.has(c.id))];
};

/** A later page's copy of a row is the fresh one: it replaces the copy loaded before. */
const appendPage = (loaded: Conversation[], page: Conversation[]) => {
  const fresh = new Set(page.map((c) => c.id));
  return [...loaded.filter((c) => !fresh.has(c.id)), ...page];
};

/** SCR-01: the list pane (search, notice, rows, states) and the right-pane placeholder. */
export function InboxList() {
  const { workspaceId = '', conversationId } = useParams();
  const isMobile = useIsMobile();
  const role = useWorkspaceStore((s) => s.current?.role);
  const { listStatus, conversations, hasNext, nextCursor, listVersion, bot, lens } =
    useInboxStore();
  const isOwner = role === 'owner';

  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [paged, setMore] = useState<Extra & { version: number }>({
    rows: [],
    hasNext: false,
    cursor: null,
    version: listVersion,
  });
  // Pages loaded beyond an older first page are stale once it is re-read: page again from the
  // new `nextCursor` (a row that slid off the first page shows up there).
  const more: Extra =
    paged.version === listVersion ? paged : { rows: [], hasNext: false, cursor: null };
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [results, setResults] = useState<Extra | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Separate counters: a search never strands a page load, and a page load never drops a search.
  const searchRequest = useRef(0);
  const pageRequest = useRef(0);
  const query = useRef('');
  /** A new query starts paging afresh: a page in flight belongs to the old one. */
  const restartPaging = () => {
    pageRequest.current++;
    setMoreState('idle');
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const text = input.trim();
      if (text !== query.current) restartPaging();
      query.current = text;
      setQ(text);
      if (!text) setResults(null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const assignee = lens.assignee;
  useEffect(() => {
    useInboxStore.getState().setSearching(q !== '');
  }, [q]);

  const search = useCallback(
    (text: string) => {
      const id = ++searchRequest.current;
      source
        .listConversations(workspaceId, { q: text, assignee, limit: PAGE_SIZE })
        .then((page) => {
          // The status lens is set aside while searching; a page for other lenses is a late one.
          if (
            searchRequest.current !== id ||
            page.workspace_id !== workspaceId ||
            page.lens.status !== null ||
            page.lens.assignee !== assignee
          )
            return;
          setSearchError(null);
          setResults({ rows: page.items, hasNext: page.has_next, cursor: page.next_cursor });
        })
        .catch((error: unknown) => {
          useInboxStore.getState().reportGuard(error, workspaceId);
          if (searchRequest.current === id) setSearchError(text);
        });
    },
    [workspaceId, assignee],
  );

  useEffect(() => {
    if (q) search(q);
  }, [q, search]);

  const loadMore = useCallback(() => {
    const filtered = q !== '';
    const cursor = filtered ? results?.cursor : (more.cursor ?? nextCursor);
    if (!cursor || moreState === 'loading') return;
    const id = ++pageRequest.current;
    setMoreState('loading');
    source
      .listConversations(workspaceId, {
        ...(filtered ? { q, assignee: lens.assignee } : lens),
        after: cursor,
        limit: PAGE_SIZE,
      })
      .then((page) => {
        if (
          pageRequest.current !== id ||
          page.workspace_id !== workspaceId ||
          page.lens.status !== (filtered ? null : lens.status) ||
          page.lens.assignee !== lens.assignee
        )
          return;
        if (!filtered && useInboxStore.getState().listVersion !== listVersion) {
          setMoreState('idle');
          return;
        }
        const next = (prev: Extra | null): Extra => ({
          rows: appendPage(prev?.rows ?? [], page.items),
          hasNext: page.has_next,
          cursor: page.next_cursor,
        });
        if (filtered) setResults(next);
        else
          setMore((prev) => ({
            ...next(prev.version === listVersion ? prev : null),
            version: listVersion,
          }));
        setMoreState('idle');
      })
      .catch((error: unknown) => {
        useInboxStore.getState().reportGuard(error, workspaceId);
        if (pageRequest.current === id) setMoreState('error');
      });
  }, [q, results, more.cursor, nextCursor, listVersion, moreState, workspaceId, lens]);

  const filtered = q !== '' && results !== null;
  const rows = filtered ? results.rows : merge(conversations, more.rows);
  const canLoadMore = filtered
    ? results.hasNext
    : more.rows.length > 0 || more.cursor
      ? more.hasNext
      : hasNext;

  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  const watching = canLoadMore && moreState === 'idle' && listStatus === 'ready';
  useEffect(() => {
    const el = sentinel.current;
    if (!watching || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [watching, rows.length]);

  const clearSearch = () => {
    setInput('');
    if (query.current !== '') restartPaging();
    query.current = '';
    setQ('');
    setResults(null);
  };
  const retryFirstPage = () => {
    useInboxStore.getState().leave();
    void useInboxStore.getState().enter(workspaceId, lens);
  };

  const botSettings = (
    <Button asChild variant="link" size="sm" className="h-auto p-0">
      <Link to={`/w/${workspaceId}/settings/bot`}>Open bot settings</Link>
    </Button>
  );

  const noBot = bot?.state === 'not_connected' || bot?.state === 'needs_token';
  const loading = listStatus === 'loading';
  const failed = listStatus === 'error' || (q !== '' && searchError === q);

  let body: React.ReactNode;
  if (loading) body = <ConversationSkeletons count={6} />;
  else if (failed)
    body = (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Something went wrong
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={
                q !== ''
                  ? () => {
                      setSearchError(null);
                      search(q);
                    }
                  : retryFirstPage
              }
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  else if (rows.length === 0 && q !== '' && filtered)
    body = (
      <EmptyFilterState
        message="No conversations match"
        actionLabel="Clear search"
        onClear={clearSearch}
      />
    );
  else if (rows.length === 0 && q === '')
    body = (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <p>No conversations yet. They appear here when customers write to your bot.</p>
        {noBot ? (
          isOwner ? (
            <>
              <p>Connect the bot to start receiving messages.</p>
              {botSettings}
            </>
          ) : (
            <p>Ask a business owner to connect the bot.</p>
          )
        ) : null}
      </div>
    );
  else if (rows.length > 0)
    body = (
      <>
        <ConversationList
          conversations={rows}
          workspaceId={workspaceId}
          selectedId={conversationId}
        />
        {moreState === 'loading' ? <ConversationSkeletons count={2} /> : null}
        {moreState === 'error' ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                Couldn&apos;t load more conversations
                <Button type="button" size="sm" variant="outline" onClick={loadMore}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        <div ref={sentinel} aria-hidden className="h-1" />
      </>
    );
  else body = <ConversationSkeletons count={0} />;

  const listPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      {bot?.state === 'taken_over' ? (
        <div className="border-b p-3">
          <Alert>
            <AlertDescription className="flex flex-col items-start gap-1">
              <p>
                New customer messages are not arriving in tg-inbox. Another service took over the
                bot&apos;s messages.
              </p>
              {isOwner ? botSettings : <p>Ask a business owner to reconnect the bot.</p>}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      <div className="border-b p-3">
        <Input
          aria-label="Search conversations"
          placeholder="Search conversations"
          maxLength={200}
          disabled={loading}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
    </div>
  );

  const rightPane = conversationId ? (
    <Thread key={conversationId} />
  ) : (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
      Pick a conversation to see it here
    </div>
  );

  return (
    <Card className="h-[calc(100svh-11rem)] min-h-96 flex-row gap-0 overflow-hidden py-0">
      {isMobile ? (
        conversationId ? (
          rightPane
        ) : (
          listPane
        )
      ) : (
        <>
          <div className="flex w-80 shrink-0 flex-col border-r">{listPane}</div>
          {rightPane}
        </>
      )}
    </Card>
  );
}
