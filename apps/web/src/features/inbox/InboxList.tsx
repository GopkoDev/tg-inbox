import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ConversationList, ConversationSkeletons } from './ConversationList';
import { Thread } from './Thread';
import { AssigneeLens, StatusLens } from '@tg/shared';
import { withLens, type InboxLens } from './lens';
import { useInboxStore } from './store';

const DEBOUNCE_MS = 300;

const EMPTY_LENS: Record<InboxLens['status'], Record<InboxLens['assignee'], string>> = {
  open: {
    all: 'No open conversations. New ones appear here when customers write to your bot.',
    mine: 'No open conversations are assigned to you.',
    unassigned: 'Every open conversation has an assignee.',
  },
  closed: {
    all: 'No closed conversations.',
    mine: 'No closed conversations are assigned to you.',
    unassigned: 'No closed conversations without an assignee.',
  },
};

/** SCR-01: the list pane (search, notice, rows, states) and the right-pane placeholder. */
export function InboxList() {
  const { workspaceId = '', conversationId } = useParams();
  const isMobile = useIsMobile();
  const role = useWorkspaceStore((s) => s.current?.role);
  // Later pages and search results live in the store too, so live changes and resyncs reach them.
  const { listStatus, conversations, hasNext, nextCursor, bot, lens, results } = useInboxStore();
  const isOwner = role === 'owner';
  const [searchParams, setSearchParams] = useSearchParams();
  /** The lenses live in the address; the page follows it into the store. */
  const written = useRef<string | null>(null);
  useEffect(() => {
    written.current = null;
  }, [searchParams]);
  const chooseLens = (next: Partial<InboxLens>) => {
    const target = withLens(searchParams, { ...lens, ...next });
    // A tap selects a tab twice (pointer down, then focus) before the address is re-read: it is
    // written once.
    const text = target.toString();
    if (text === searchParams.toString() || text === written.current) return;
    written.current = text;
    setSearchParams(target);
  };

  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  /** A page load answering after paging restarted (a new query) leaves the paging state alone. */
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
      if (!text) useInboxStore.getState().clearSearch();
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const assignee = lens.assignee;
  useEffect(() => {
    useInboxStore.getState().setSearching(q !== '');
  }, [q]);

  const search = useCallback(
    (text: string) => void useInboxStore.getState().search(workspaceId, text),
    [workspaceId],
  );
  // A changed assignee lens searches again within it.
  useEffect(() => {
    if (q) search(q);
  }, [q, assignee, search]);
  // The results belong to this pane: they go with it.
  useEffect(() => () => useInboxStore.getState().clearSearch(), []);

  const found = q !== '' && results?.page ? results.page : null;
  const loadMore = useCallback(() => {
    const target = q !== '' ? 'results' : 'list';
    const cursor = target === 'results' ? found?.cursor : nextCursor;
    if (!cursor || moreState === 'loading') return;
    const id = ++pageRequest.current;
    setMoreState('loading');
    void useInboxStore
      .getState()
      .loadMore(workspaceId, target)
      .then((outcome) => {
        if (pageRequest.current === id) setMoreState(outcome === 'error' ? 'error' : 'idle');
      });
  }, [q, found, nextCursor, moreState, workspaceId]);

  const filtered = found !== null;
  const rows = found ? found.rows : conversations;
  const canLoadMore = found ? found.hasNext : hasNext;

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
    useInboxStore.getState().clearSearch();
  };
  // Re-reads the first page in place: the socket and an open thread stay as they are.
  const retryFirstPage = () => void useInboxStore.getState().retryList(workspaceId);

  const botSettings = (
    <Button asChild variant="link" size="sm" className="h-auto p-0">
      <Link to={`/w/${workspaceId}/settings/bot`}>Open bot settings</Link>
    </Button>
  );

  const noBot = bot?.state === 'not_connected' || bot?.state === 'needs_token';
  const loading = listStatus === 'loading';
  const failed =
    listStatus === 'error' || (q !== '' && results?.q === q && results.status === 'error');

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
              onClick={q !== '' ? () => search(q) : retryFirstPage}
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
        <p>{EMPTY_LENS[lens.status][lens.assignee]}</p>
        {noBot && lens.status === 'open' && lens.assignee === 'all' ? (
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
          markClosed={q !== ''}
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
      <div data-testid="lens-controls" className="flex items-start gap-2 border-b p-3">
        <Tabs
          value={lens.status}
          onValueChange={(v) => chooseLens({ status: StatusLens.parse(v) })}
          className="flex-1 gap-1"
        >
          <TabsList className="w-full">
            <TabsTrigger value="open" disabled={q !== ''}>
              Open
            </TabsTrigger>
            <TabsTrigger value="closed" disabled={q !== ''}>
              Closed
            </TabsTrigger>
          </TabsList>
          {q !== '' ? (
            <p className="text-xs text-muted-foreground">Searching open and closed</p>
          ) : null}
        </Tabs>
        <Select
          value={lens.assignee}
          onValueChange={(v) => chooseLens({ assignee: AssigneeLens.parse(v) })}
        >
          <SelectTrigger aria-label="Assignee" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="mine">Mine</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
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
