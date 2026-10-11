import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { AccessRemovedError, NotFoundError } from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { createWorkspaceAccess } from './access.js';
import type { MembershipRecord, UnitOfWork, WorkspaceRepos } from './ports.js';

const T0 = new Date('2026-03-01T00:00:00Z');
const T1 = new Date('2026-03-02T00:00:00Z');
const T2 = new Date('2026-03-03T00:00:00Z');

function setup() {
  const names = new Map<string, string>();
  const rows: MembershipRecord[] = [];
  const accounts = new Map<string, { id: string; email: string; displayName: string }>();
  const clock = fixedClock(T2);

  function addWorkspace(name: string): string {
    const id = newId();
    names.set(id, name);
    return id;
  }
  function addMember(
    workspaceId: string,
    accountId: string,
    o: Partial<Pick<MembershipRecord, 'role' | 'state' | 'lastUsedAt'>> = {},
  ): MembershipRecord {
    const m: MembershipRecord = {
      id: newId(),
      workspaceId,
      accountId,
      role: o.role ?? 'operator',
      state: o.state ?? 'active',
      lastUsedAt: o.lastUsedAt ?? null,
      deactivatedAt: o.state === 'deactivated' ? T0 : null,
      createdAt: T0,
    };
    rows.push(m);
    return m;
  }
  function addAccount(): string {
    const id = newId();
    accounts.set(id, { id, email: `${id}@x.test`, displayName: 'Ana' });
    return id;
  }

  const repos = {
    memberships: {
      findForGuard: async (accountId: string, workspaceId: string) =>
        rows.find((r) => r.accountId === accountId && r.workspaceId === workspaceId) ?? null,
      listActiveOfAccount: async (accountId: string) =>
        rows
          .filter((r) => r.accountId === accountId && r.state === 'active')
          .map((r) => ({ ...r, workspaceName: names.get(r.workspaceId)! })),
      touchLastUsed: async (workspaceId: string, accountId: string, at: Date) => {
        const r = rows.find((x) => x.workspaceId === workspaceId && x.accountId === accountId);
        if (r) r.lastUsedAt = at;
        return !!r;
      },
    },
    workspaces: {
      findById: async (id: string) =>
        names.has(id) ? { id, name: names.get(id)!, createdAt: T0 } : null,
    },
  } as unknown as WorkspaceRepos;
  const uow: UnitOfWork = { run: (fn) => fn(repos) };
  const access = createWorkspaceAccess({
    uow,
    clock,
    auth: { getAccount: async (id: string) => accounts.get(id) as never },
  });
  return { access, addWorkspace, addMember, addAccount };
}

describe('guardWorkspace', () => {
  it('AC-13: no membership, unknown and malformed ids are the same NotFoundError', async () => {
    const s = setup();
    const acc = s.addAccount();
    const other = s.addWorkspace('Bolt');
    s.addMember(other, s.addAccount());
    const errs = await Promise.all(
      [other, newId(), 'not-a-uuid'].map((w) => s.access.guardWorkspace(acc, w).catch((e) => e)),
    );
    for (const e of errs) expect(e).toBeInstanceOf(NotFoundError);
    expect(new Set(errs.map((e) => e.message)).size).toBe(1);
  });

  it('AC-17: a deactivated membership is refused with AccessRemovedError; the other still passes', async () => {
    const s = setup();
    const acc = s.addAccount();
    const wa = s.addWorkspace('Acme');
    const wb = s.addWorkspace('Bolt');
    const ma = s.addMember(wa, acc, { role: 'owner' });
    s.addMember(wb, acc, { role: 'operator' });
    await expect(s.access.guardWorkspace(acc, wa)).resolves.toEqual({
      workspaceId: wa,
      role: 'owner',
    });
    ma.state = 'deactivated';
    await expect(s.access.guardWorkspace(acc, wa)).rejects.toBeInstanceOf(AccessRemovedError);
    await expect(s.access.guardWorkspace(acc, wb)).resolves.toEqual({
      workspaceId: wb,
      role: 'operator',
    });
  });
});

