import type { Membership, PendingInvitation } from '@tg/shared';
import { ErrorCode } from '@tg/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/shared/api/client';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import {
  deactivateMembership,
  listMemberships,
  listPendingInvitations,
  reactivateMembership,
  revokeInvitation,
} from '../api';

export type TeamStatus = 'loading' | 'ready' | 'error' | 'owner-only' | 'not-found';
export type TeamNotice = 'last-owner' | 'stale' | 'error' | null;
export interface BusyAction {
  kind: 'deactivate' | 'reactivate' | 'revoke';
  id: string;
}
interface Paged<T> {
  items: T[];
  next: string | null;
}

const isApi = (error: unknown, status: number, code: ErrorCode): boolean =>
  error instanceof ApiError && error.status === status && error.code === code;

/** SCR-07 data + actions: both lists, paging, row actions and the error mapping. */
export function useTeam(workspaceId: string) {
  const guard = useShellGuard();
  const [status, setStatus] = useState<TeamStatus>('loading');
  const [members, setMembers] = useState<Paged<Membership>>({ items: [], next: null });
  const [invitations, setInvitations] = useState<Paged<PendingInvitation>>({
    items: [],
    next: null,
  });
  const [notice, setNotice] = useState<TeamNotice>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Routes a failure: owners-only, shared guard, or the given fallback. */
  const fail = useCallback(
    async (error: unknown, fallback: () => void) => {
      if (isApi(error, 403, ErrorCode.OWNER_ONLY)) return setStatus('owner-only');
      try {
        if ((await guard(error, workspaceId)) === 'not-found') setStatus('not-found');
      } catch {
        fallback();
      }
    },
    [guard, workspaceId],
  );

  useEffect(() => {
    let live = true;
    Promise.all([
      listMemberships(workspaceId, undefined),
      listPendingInvitations(workspaceId, undefined),
    ]).then(
      ([m, i]) => {
        if (!live) return;
        setMembers({ items: m.items, next: m.has_next ? m.next_cursor : null });
        setInvitations({ items: i.items, next: i.has_next ? i.next_cursor : null });
        setStatus('ready');
      },
      (error: unknown) => {
        if (live) void fail(error, () => setStatus('error'));
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, fail, attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  };

  const showMoreMembers = async () => {
    if (!members.next) return;
    try {
      const page = await listMemberships(workspaceId, members.next);
      setMembers((p) => ({
        items: [...p.items, ...page.items],
        next: page.has_next ? page.next_cursor : null,
      }));
    } catch (error) {
      await fail(error, () => setNotice('error'));
    }
  };

  const showMoreInvitations = async () => {
    if (!invitations.next) return;
    try {
      const page = await listPendingInvitations(workspaceId, invitations.next);
      setInvitations((p) => ({
        items: [...p.items, ...page.items],
        next: page.has_next ? page.next_cursor : null,
      }));
    } catch (error) {
      await fail(error, () => setNotice('error'));
    }
  };

  const run = async (action: BusyAction, call: () => Promise<void>) => {
    setBusy(action);
    setNotice(null);
    try {
      await call();
    } catch (error) {
      if (isApi(error, 409, ErrorCode.LAST_ACTIVE_OWNER)) setNotice('last-owner');
      else if (isApi(error, 404, ErrorCode.NOT_FOUND)) {
        setNotice('stale');
        setAttempt((n) => n + 1);
      } else await fail(error, () => setNotice('error'));
    } finally {
      setBusy(null);
    }
  };

  const replaceMember = (updated: Membership) =>
    setMembers((p) => ({ ...p, items: p.items.map((x) => (x.id === updated.id ? updated : x)) }));

  const deactivate = (id: string) =>
    run({ kind: 'deactivate', id }, async () => {
      replaceMember(await deactivateMembership(workspaceId, id));
    });
  const reactivate = (id: string) =>
    run({ kind: 'reactivate', id }, async () => {
      replaceMember(await reactivateMembership(workspaceId, id));
    });
  const revoke = (id: string) =>
    run({ kind: 'revoke', id }, async () => {
      await revokeInvitation(workspaceId, id);
      setInvitations((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) }));
    });

  return {
    status,
    members,
    invitations,
    notice,
    busy,
    retry,
    showMoreMembers,
    showMoreInvitations,
    deactivate,
    reactivate,
    revoke,
  };
}
