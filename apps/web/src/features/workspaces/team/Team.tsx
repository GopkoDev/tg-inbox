import type { Membership, PendingInvitation, Role } from '@tg/shared';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/features/auth/store';
import { NotFoundCard } from '@/pages/NotFoundPage';
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
import { initials } from '@/shared/lib/initials';
import { ROLE_LABEL } from '@/shared/lib/roles';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { DataTableToolbar } from '@/shared/ui/data-table-toolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { EmptyFilterState } from '@/shared/ui/empty-filter-state';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { InviteDialog } from '../invite/InviteDialog';
import { useWorkspaceStore } from '../store';
import { filterTeam, NO_FILTER, type TeamFilter } from './filter';
import { useTeam } from './useTeam';

type Confirm =
  { kind: 'deactivate'; member: Membership } | { kind: 'revoke'; invite: PendingInvitation };

const NO_MATCH = 'Nothing matches among the loaded rows';

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

function ShowMore({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="outline" disabled={disabled} onClick={onClick}>
      Show more
    </Button>
  );
}

function RowActions({
  email,
  disabled,
  spinning,
  label,
  onSelect,
}: {
  email: string;
  disabled: boolean;
  spinning: boolean;
  label: 'Deactivate' | 'Reactivate' | 'Revoke';
  onSelect: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" disabled={disabled} aria-label={`Actions for ${email}`}>
          {spinning ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onSelect}>{label}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Team mark: plain text, read when Team opens and replaced by each deactivate / reactivate answer. */
const pingsMark = (m: { telegram_pings: boolean }) => (m.telegram_pings ? 'On' : 'Off');

/** SCR-07 body. `onInvite` is the slot T25 fills with the invite dialog. */
export function Team({ workspaceId, onInvite }: { workspaceId: string; onInvite?: () => void }) {
  const team = useTeam(workspaceId);
  const navigate = useNavigate();
  const workspaceName = useWorkspaceStore((s) => s.current?.name) ?? 'this workspace';
  const myEmail = useAuthStore((s) => s.account?.email);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [filter, setFilter] = useState<TeamFilter>(NO_FILTER);
  const { busy } = team;

  if (team.status === 'not-found') return <NotFoundCard headingLevel={2} />;
  if (team.status === 'owner-only') {
    return (
      <>
        <h2 className="sr-only">Team</h2>
        <Card>
          <CardContent className="space-y-4">
            <p>Only business owners manage the team</p>
            <Button onClick={() => void navigate(`/w/${workspaceId}/inbox`)}>Back to inbox</Button>
          </CardContent>
        </Card>
      </>
    );
  }
  if (team.status === 'error') {
    return (
      <>
        <h2 className="sr-only">Team</h2>
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Something went wrong
            <Button size="sm" variant="outline" onClick={team.retry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }
  const loading = team.status === 'loading';
  const filtered = filterTeam(
    { members: team.members.items, invitations: team.invitations.items },
    filter,
  );
  const clear = () => setFilter(NO_FILTER);
  const roleLabel = (role: Role) => ROLE_LABEL[role];

  return (
    <div className="space-y-6">
      {team.notice && (
        <Alert variant={team.notice === 'stale' ? 'default' : 'destructive'}>
          <AlertDescription>{NOTICES[team.notice]}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Team</h2>
        <Button
          onClick={() => {
            onInvite?.();
            setInviteOpen(true);
          }}
        >
          Invite
        </Button>
      </div>

      <DataTableToolbar
        search={
          <Input
            aria-label="Search by name or email"
            placeholder="Search by name or email"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          />
        }
        filters={
          <>
            <Select
              value={filter.role}
              onValueChange={(role) => setFilter({ ...filter, role: role as TeamFilter['role'] })}
            >
              <SelectTrigger aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="owner">Business owner</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filter.state}
              onValueChange={(state) =>
                setFilter({ ...filter, state: state as TeamFilter['state'] })
              }
            >
              <SelectTrigger aria-label="State">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="deactivated">Deactivated</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Members</h3>
        {loading ? (
          <SkeletonRows />
        ) : (
          <>
            <Card className="overflow-hidden p-0">
              {filtered.members.length === 0 ? (
                <EmptyFilterState message={NO_MATCH} onClear={clear} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="hidden md:table-cell">Telegram pings</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback>{initials(m.display_name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div>
                                {m.display_name}
                                {m.email === myEmail && (
                                  <span className="ml-1 text-muted-foreground">(you)</span>
                                )}
                              </div>
                              <div className="truncate text-muted-foreground">{m.email}</div>
                              <div className="text-muted-foreground md:hidden">
                                {`Telegram pings: ${pingsMark(m)}`}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.state === 'active' ? 'default' : 'outline'}>
                            {m.state === 'active' ? 'Active' : 'Deactivated'}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {pingsMark(m)}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.state === 'active' ? (
                            <RowActions
                              email={m.email}
                              label="Deactivate"
                              disabled={busy !== null}
                              spinning={busy?.kind === 'deactivate' && busy.id === m.id}
                              onSelect={() => setConfirm({ kind: 'deactivate', member: m })}
                            />
                          ) : (
                            <RowActions
                              email={m.email}
                              label="Reactivate"
                              disabled={busy !== null}
                              spinning={busy?.kind === 'reactivate' && busy.id === m.id}
                              onSelect={() => void team.reactivate(m.id)}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
            {team.members.next && (
              <ShowMore
                disabled={team.loadingMore.members}
                onClick={() => void team.showMoreMembers()}
              />
            )}
          </>
        )}
      </section>

      <section className="space-y-3" data-testid="pending-invitations">
        <h3 className="text-base font-semibold">Pending invitations</h3>
        {loading ? (
          <SkeletonRows />
        ) : (
          <>
            <Card className="overflow-hidden p-0">
              {team.invitations.items.length === 0 ? (
                <p className="px-6 py-4 text-muted-foreground">No pending invitations</p>
              ) : filtered.invitations.length === 0 ? (
                <EmptyFilterState message={NO_MATCH} onClear={clear} />
              ) : (
                <Table>
                  <TableBody>
                    {filtered.invitations.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>{i.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{roleLabel(i.role)}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          expires {new Date(i.expires_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="w-12 text-right">
                          <RowActions
                            email={i.email}
                            label="Revoke"
                            disabled={busy !== null}
                            spinning={busy?.kind === 'revoke' && busy.id === i.id}
                            onSelect={() => setConfirm({ kind: 'revoke', invite: i })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
            {team.invitations.next && (
              <ShowMore
                disabled={team.loadingMore.invitations}
                onClick={() => void team.showMoreInvitations()}
              />
            )}
          </>
        )}
      </section>

      <InviteDialog
        workspaceId={workspaceId}
        open={inviteOpen}
        onClose={(created) => {
          setInviteOpen(false);
          if (created) void team.refreshInvitations();
        }}
        onFail={(reason) => {
          setInviteOpen(false);
          team.setRefused(reason);
        }}
      />

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
                    ? `Deactivate ${confirm.member.display_name}? ${confirm.member.display_name} loses access to ${workspaceName} at once. Conversations assigned to ${confirm.member.display_name} here become unassigned, and reactivating does not give them back. ${
                        confirm.member.telegram_pings
                          ? `${confirm.member.display_name}'s Telegram pings stop, and reactivating does not turn them back on. `
                          : ''
                      }You can reactivate them later.`
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
