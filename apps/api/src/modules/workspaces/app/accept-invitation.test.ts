import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  InvalidCredentialsError,
  InvitationForAnotherEmailError,
  InvitationInvalidError,
  ValidationError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { hashToken } from '../../../platform/tokens.js';
import { createAccountUseCases } from '../../auth/app/accounts.js';
import { createCredentialUseCases } from '../../auth/app/credentials.js';
import {
  fakeAccountRepo,
  fakeEmailLock,
  fakeFailureRepo,
  fakeHasher,
  fakeSessionRepo,
} from '../../auth/app/fakes.js';
import { createSessionUseCases } from '../../auth/app/sessions.js';
import { createAcceptInvitation } from './accept-invitation.js';
import type {
  InvitationRecord,
  InvitationState,
  MembershipRecord,
  UnitOfWork,
  WorkspaceRepos,
} from './ports.js';

const T0 = new Date('2026-03-01T00:00:00Z');
const WEEK = 7 * 86_400_000;
const WS = 'ws-1';
const TOKEN = 'token-abc';

async function setup() {
  const clock = fixedClock(T0);
  const accountRepo = fakeAccountRepo();
  const failures = fakeFailureRepo();
  const sessions = fakeSessionRepo();
  const hasher = fakeHasher();
  const accounts = createAccountUseCases({ accounts: accountRepo, hasher, clock });
  const sessionUseCases = createSessionUseCases({ sessions, clock });
  const credentials = createCredentialUseCases({
    accounts: accountRepo,
    failures,
    hasher,
    clock,
    sessionUseCases,
    emailLock: fakeEmailLock(),
  });

  const invitations: InvitationRecord[] = [];
  const memberships: MembershipRecord[] = [];
  const repos = {
    workspaces: { lockForUpdate: async (id: string) => id === WS },
    memberships: {
      hasAnyMember: async (id: string) => memberships.some((m) => m.workspaceId === id),
      findByAccount: async (id: string, accountId: string) =>
        memberships.find((m) => m.workspaceId === id && m.accountId === accountId) ?? null,
      insert: async (workspaceId: string, m: Omit<MembershipRecord, 'workspaceId'>) =>
        void memberships.push({ ...m, workspaceId }),
    },
    invitations: {
      findByTokenHash: async (hash: Buffer) => {
        const inv = invitations.find((i) => i.tokenHash.equals(hash));
        return inv ? { ...inv, workspaceName: 'Acme' } : null;
      },
      consume: async (workspaceId: string, hash: Buffer, now: Date) => {
        const inv = invitations.find(
          (i) =>
            i.workspaceId === workspaceId &&
            i.tokenHash.equals(hash) &&
            i.state === 'pending' &&
            i.expiresAt > now,
        );
        if (!inv) return false;
        inv.state = 'accepted';
        return true;
      },
    },
  } as unknown as WorkspaceRepos;
  const uow: UnitOfWork = { run: (fn) => fn(repos, undefined as never) };

  function invite(over: Partial<InvitationRecord> = {}): InvitationRecord {
    const inv: InvitationRecord = {
      id: newId(),
      workspaceId: WS,
      email: 'ana@acme.test',
      role: 'operator',
      tokenHash: hashToken(TOKEN),
      state: 'pending',
      expiresAt: new Date(T0.getTime() + WEEK),
      createdAt: T0,
      closedAt: null,
      ...over,
    };
    invitations.length = 0;
    invitations.push(inv);
    return inv;
  }

  const uc = createAcceptInvitation({
    uow,
    invitations: repos.invitations,
    memberships: repos.memberships,
    accounts,
    credentials,
    sessions: sessionUseCases,
    clock,
  });
  return { uc, clock, accounts, accountRepo, sessions, memberships, invitations, invite, failures };
}