describe('getMe', () => {
  it('AC-07: lastUsedWorkspaceId is the active membership with the latest last_used_at', async () => {
    const s = setup();
    const acc = s.addAccount();
    const wa = s.addWorkspace('Acme');
    const wb = s.addWorkspace('Bolt');
    s.addMember(wa, acc, { lastUsedAt: T0 });
    s.addMember(wb, acc, { lastUsedAt: T1 });
    const me = await s.access.getMe(acc);
    expect(me.lastUsedWorkspaceId).toBe(wb);
    expect(me.account).toEqual({ id: acc, email: `${acc}@x.test`, displayName: 'Ana' });
  });

  it('AC-07: null when none was entered, or the last-used membership is deactivated', async () => {
    const s = setup();
    const acc = s.addAccount();
    const wa = s.addWorkspace('Acme');
    const wb = s.addWorkspace('Bolt');
    s.addMember(wa, acc);
    s.addMember(wb, acc, { lastUsedAt: T1, state: 'deactivated' });
    expect((await s.access.getMe(acc)).lastUsedWorkspaceId).toBeNull();
  });
});

describe('listMyWorkspaces', () => {
  it('AC-10: empty when every membership is deactivated', async () => {
    const s = setup();
    const acc = s.addAccount();
    s.addMember(s.addWorkspace('Acme'), acc, { state: 'deactivated' });
    expect(await s.access.listMyWorkspaces(acc, { limit: 10 })).toEqual({
      items: [],
      hasNext: false,
      hasPrev: false,
      nextCursor: null,
    });
  });

  it('AC-07: active only, ordered by workspace id, cursor paged', async () => {
    const s = setup();
    const acc = s.addAccount();
    const ids = [s.addWorkspace('A'), s.addWorkspace('B'), s.addWorkspace('C')];
    s.addWorkspace('D');
    s.addMember(ids[2]!, acc, { role: 'owner' });
    s.addMember(ids[0]!, acc);
    s.addMember(ids[1]!, acc, { state: 'deactivated' });
    const all = await s.access.listMyWorkspaces(acc, { limit: 10 });
    expect(all.items).toEqual([
      { id: ids[0], name: 'A', role: 'operator' },
      { id: ids[2], name: 'C', role: 'owner' },
    ]);
    const p1 = await s.access.listMyWorkspaces(acc, { limit: 1 });
    expect(p1.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(p1.hasNext).toBe(true);
    expect(p1.hasPrev).toBe(false);
    const p2 = await s.access.listMyWorkspaces(acc, { limit: 1, after: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual([ids[2]]);
    expect(p2.hasNext).toBe(false);
    expect(p2.hasPrev).toBe(true);
    const back = await s.access.listMyWorkspaces(acc, { limit: 1, before: ids[2]! });
    expect(back.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(back.hasNext).toBe(true);
    expect(back.hasPrev).toBe(false);
  });
});

describe('enterWorkspace', () => {
  it('AC-12: sets last_used_at and returns id, name, role; next sign-in resolves to it', async () => {
    const s = setup();
    const acc = s.addAccount();
    const wa = s.addWorkspace('Acme');
    const wb = s.addWorkspace('Bolt');
    s.addMember(wa, acc, { lastUsedAt: T1 });
    const mb = s.addMember(wb, acc, { role: 'owner' });
    await expect(s.access.enterWorkspace(acc, wb)).resolves.toEqual({
      id: wb,
      name: 'Bolt',
      role: 'owner',
    });
    expect(mb.lastUsedAt).toEqual(T2);
    expect((await s.access.getMe(acc)).lastUsedWorkspaceId).toBe(wb);
  });

  it('AC-17: entering a deactivated workspace is refused and last_used_at is unchanged', async () => {
    const s = setup();
    const acc = s.addAccount();
    const wa = s.addWorkspace('Acme');
    const m = s.addMember(wa, acc, { state: 'deactivated', lastUsedAt: T0 });
    await expect(s.access.enterWorkspace(acc, wa)).rejects.toBeInstanceOf(AccessRemovedError);
    expect(m.lastUsedAt).toEqual(T0);
  });

  it('AC-13: entering a workspace without membership is NotFoundError', async () => {
    const s = setup();
    await expect(s.access.enterWorkspace(s.addAccount(), newId())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
