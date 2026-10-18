import { Check, Loader2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { MemberRef } from '@tg/shared';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Separator } from '@/shared/ui/separator';
import { Skeleton } from '@/shared/ui/skeleton';
import { cn } from '@/shared/lib/utils';
import { listActiveMembers } from './api-source';
import type { ChangeResult } from './store';

type Members = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: MemberRef[] };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('');

/**
 * SCR-10: a popover (not a menu — it must stay open to show the refusal and the re-read members
 * in place). `onPick` runs the change (null = unassign) and returns how it ended; the chooser
 * stays open only for `assignee_not_active`, every other answer closes it.
 */
export function AssigneeChooser({
  workspaceId,
  assigneeId,
  onPick,
  refusal = 0,
  children,
}: {
  workspaceId: string;
  assigneeId: string | null;
  onPick: (assigneeId: string | null, name: string | null) => Promise<ChangeResult>;
  /**
   * Bumped by the owner when a go-ahead from SCR-11 is refused `ASSIGNEE_NOT_ACTIVE`: the chooser
   * opens again in its refused state with the members re-read.
   */
  refusal?: number;
  /** The assignee button; rendered as the popover trigger. */
  children: ReactNode;
}) {
  const me = useAuthStore((s) => s.account);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Members>({ kind: 'loading' });
  const [picking, setPicking] = useState<string | 'unassign' | null>(null);
  const [refused, setRefused] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const reads = useRef(0);

  const fetchMembers = useCallback(() => {
    const read = ++reads.current;
    listActiveMembers(workspaceId)
      .then((answer) => {
        if (read === reads.current) setMembers({ kind: 'ready', items: answer.items });
      })
      .catch(() => {
        if (read === reads.current) setMembers({ kind: 'error' });
      });
  }, [workspaceId]);
  const load = useCallback(() => {
    setMembers({ kind: 'loading' });
    fetchMembers();
  }, [fetchMembers]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setRefused(false);
      load();
    } else reads.current++;
  };

  // Keyboard users land on the first row once the members are in.
  useEffect(() => {
    if (open && members.kind === 'ready')
      list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open, members.kind]);

  // A new refusal from the owner reopens the chooser refused (state adjusted while rendering).
  const [seenRefusal, setSeenRefusal] = useState(refusal);
  if (seenRefusal !== refusal) {
    setSeenRefusal(refusal);
    setOpen(true);
    setRefused(true);
    setMembers({ kind: 'loading' });
  }
  useEffect(() => {
    if (refusal !== 0) fetchMembers();
  }, [refusal, fetchMembers]);

  const pick = async (target: string | null, name: string | null = null) => {
    if (target === assigneeId && target !== null) {
      setOpen(false);
      return;
    }
    setRefused(false);
    setPicking(target ?? 'unassign');
    const result = await onPick(target, name);
    setPicking(null);
    if (result.kind === 'assignee_not_active') {
      setRefused(true);
      load();
    } else setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  const others =
    members.kind === 'ready' ? members.items.filter((m) => m.account_id !== me?.id) : [];
  const busy = picking !== null;

  const memberRow = (account: MemberRef, label: string) => (
    <Button
      key={account.account_id}
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      aria-current={account.account_id === assigneeId ? 'true' : undefined}
      onClick={() => void pick(account.account_id, account.display_name)}
      className="w-full justify-start"
    >
      <Avatar className="size-6">
        <AvatarFallback className="text-xs">{initials(account.display_name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{label}</span>
      {picking === account.account_id ? (
        <Loader2 data-testid="row-spinner" className="ml-auto animate-spin" aria-hidden />
      ) : account.account_id === assigneeId ? (
        <Check data-testid="current-check" className="ml-auto" aria-hidden />
      ) : null}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Assign to"
        className={cn('w-(--radix-popover-trigger-width) min-w-60 p-1 md:w-72')}
      >
        {refused ? (
          <Alert variant="destructive" className="mb-1">
            <AlertDescription>
              A conversation can be assigned only to an active member of this workspace.
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Assign to</p>
        {members.kind === 'error' ? (
          <Alert>
            <AlertDescription className="flex items-center justify-between gap-2">
              Couldn&apos;t load the team
              <Button type="button" size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div
            ref={list}
            data-testid="member-list"
            onKeyDown={onKeyDown}
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          >
            {members.kind === 'loading' ? (
              [0, 1, 2].map((n) => (
                <div
                  key={n}
                  data-testid="member-skeleton"
                  className="flex items-center gap-2 px-2 py-1"
                >
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))
            ) : (
              <>
                {me
                  ? memberRow(
                      { account_id: me.id, display_name: me.display_name },
                      `Me (${me.display_name})`,
                    )
                  : null}
                {others.map((m) => memberRow(m, m.display_name))}
                {assigneeId ? (
                  <>
                    <Separator className="my-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void pick(null)}
                      className="w-full justify-start"
                    >
                      {picking === 'unassign' ? (
                        <Loader2 data-testid="row-spinner" className="animate-spin" aria-hidden />
                      ) : null}
                      Unassign
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
