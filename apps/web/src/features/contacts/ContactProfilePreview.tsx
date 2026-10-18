import { initials } from '@/features/inbox/ConversationList';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { SampleDataBadge } from '@/shared/ui/sample-data-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { SampleContactProfile } from './sample-source';

function TagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-sm text-muted-foreground">No tags</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="secondary">
          {t}
        </Badge>
      ))}
    </div>
  );
}

/** SCR-10 body: header card plus Overview / Conversation history tabs, on sample data. */
export function ContactProfilePreview({ contact }: { contact: SampleContactProfile }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="size-16">
            <AvatarFallback className="text-lg">{initials(contact.name)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{contact.name}</h1>
              <SampleDataBadge />
            </div>
            <span className="text-sm text-muted-foreground">{contact.username}</span>
            <TagBadges tags={contact.tags} />
            <p className="text-sm text-muted-foreground">
              {contact.language} · First message {contact.firstMessageAt} · Last message{' '}
              {contact.lastMessageAt}
            </p>
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="overview">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Conversation history</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Profile facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Language</dt>
                <dd>{contact.language}</dd>
                <dt className="text-muted-foreground">First message</dt>
                <dd>{contact.firstMessageAt}</dd>
                <dt className="text-muted-foreground">Last message</dt>
                <dd>{contact.lastMessageAt}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagBadges tags={contact.tags} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Notes arrive with contacts</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contact.history.map((h) => (
                  <TableRow key={`${h.at}-${h.direction}`}>
                    <TableCell className="whitespace-nowrap">{h.at}</TableCell>
                    <TableCell>{h.direction === 'in' ? 'Received' : 'Sent'}</TableCell>
                    <TableCell className="whitespace-normal">{h.text}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
