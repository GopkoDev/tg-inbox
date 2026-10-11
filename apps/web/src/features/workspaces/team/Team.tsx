import type { Membership, PendingInvitation } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/features/auth/store';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { useWorkspaceStore } from '../store';
import { useTeam } from './useTeam';

type Confirm =
  { kind: 'deactivate'; member: Membership } | { kind: 'revoke'; invite: PendingInvitation };

const NOTICES = {
  'last-owner': 'A workspace must always have at least one active business owner',
  stale: 'This item has changed — the list was refreshed',
  error: 'Something went wrong',
} as const;

function SkeletonRows() {
  return (
    <div className="space-y-2" data-testid="team-skeleton">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function ShowMore({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      Show more
    </Button>
  );
}

function RowButton({
  label,
  spinning,
  disabled,
  onClick,
}: {
  label: string;
  spinning: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}>
      {spinning && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

/** SCR-07 body. `onInvite` is the slot T25 fills with the invite dialog. */
export function Team({ workspaceId, onInvite }: { workspaceId: string; onInvite?: () => void }) {
  const team = useTeam(workspaceId);
  const navigate = useNavigate();
  const workspaceName = useWorkspaceStore((s) => s.current?.name) ?? 'this workspace';
  const myEmail = useAuthStore((s) => s.account?.email);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { busy } = team;

  if (team.status === 'not-found') return <NotFoundPage />;
  if (team.status === 'owner-only') {
    return (
      <Card>
        <CardContent className="space-y-4">
          <p>Only business owners manage the team</p>
          <Button onClick={() => void navigate(`/w/${workspaceId}`)}>Back to home</Button>
        </CardContent>
      </Card>
    );
  }
  if (team.status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Something went wrong
          <Button size="sm" variant="outline" onClick={team.retry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const loading = team.status === 'loading';

  return (
    <div className="space-y-8">
      {team.notice && (
        <Alert variant={team.notice === 'stale' ? 'default' : 'destructive'}>
          <AlertDescription>{NOTICES[team.notice]}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Members</h2>
          <Button onClick={onInvite}>Invite</Button>
        </div>
        {loading ? (
          <SkeletonRows />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden md:table-cell">Role</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.members.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div>
                        {m.display_name}
                        {m.email === myEmail && (
                          <span className="ml-1 text-muted-foreground">(you)</span>
                        )}
                      </div>
                      <div className="text-muted-foreground md:hidden">
                        {m.email} · {m.role}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{m.email}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary">{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.state === 'active' ? 'default' : 'outline'}>
                        {m.state === 'active' ? 'Active' : 'Deactivated'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.state === 'active' ? (
                        <RowButton
                          label="Deactivate"
                          disabled={busy !== null}
                          spinning={busy?.kind === 'deactivate' && busy.id === m.id}
                          onClick={() => setConfirm({ kind: 'deactivate', member: m })}
                        />
                      ) : (
                        <RowButton
                          label="Reactivate"
                          disabled={busy !== null}
                          spinning={busy?.kind === 'reactivate' && busy.id === m.id}
                          onClick={() => void team.reactivate(m.id)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {team.members.next && <ShowMore onClick={() => void team.showMoreMembers()} />}
          </>
        )}
      </section>

      <section className="space-y-3" data-testid="pending-invitations">
        <h2 className="text-lg font-semibold">Pending invitations</h2>
        {loading ? (
          <SkeletonRows />
        ) : (
          <>
            <Table>
              <TableBody>
                {team.invitations.items.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No pending invitations</TableCell>
                  </TableRow>
                )}
                {team.invitations.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div>{i.email}</div>
                      <div className="text-muted-foreground md:hidden">{i.role}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary">{i.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      expires {new Date(i.expires_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowButton
                        label="Revoke"
                        disabled={busy !== null}
                        spinning={busy?.kind === 'revoke' && busy.id === i.id}
                        onClick={() => setConfirm({ kind: 'revoke', invite: i })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {team.invitations.next && <ShowMore onClick={() => void team.showMoreInvitations()} />}
          </>
        )}
      </section>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm.kind === 'deactivate' ? 'Deactivate member' : 'Revoke invitation'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm.kind === 'deactivate'
                    ? `Deactivate ${confirm.member.display_name}? ${confirm.member.display_name} loses access to ${workspaceName} at once. You can reactivate them later.`
                    : `Revoke the invitation for ${confirm.invite.email}? Its link stops working.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (confirm.kind === 'deactivate') void team.deactivate(confirm.member.id);
                    else void team.revoke(confirm.invite.id);
                  }}
                >
                  {confirm.kind === 'deactivate' ? 'Deactivate' : 'Revoke'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