describe('lookUpInvitation', () => {
  it('returns workspace name, email, role and accountExists=false for a fresh email', async () => {
    const { uc, invite } = await setup();
    invite();
    expect(await uc.lookUpInvitation(TOKEN)).toEqual({
      workspaceName: 'Acme',
      email: 'ana@acme.test',
      role: 'operator',
      accountExists: false,
    });
  });

  it('AC-04: accountExists=true when the email already has an account', async () => {
    const { uc, invite, accounts } = await setup();
    invite();
    await accounts.createAccount({
      email: 'Ana@acme.test',
      displayName: 'Ana',
      password: 'long-enough-pw',
    });
    expect((await uc.lookUpInvitation(TOKEN)).accountExists).toBe(true);
  });

  it('AC-04b: a signed-in account with another email is refused', async () => {
    const { uc, invite } = await setup();
    invite();
    await expect(
      uc.lookUpInvitation(TOKEN, { id: newId(), email: 'bob@acme.test' }),
    ).rejects.toBeInstanceOf(InvitationForAnotherEmailError);
  });

  it('a signed-in account with the same email is allowed', async () => {
    const { uc, invite } = await setup();
    invite();
    await expect(
      uc.lookUpInvitation(TOKEN, { id: newId(), email: 'ANA@acme.test' }),
    ).resolves.toMatchObject({ email: 'ana@acme.test' });
  });

  it('AC-06: unknown token -> invalid, ask business_owner', async () => {
    const { uc } = await setup();
    const err = await uc.lookUpInvitation('nope').catch((e) => e);
    expect(err).toBeInstanceOf(InvitationInvalidError);
    expect(err.details).toEqual({ ask: 'business_owner' });
  });

  it.each<InvitationState>(['accepted', 'revoked', 'superseded'])(
    'AC-06: %s invitation -> invalid, ask business_owner when the workspace has members',
    async (state) => {
      const { uc, invite, memberships } = await setup();
      invite({ state });
      memberships.push({ workspaceId: WS } as MembershipRecord);
      const err = await uc.lookUpInvitation(TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(InvitationInvalidError);
      expect(err.details).toEqual({ ask: 'business_owner' });
    },
  );

  it('AC-06: expired (7 days + 1 s, still pending) -> invalid', async () => {
    const { uc, invite, clock } = await setup();
    invite();
    clock.set(new Date(T0.getTime() + WEEK + 1000));
    await expect(uc.lookUpInvitation(TOKEN)).rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it('AC-06: first-owner invitation (no members) -> ask tg_inbox_team', async () => {
    const { uc, invite } = await setup();
    invite({ state: 'superseded', role: 'owner' });
    const err = await uc.lookUpInvitation(TOKEN).catch((e) => e);
    expect(err.details).toEqual({ ask: 'tg_inbox_team' });
  });
});

describe('acceptInvitation', () => {
  it('AC-03: creates the account, an active membership with the invited role, a session', async () => {
    const { uc, invite, accountRepo, memberships, invitations, sessions } = await setup();
    invite();
    const r = await uc.acceptInvitation({
      token: TOKEN,
      password: 'long-enough-pw',
      displayName: 'Ana',
    });
    expect(r.workspace).toEqual({ id: WS, name: 'Acme', role: 'operator' });
    expect(r.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(accountRepo.rows).toHaveLength(1);
    expect(accountRepo.rows[0]).toMatchObject({ email: 'ana@acme.test', displayName: 'Ana' });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      workspaceId: WS,
      accountId: accountRepo.rows[0]!.id,
      role: 'operator',
      state: 'active',
      activeSince: T0,
    });
    expect(invitations[0]!.state).toBe('accepted');
    expect(sessions.rows).toHaveLength(1);
  });

  it('AC-04: existing account + correct password adds a membership, creates no account', async () => {
    const { uc, invite, accounts, accountRepo, memberships } = await setup();
    invite();
    const existing = await accounts.createAccount({
      email: 'ana@acme.test',
      displayName: 'Ana',
      password: 'my-old-password',
    });
    memberships.push({ workspaceId: 'other', accountId: existing.id } as MembershipRecord);
    const r = await uc.acceptInvitation({
      token: TOKEN,
      password: 'my-old-password',
      displayName: 'Ignored',
    });
    expect(accountRepo.rows).toHaveLength(1);
    expect(accountRepo.rows[0]!.displayName).toBe('Ana');
    expect(memberships).toHaveLength(2);
    expect(memberships[0]).toMatchObject({ workspaceId: 'other' });
    expect(memberships[1]).toMatchObject({ workspaceId: WS, accountId: existing.id });
    expect(r.workspace.id).toBe(WS);
  });

  it('AC-04: wrong password -> InvalidCredentialsError, failure recorded, nothing written', async () => {
    const { uc, invite, accounts, memberships, invitations, failures } = await setup();
    invite();
    await accounts.createAccount({
      email: 'ana@acme.test',
      displayName: 'Ana',
      password: 'my-old-password',
    });
    await expect(
      uc.acceptInvitation({ token: TOKEN, password: 'wrong-password-1' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(failures.rows).toHaveLength(1);
    expect(memberships).toHaveLength(0);
    expect(invitations[0]!.state).toBe('pending');
  });

  it('AC-04b: another email signed in -> refused, no membership', async () => {
    const { uc, invite, memberships } = await setup();
    invite();
    await expect(
      uc.acceptInvitation(
        { token: TOKEN, password: 'long-enough-pw', displayName: 'X' },
        { id: newId(), email: 'bob@acme.test' },
      ),
    ).rejects.toBeInstanceOf(InvitationForAnotherEmailError);
    expect(memberships).toHaveLength(0);
  });

  it('AC-05: password shorter than 10 -> ValidationError on password, nothing written', async () => {
    const { uc, invite, accountRepo, memberships, invitations } = await setup();
    invite();
    const err = await uc
      .acceptInvitation({ token: TOKEN, password: 'short', displayName: 'Ana' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toMatchObject({ field: 'password' });
    expect(accountRepo.rows).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(invitations[0]!.state).toBe('pending');
  });

  it('blank display name for a new account -> ValidationError on display_name', async () => {
    const { uc, invite, accountRepo } = await setup();
    invite();
    const err = await uc
      .acceptInvitation({ token: TOKEN, password: 'long-enough-pw', displayName: '  ' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toMatchObject({ field: 'display_name' });
    expect(accountRepo.rows).toHaveLength(0);
  });

  it.each<InvitationState>(['accepted', 'revoked', 'superseded'])(
    'AC-06: %s invitation cannot be accepted',
    async (state) => {
      const { uc, invite, memberships } = await setup();
      invite({ state });
      await expect(
        uc.acceptInvitation({ token: TOKEN, password: 'long-enough-pw', displayName: 'A' }),
      ).rejects.toBeInstanceOf(InvitationInvalidError);
      expect(memberships).toHaveLength(0);
    },
  );

  it('AC-06: expired invitation cannot be accepted', async () => {
    const { uc, invite, clock, memberships } = await setup();
    invite();
    clock.advance(WEEK + 1000);
    await expect(
      uc.acceptInvitation({ token: TOKEN, password: 'long-enough-pw', displayName: 'A' }),
    ).rejects.toBeInstanceOf(InvitationInvalidError);
    expect(memberships).toHaveLength(0);
  });
});
