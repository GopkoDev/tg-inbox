import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { initials } from '@/shared/lib/initials';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { DataTableToolbar } from '@/shared/ui/data-table-toolbar';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { listSampleContacts } from './sample-source';

/** SCR-09 body: contacts table on sample data with search and a tag filter. */
export function ContactsPreview({ workspaceId }: { workspaceId: string }) {
  const contacts = useMemo(() => listSampleContacts(), []);
  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const rows = contacts.filter(
    (c) =>
      (q === '' || c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q)) &&
      (tags.length === 0 || tags.some((t) => c.tags.includes(t))),
  );

  function toggle(tag: string, checked: boolean) {
    setTags((cur) => (checked ? [...cur, tag] : cur.filter((t) => t !== tag)));
  }
  function clear() {
    setQuery('');
    setTags([]);
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTableToolbar
        search={
          <Input
            type="text"
            aria-label="Search by name or username"
            placeholder="Search by name or username"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        filters={
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label={tags.length > 0 ? `Tags ${tags.length}` : undefined}
              >
                Tags
                {tags.length > 0 ? <span>{tags.length}</span> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-56 flex-col gap-2">
              {allTags.map((tag) => (
                <Label key={tag} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={tags.includes(tag)}
                    onCheckedChange={(v) => toggle(tag, v === true)}
                  />
                  {tag}
                </Label>
              ))}
            </PopoverContent>
          </Popover>
        }
      />
      <Card className="py-0">
        {rows.length === 0 ? (
          <EmptyFilterState message="No contacts match" onClear={clear} />
        ) : (
          <Table aria-label="Contacts">
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="hidden md:table-cell">Language</TableHead>
                <TableHead className="hidden md:table-cell">First message</TableHead>
                <TableHead>Last message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <Link
                          to={`/w/${workspaceId}/contacts/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">{c.username}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.language}</TableCell>
                  <TableCell className="hidden md:table-cell">{c.firstMessageAt}</TableCell>
                  <TableCell>{c.lastMessageAt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
