import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { ConversationList, initials } from './ConversationList';
import { MessageBubble } from './MessageBubble';
import { ReplyComposer } from './ReplyComposer';
import { getSampleConversation, listSampleConversations } from './sample-source';

type Sent = { id: string; texts: string[] };

/** Reads the sample source only; sent replies live in this component's state (ADR-0002). */
export function InboxPreview() {
  const { workspaceId = '', conversationId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<Sent | null>(null);

  const thread = conversationId ? getSampleConversation(conversationId) : undefined;

  // Derived-state resets while rendering: opening clears unread, a new id drops sent replies.
  if (conversationId && !opened.has(conversationId)) {
    setOpened(new Set(opened).add(conversationId));
  }
  if (sent && sent.id !== conversationId) setSent(null);

  const replies = sent && sent.id === conversationId ? sent.texts : [];

  let conversations = listSampleConversations().map((c) => ({
    ...c,
    unread: opened.has(c.id) || c.id === conversationId ? 0 : c.unread,
  }));
  if (conversationId && replies.length > 0) {
    const last = replies[replies.length - 1]!;
    const idx = conversations.findIndex((c) => c.id === conversationId);
    const [current] = conversations.splice(idx, 1);
    conversations = [{ ...current!, lastMessage: last, at: 'now' }, ...conversations];
  }
  const q = query.trim().toLowerCase();
  const visible = q ? conversations.filter((c) => c.name.toLowerCase().includes(q)) : conversations;

  const listPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-3">
        <Input
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {visible.length > 0 ? (
          <ConversationList
            conversations={visible}
            workspaceId={workspaceId}
            selectedId={conversationId}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-muted-foreground text-sm">No conversations match</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );

  const threadPane = thread ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b p-3">
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void navigate(`/w/${workspaceId}/inbox`)}
            >
              Back to conversations
            </Button>
          ) : null}
          <Avatar>
            <AvatarFallback>{initials(thread.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{thread.name}</p>
            <p className="text-muted-foreground truncate text-xs">{thread.username}</p>
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-4">
            {thread.messages.map((m, i) => (
              <MessageBubble key={i} sender={m.sender} text={m.text} at={m.at} />
            ))}
            {replies.map((text, i) => (
              <MessageBubble key={`r${i}`} sender="operator" text={text} at="now" />
            ))}
          </div>
        </ScrollArea>
      </section>
      <ReplyComposer
        key={thread.id}
        onSend={(text) =>
          setSent((prev) => ({
            id: thread.id,
            texts: [...(prev && prev.id === thread.id ? prev.texts : []), text],
          }))
        }
      />
    </div>
  ) : (
    <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
      Pick a conversation to see it here
    </div>
  );

  return (
    <Card className="h-[calc(100svh-11rem)] min-h-96 flex-row gap-0 overflow-hidden py-0">
      {isMobile ? (
        thread ? (
          threadPane
        ) : (
          listPane
        )
      ) : (
        <>
          <div className="flex w-80 shrink-0 flex-col border-r">{listPane}</div>
          {threadPane}
        </>
      )}
    </Card>
  );
}
