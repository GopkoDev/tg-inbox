import { compareTagListOrder, tagNameKey, type TagWithCount } from '@tg/shared';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { contactsText, DeleteTagDialog } from './DeleteTagDialog';
import { RenameTagDialog } from './RenameTagDialog';
import { useTagsStore } from './store';

const NO_TAGS: TagWithCount[] = [];

function OwnersOnly({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  return (
    <>
      <h2 className="sr-only">Tags</h2>
      <Card>
        <CardContent className="space-y-4">
          <p>Only a business owner manages the workspace&apos;s tags</p>
          <Button onClick={() => void navigate(`/w/${workspaceId}/inbox`)}>Back to inbox</Button>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * SCR-21: the owner's tag table — every tag with its contact count (a link to the Contacts list
 * filtered by it), Rename and Delete on each row. Not live: read when opened and after each of
 * its own actions. Tags are never created here.
 */
export function TagsSettings({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const items = useTagsStore((s) => (s.workspaceId === workspaceId ? s.items : NO_TAGS));
  const status = useTagsStore((s) => (s.workspaceId === workspaceId ? s.status : 'loading'));
  const [lost, setLost] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TagWithCount | null>(null);
  const [renaming, setRenaming] = useState<TagWithCount | null>(null);

  useEffect(() => {
    if (isOwner) void useTagsStore.getState().load(workspaceId, guard, {});
    // the shell's guard is stable per address; the list is read once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, isOwner]);

  if (!isOwner || lost) return <OwnersOnly workspaceId={workspaceId} />;

  const reread = () => void useTagsStore.getState().load(workspaceId, guard, { background: true });
  const startDelete = (tag: TagWithCount) => {
    setNotice(null);
    setDeleting(tag);
  };
  const startRename = (tag: TagWithCount) => {
    setNotice(null);
    setRenaming(tag);
  };
  /** The list with `changed` in its tag-list place (and `gone` left out), until the re-read. */
  const placed = (changed: TagWithCount, gone: string | null) =>
    [...items.filter((t) => t.id !== changed.id && t.id !== gone), changed].sort((a, b) =>
      compareTagListOrder(
        { name: a.name, key: tagNameKey(a.name) },
        { name: b.name, key: tagNameKey(b.name) },
      ),
    );

  const actions = (tag: TagWithCount) => (
    <>
      <div className="hidden justify-end gap-1 md:flex">
        <Button type="button" variant="ghost" size="sm" onClick={() => startRename(tag)}>
          Rename
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => startDelete(tag)}>
          Delete
        </Button>
      </div>
      <div className="flex justify-end md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${tag.name}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => startRename(tag)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startDelete(tag)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  let body: React.ReactNode;
  if (status === 'error')
    body = (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load the tags
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void useTagsStore.getState().load(workspaceId, guard, {})}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  else if (status !== 'ready')
    body = (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4].map((n) => (
          <div key={n} data-testid="tags-skeleton" className="flex items-center gap-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  else if (items.length === 0)
    body = (
      <p className="text-sm text-muted-foreground">
        No tags yet. Tags are created on a contact, in the inbox or on the profile.
      </p>
    );
  else
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tag</TableHead>
            <TableHead>Contacts</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((tag) => (
            <TableRow key={tag.id}>
              <TableCell className="max-w-48 truncate font-medium">{tag.name}</TableCell>
              <TableCell>
                {tag.contact_count > 0 ? (
                  <Link
                    to={`/w/${workspaceId}/contacts?tag=${tag.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {contactsText(tag.contact_count)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{contactsText(0)}</span>
                )}
              </TableCell>
              <TableCell>{actions(tag)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

  return (
    <>
      <h2 className="sr-only">Tags</h2>
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>
            Every tag of the workspace with the number of contacts carrying it. Tags are created on
            a contact, in the inbox or on the profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {body}
        </CardContent>
      </Card>
      <RenameTagDialog
        workspaceId={workspaceId}
        tag={renaming}
        onClose={() => setRenaming(null)}
        onDone={(answer, tag) => {
          setRenaming(null);
          if (answer.outcome === 'unchanged') return;
          useTagsStore.getState().replace(workspaceId, placed(answer.tag, answer.merged_tag_id));
          if (answer.outcome === 'merged')
            setNotice(`«${tag.name}» merged into «${answer.tag.name}».`);
          reread();
        }}
        onGone={() => {
          setRenaming(null);
          setNotice('This tag no longer exists.');
          reread();
        }}
        onOwnerOnly={() => {
          setRenaming(null);
          setLost(true);
        }}
      />
      <DeleteTagDialog
        workspaceId={workspaceId}
        tag={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(_answer, tag) => {
          setDeleting(null);
          useTagsStore.getState().replace(
            workspaceId,
            items.filter((t) => t.id !== tag.id),
          );
          setNotice(`«${tag.name}» deleted.`);
          reread();
        }}
        onGone={() => {
          setDeleting(null);
          setNotice('This tag no longer exists.');
          reread();
        }}
        onOwnerOnly={() => {
          setDeleting(null);
          setLost(true);
        }}
      />
    </>
  );
}
