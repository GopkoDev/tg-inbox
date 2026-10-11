import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  NotFoundError,
  OwnerAlreadyJoinedError,
  ValidationError,
} from '../../../platform/errors.js';
import { hashToken } from '../../../platform/tokens.js';
import { createWorkspaceAdmin } from './admin.js';
import type { InvitationRecord, UnitOfWork, WorkspaceRecord, WorkspaceRepos } from './ports.js';

const T0 = new Date('2026-03-01T00:00:00Z');
const WEEK = 7 * 86_400_000;
const PREFIX = 'http://web.test/invite/';

function setup() {
  const workspaces: WorkspaceRecord[] = [];
  const invitations: InvitationRecord[] = [];
  const members = new Set<string>();
  const repos = {
    workspaces: {
      insert: async (w: WorkspaceRecord) => void workspaces.push(w),
      findById: async (id: string) => workspaces.find((w) => w.id === id) ?? null,
      lockForUpdate: async (id: string) => workspaces.some((w) => w.id === id),
    },
    memberships: { hasAnyMember: async (id: string) => members.has(id) },
    invitations: {
      insert: async (workspaceId: string, i: Omit<InvitationRecord, 'workspaceId'>) =>
        void invitations.push({ ...i, workspaceId }),
      findLatest: async (id: string) =>
        invitations.filter((i) => i.workspaceId === id).at(-1) ?? null,
      supersedePending: async (id: string, email: string, now: Date) => {
        let n = 0;
        for (const i of invitations) {
          if (i.workspaceId === id && i.email === email && i.state === 'pending') {
            i.state = 'superseded';
            i.closedAt = now;
            n++;
          }
        }
        return n;
      },
    },
  } as unknown as WorkspaceRepos;
  const uow: UnitOfWork = { run: (fn) => fn(repos) };
  const clock = fixedClock(T0);
  const admin = createWorkspaceAdmin({ uow, clock, publicWebUrl: 'http://web.test' });
  return { admin, workspaces, invitations, members, clock };
}

describe('createWorkspaceWithOwnerInvitation', () => {
  it('AC-01: creates workspace and owner invitation with 7-day expiry and a link', async () => {
    const s = setup();
    const r = await s.admin.createWorkspaceWithOwnerInvitation({
      name: ' Acme Flowers ',
      ownerEmail: ' Ana@Acme.test ',
    });
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0]).toMatchObject({ id: r.workspaceId, name: 'Acme Flowers' });
    const inv = s.invitations[0]!;
    expect(inv).toMatchObject({
      id: r.invitationId,
      workspaceId: r.workspaceId,
      email: 'ana@acme.test',
      role: 'owner',
      state: 'pending',
    });
    expect(inv.expiresAt).toEqual(new Date(T0.getTime() + WEEK));
    expect(r.email).toBe('ana@acme.test');
    expect(r.expiresAt).toEqual(inv.expiresAt);
    const token = r.link.slice(PREFIX.length);
    expect(r.link.startsWith(PREFIX)).toBe(true);
    expect(token).toHaveLength(43);
    expect(inv.tokenHash.equals(hashToken(token))).toBe(true);
    expect(s.members.size).toBe(0);
  });

  it.each([
    ['empty name', { name: '   ', ownerEmail: 'a@b.test' }, 'name'],
    ['long name', { name: 'x'.repeat(201), ownerEmail: 'a@b.test' }, 'name'],
    ['bad email', { name: 'Acme', ownerEmail: 'not-an-email' }, 'ownerEmail'],
  ])('AC-02: %s creates nothing and names the field', async (_n, input, field) => {
    const s = setup();
    const err = await s.admin.createWorkspaceWithOwnerInvitation(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toMatchObject({ field });
    expect(s.workspaces).toHaveLength(0);
    expect(s.invitations).toHaveLength(0);
  });
});

describe('reissueOwnerInvitation', () => {
  it('AC-01b: supersedes the earlier one and issues a new one for the same email', async () => {
    const s = setup();
    const c = await s.admin.createWorkspaceWithOwnerInvitation({
      name: 'Acme',
      ownerEmail: 'ana@acme.test',
    });
    s.clock.advance(WEEK + 1000); // expired but still pending
    const r = await s.admin.reissueOwnerInvitation(c.workspaceId);
    expect(r.supersededInvitationId).toBe(c.invitationId);
    expect(r.email).toBe('ana@acme.test');
    expect(r.expiresAt).toEqual(new Date(s.clock.now().getTime() + WEEK));
    expect(s.invitations[0]!.state).toBe('superseded');
    expect(s.invitations[1]).toMatchObject({ id: r.invitationId, role: 'owner', state: 'pending' });
    expect(r.link).not.toBe(c.link);
    expect(s.invitations[1]!.tokenHash.equals(hashToken(r.link.slice(PREFIX.length)))).toBe(true);
  });

  it('refuses when the workspace already has members', async () => {
    const s = setup();
    const c = await s.admin.createWorkspaceWithOwnerInvitation({
      name: 'A',
      ownerEmail: 'a@b.test',
    });
    s.members.add(c.workspaceId);
    await expect(s.admin.reissueOwnerInvitation(c.workspaceId)).rejects.toBeInstanceOf(
      OwnerAlreadyJoinedError,
    );
    expect(s.invitations).toHaveLength(1);
  });

  it('unknown workspace is not found', async () => {
    const s = setup();
    await expect(s.admin.reissueOwnerInvitation('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
