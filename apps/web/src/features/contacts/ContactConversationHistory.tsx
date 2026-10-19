import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MediaGuardContext, type MediaGuard } from '@/features/inbox/media';
import { BubbleSkeletons, ThreadItemView } from '@/features/inbox/ThreadItemView';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { contactFullName } from './format';
import { useContactsStore } from './store';

const TOP_THRESHOLD = 48;
const BOTTOM_THRESHOLD = 48;
const SCROLLER = 'max-h-[60vh] min-h-48 overflow-y-auto';

/**
 * SCR-19's Conversation tab: the contact's conversation exactly as the inbox thread shows it —
 * paged history, live items, media through the viewer — without its two writing parts. It never
 * marks anything read and has no composer (ADR-0006); a reply's delivery state shows without the
 * resend buttons. Answering happens in the inbox, one click away. A media 401 / 403 goes to the
 * shell guard here (the inbox store's guard error is read only by the inbox page).
 */
export function ContactConversationHistory({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const mediaGuard = useMemo<MediaGuard>(
    () => (error, ws) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        void guard(error, ws).catch(() => undefined);
    },
    [guard],
  );
  const conversation = useContactsStore((s) => s.conversation);
  const status = conversation?.status ?? 'loading';
  const thread = conversation?.thread ?? 'loading';
  const items = conversation?.items;
  const name = conversation?.summary ? contactFullName(conversation.summary.contact) : '';
  const conversationId = conversation?.summary?.id ?? null;
  const ready = status === 'ready' && thread === 'ready' && !!conversation;

  // Scrolling: scrolled to the end on open, stay on the item being read when older history is
  // added, follow new items only from the bottom.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<number | null>(null);
  const firstId = useRef<string | null>(null);
  const lastId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !ready || !items) return;
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
  }, [items, ready]);
  useEffect(() => {
    firstId.current = null;
    lastId.current = null;
    anchor.current = null;
    atBottom.current = true;
  }, [conversationId]);

  const loadOlder = useCallback(() => {
    const el = scroller.current;
    anchor.current = el ? el.scrollHeight : null;
    void useContactsStore.getState().loadOlder(workspaceId, guard);
  }, [workspaceId, guard]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !conversation) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    if (el.scrollTop <= TOP_THRESHOLD && conversation.hasPrev && conversation.older === 'idle')
      loadOlder();
  };

  if (status === 'none')
    return (
      <Card data-testid="history-scroll-none" className="py-0">
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No conversation to show
        </p>
      </Card>
    );
  if (status === 'error' || thread === 'error')
    return (
      <Alert variant="destructive" data-testid="history-error">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load the conversation
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useContactsStore.getState().retryConversation(workspaceId, guard)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );

  let body: React.ReactNode;
  if (!ready)
    body = (
      <div className="space-y-3 p-3">
        <BubbleSkeletons count={4} />
      </div>
    );
  else if (conversation.items.length === 0 && !conversation.hasPrev)
    body = (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">No messages to show</p>
    );
  else
    body = (
      <div className="space-y-3 p-3">
        {conversation.older === 'loading' ? (
          <div data-testid="older-loading" className="space-y-3">
            <BubbleSkeletons count={1} />
          </div>
        ) : null}
        {conversation.older === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              Couldn&apos;t load earlier messages
              <Button type="button" size="sm" variant="outline" onClick={loadOlder}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!conversation.hasPrev ? (
          <p className="text-center text-xs text-muted-foreground">Start of the conversation</p>
        ) : null}
        {conversation.items.map((item) => (
          <ThreadItemView
            key={item.id}
            item={item}
            workspaceId={workspaceId}
            contactName={name}
            readOnly
          />
        ))}
      </div>
    );

  return (
    <MediaGuardContext.Provider value={mediaGuard}>
      <Card className="py-0">
        <div ref={scroller} data-testid="history-scroll" onScroll={onScroll} className={SCROLLER}>
          {body}
        </div>
      </Card>
    </MediaGuardContext.Provider>
  );
}
