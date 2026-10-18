import type { ThreadItem } from '@tg/shared';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { initials } from '@/shared/lib/initials';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import * as source from './api-source';
import { ActivityLine } from './ActivityLine';
import { ConversationActions } from './ConversationActions';
import { contactName } from './ConversationList';
import { MessageBubble } from './MessageBubble';
import { MessageContent } from './MessageContent';
import { ReplyComposer } from './ReplyComposer';
import { ReplyDeliveryState } from './ReplyDeliveryState';
import { useInboxStore } from './store';

const TOP_THRESHOLD = 48;
const BOTTOM_THRESHOLD = 48;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Item({
  item,
  workspaceId,
  contactName,
}: {
  item: ThreadItem;
  workspaceId: string;
  contactName: string;
}) {
  if (item.type === 'activity')
    return <ActivityLine activity={item} at={timeOf(item.position_at)} />;
  if (item.type === 'reply')
    return (
      <MessageBubble
        sender="operator"
        text={item.body}
        at={timeOf(item.sent_at ?? item.position_at)}
        author={item.author.display_name}
        footer={<ReplyDeliveryState reply={item} workspaceId={workspaceId} />}
      />
    );
  const at = timeOf(item.sent_at);
  return (
    <MessageBubble
      sender="customer"
      at={at}
      edited={item.edited_at !== null}
      content={
        <MessageContent
          message={item}
          workspaceId={workspaceId}
          contactName={contactName}
          at={at}
        />
      }
    />
  );
}

function BubbleSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="bubble-skeleton"
          className={i % 2 === 0 ? 'flex justify-start' : 'flex justify-end'}
        >
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
      ))}
    </>
  );
}

/** SCR-02, reading side: header, paged history, live items, read marking and the phone back control. */
export function Thread() {
  const { workspaceId = '', conversationId = '' } = useParams();
  const isMobile = useIsMobile();
  const storeWorkspace = useInboxStore((s) => s.workspaceId);
  const thread = useInboxStore((s) => s.thread);
  const open = thread?.conversationId === conversationId ? thread : null;
  const status = open?.status ?? 'loading';
  const items = open?.items;

  useEffect(() => {
    if (!workspaceId || !conversationId || storeWorkspace !== workspaceId) return;
    void useInboxStore.getState().openThread(workspaceId, conversationId);
    return () => useInboxStore.getState().closeThread();
  }, [workspaceId, conversationId, storeWorkspace]);

  // Read marking: only while the tab is visible; never backwards.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    marked.current = null;
  }, [workspaceId, conversationId]);
  const markThrough = useCallback(
    (through: string | null) => {
      if (!through || document.visibilityState !== 'visible') return;
      if (marked.current !== null && through <= marked.current) return;
      const before = marked.current;
      marked.current = through;
      source
        .markConversationRead(workspaceId, conversationId, through, { background: true })
        .catch(() => {
          if (marked.current === through) marked.current = before;
        });
    },
    [workspaceId, conversationId],
  );
  const readThroughAt = open?.readThroughAt ?? null;
  useEffect(() => {
    if (status === 'ready') markThrough(readThroughAt);
  }, [status, readThroughAt, markThrough]);
  const newestArrival = useRef<string | null>(null);
  useEffect(() => {
    let newest = readThroughAt;
    for (const item of items ?? [])
      if (item.type === 'message' && (newest === null || item.received_at > newest))
        newest = item.received_at;
    newestArrival.current = newest;
  }, [items, readThroughAt]);
  useEffect(() => {
    if (status !== 'ready') return;
    const onVisible = () => markThrough(newestArrival.current);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, markThrough]);

  // Scrolling: stay on the item being read when older history is added; follow new items only
  // from the bottom.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<number | null>(null);
  const firstId = useRef<string | null>(null);
  const lastId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || status !== 'ready' || !items) return;
    const first = items[0]?.id ?? null;
    const last = items.at(-1)?.id ?? null;
    if (anchor.current !== null && first !== firstId.current) {
      el.scrollTop += el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (lastId.current === null || (last !== lastId.current && atBottom.current)) {
      el.scrollTop = el.scrollHeight;
    }
    firstId.current = first;
    lastId.current = last;
  }, [items, status]);
  useEffect(() => {
    firstId.current = null;
    lastId.current = null;
    anchor.current = null;
    atBottom.current = true;
  }, [conversationId]);

  const loadOlder = () => {
    const el = scroller.current;
    anchor.current = el ? el.scrollHeight : null;
    void useInboxStore.getState().loadOlder(workspaceId, conversationId);
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    if (el.scrollTop <= TOP_THRESHOLD && open?.hasPrev && open.older === 'idle') loadOlder();
  };

  if (status === 'not_found') return <NotFoundCard />;

  const contact = open?.contact ?? null;
  const name = contact ? contactName(contact) : '';
  const actions = (
    <ConversationActions
      workspaceId={workspaceId}
      conversationId={conversationId}
      compact={isMobile}
    />
  );
  const showActions = status !== 'error' || !!contact;
  const header = (
    <div className="border-b">
      <div className="flex items-center gap-3 p-3">
        {isMobile ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/w/${workspaceId}/inbox`}>
              <ArrowLeft aria-hidden />
              Back to conversations
            </Link>
          </Button>
        ) : null}
        {status === 'error' && !contact ? null : status === 'loading' || !contact ? (
          <div data-testid="thread-loading" className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <>
            <Avatar>
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{name}</h2>
              {contact.username ? (
                <p className="truncate text-xs text-muted-foreground">@{contact.username}</p>
              ) : null}
            </div>
            {!isMobile && showActions ? <div className="ml-auto">{actions}</div> : null}
          </>
        )}
      </div>
      {isMobile && showActions && contact ? actions : null}
    </div>
  );

  let body: React.ReactNode;
  if (status === 'loading')
    body = (
      <div className="space-y-3 p-3">
        <BubbleSkeletons count={4} />
      </div>
    );
  else if (status === 'error')
    body = (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Something went wrong
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void useInboxStore.getState().openThread(workspaceId, conversationId)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  else if (open)
    body = (
      <div className="space-y-3 p-3">
        {open.older === 'loading' ? (
          <div data-testid="older-loading" className="space-y-3">
            <BubbleSkeletons count={1} />
          </div>
        ) : null}
        {open.older === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              Couldn&apos;t load earlier messages
              <Button type="button" size="sm" variant="outline" onClick={loadOlder}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!open.hasPrev ? (
          <p className="text-center text-xs text-muted-foreground">Start of the conversation</p>
        ) : null}
        {open.items.map((item) => (
          <Item key={item.id} item={item} workspaceId={workspaceId} contactName={name} />
        ))}
      </div>
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      <div
        ref={scroller}
        data-testid="thread-scroll"
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {body}
      </div>
      {status === 'loading' || (status === 'ready' && open) ? (
        <ReplyComposer
          key={`${workspaceId}:${conversationId}`}
          workspaceId={workspaceId}
          conversationId={conversationId}
          disabled={status !== 'ready'}
        />
      ) : null}
    </div>
  );
}
