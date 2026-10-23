import type { ContactProfile as ContactProfileDto, ConversationSummary } from '@tg/shared';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { formatBotClock, formatBotDay } from '@/features/bot/settings/format';
import { TagControl } from '@/features/tags/TagControl';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { initials } from '@/shared/lib/initials';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ContactConversationHistory } from './ContactConversationHistory';
import { agoText, contactFullName, formatFullDay, languageName } from './format';
import { useContactsStore } from './store';
import { TagHistoryList } from './TagHistoryList';

function factsLine(c: ContactProfileDto): string {
  const first = c.first_wrote_at ? formatFullDay(c.first_wrote_at) : 'Never';
  const last = c.last_wrote_at ? agoText(c.last_wrote_at) : 'Never';
  return `${languageName(c.language_code)} · First wrote ${first} · Last wrote ${last}`;
}

const addedTitle = (t: ContactProfileDto['tags'][number]) =>
  `Added by ${t.added_by.display_name}, ${formatBotDay(t.added_at)}, ${formatBotClock(t.added_at)}`;

function HeaderCard({ workspaceId, contact }: { workspaceId: string; contact: ContactProfileDto }) {
  const name = contactFullName(contact);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar className="size-16">
          <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold break-words">{name}</h1>
          {contact.username ? (
            <span className="text-sm text-muted-foreground">@{contact.username}</span>
          ) : (
            <span className="text-sm text-muted-foreground">no username</span>
          )}
          <p className="text-sm text-muted-foreground">{factsLine(contact)}</p>
          <div className="flex flex-wrap items-center gap-1">
            {contact.tags.length === 0 ? (
              <span className="text-sm text-muted-foreground">No tags</span>
            ) : (
              contact.tags.map((t) => (
                <Badge key={t.id} variant="secondary" title={addedTitle(t)}>
                  {t.name}
                </Badge>
              ))
            )}
            <TagControl
              workspaceId={workspaceId}
              contactId={contact.id}
              tags={contact.tags}
              source="profile"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <Card data-testid="profile-skeleton">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-64" />
        </div>
      </CardContent>
    </Card>
  );
}

function ConversationCard({
  workspaceId,
  conversation,
}: {
  workspaceId: string;
  conversation: { status: string; summary: ConversationSummary | null };
}) {
  const guard = useShellGuard();
  const { status, summary } = conversation;
  let body: React.ReactNode;
  if (status === 'loading')
    body = (
      <div data-testid="conversation-skeleton" className="flex items-center gap-2">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  else if (status === 'error')
    body = (
      <Alert variant="destructive" className="w-full">
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
  else if (status === 'none' || !summary)
    body = <p className="text-sm text-muted-foreground">No conversation to show</p>;
  else
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Conversation</span>
          <Badge variant={summary.status === 'closed' ? 'secondary' : 'outline'}>
            {summary.status === 'closed' ? 'Closed' : 'Open'}
          </Badge>
          <span className="text-muted-foreground">
            {summary.assignee ? `Assigned to ${summary.assignee.display_name}` : 'Unassigned'}
          </span>
          {summary.waiting_for_reply ? (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="text-muted-foreground">Waiting for a reply</span>
            </>
          ) : null}
        </div>
        <Button asChild variant="outline" className="w-full sm:ml-auto sm:w-auto">
          <Link to={`/w/${workspaceId}/inbox/${summary.id}`}>Open in inbox</Link>
        </Button>
      </>
    );
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">{body}</CardContent>
    </Card>
  );
}

/**
 * SCR-19: a contact's profile — facts and tags, where their conversation stands, the read-only
 * history and the tag history. Follows the workspace's live frames while open; reading here never
 * marks anything read (ADR-0006).
 */
export function ContactProfile({
  workspaceId,
  contactId,
}: {
  workspaceId: string;
  contactId: string;
}) {
  const guard = useShellGuard();
  const profile = useContactsStore((s) => (s.profile?.contactId === contactId ? s.profile : null));
  const conversation = useContactsStore((s) =>
    s.conversation?.contactId === contactId ? s.conversation : null,
  );

  useEffect(() => {
    const store = useContactsStore.getState();
    void store.openProfile(workspaceId, contactId, guard);
    const stop = store.watch(workspaceId, guard);
    return () => {
      stop();
      useContactsStore.getState().closeProfile();
    };
    // the guard is stable per address; the profile is opened once per contact
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, contactId]);

  if (profile?.status === 'not_found') return <NotFoundCard headingLevel={1} />;

  let header: React.ReactNode;
  if (!profile || profile.status === 'loading') header = <HeaderSkeleton />;
  else if (profile.status === 'error' || !profile.contact)
    header = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load this contact
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useContactsStore.getState().retryContact(workspaceId, guard)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  else header = <HeaderCard workspaceId={workspaceId} contact={profile.contact} />;

  return (
    <div className="flex flex-col gap-4">
      {header}
      <ConversationCard
        workspaceId={workspaceId}
        conversation={conversation ?? { status: 'loading', summary: null }}
      />
      <Tabs defaultValue="conversation">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="tag-history">Tag history</TabsTrigger>
        </TabsList>
        <TabsContent value="conversation">
          <ContactConversationHistory workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="tag-history">
          <TagHistoryList workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
