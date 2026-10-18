import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { InvalidCredentialsError, InvitationInvalidError } from '../../../platform/errors.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createAccountUseCases } from '../../auth/app/accounts.js';
import { createCredentialUseCases } from '../../auth/app/credentials.js';
import { createSessionUseCases } from '../../auth/app/sessions.js';
import { createAccountRepo } from '../../auth/infra/account-repo.js';
import { createPasswordHasher } from '../../auth/infra/password-hasher.js';
import { createSessionRepo } from '../../auth/infra/session-repo.js';
import { createEmailLock } from '../../auth/infra/email-lock.js';
import { createSignInFailureRepo } from '../../auth/infra/sign-in-failure-repo.js';
import { KyselyUnitOfWork, workspaceRepos } from '../infra/unit-of-work.js';
import { createAcceptInvitation } from './accept-invitation.js';
import { createWorkspaceAdmin } from './admin.js';

describe('accept invitation (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let admin: ReturnType<typeof createWorkspaceAdmin>;
  let uc: ReturnType<typeof createAcceptInvitation>;
  let accounts: ReturnType<typeof createAccountUseCases>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    const uow = new KyselyUnitOfWork(db);
    admin = createWorkspaceAdmin({ uow, clock: systemClock, publicWebUrl: 'http://web.test' });
    const hasher = createPasswordHasher();
    const accountRepo = createAccountRepo(db);
    accounts = createAccountUseCases({ accounts: accountRepo, hasher, clock: systemClock });
    const sessions = createSessionUseCases({ sessions: createSessionRepo(db), clock: systemClock });
    const credentials = createCredentialUseCases({
      accounts: accountRepo,
      failures: createSignInFailureRepo(db),
      hasher,
      clock: systemClock,
      sessionUseCases: sessions,
      emailLock: createEmailLock(db),
    });
    const repos = workspaceRepos(db);
    uc = createAcceptInvitation({
      uow,
      invitations: repos.invitations,
      memberships: repos.memberships,
      accounts,
      credentials,
      sessions,
      clock: systemClock,
    });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function owner(email: string) {
    const c = await admin.createWorkspaceWithOwnerInvitation({ name: 'Acme', ownerEmail: email });
    return { ...c, token: c.link.split('/invite/')[1]! };
  }

  async function memberCount(workspaceId: string) {
    const rows = await db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .execute();
    return rows.length;
  }

  it('AC-03: a new person gets an account, an active membership and a session', async () => {
    const o = await owner('new@acme.test');
    const r = await uc.acceptInvitation({
      token: o.token,
      password: 'long-enough-pw',
      displayName: 'New',
    });
    expect(r.workspace).toEqual({ id: o.workspaceId, name: 'Acme', role: 'owner' });
    expect(await memberCount(o.workspaceId)).toBe(1);
    const joined = await db
      .selectFrom('memberships')
      .select(['active_since', 'created_at'])
      .where('workspace_id', '=', o.workspaceId)
      .executeTakeFirstOrThrow();
    expect(joined.active_since).toEqual(joined.created_at);
    const inv = await db
      .selectFrom('invitations')
      .select('state')
      .where('id', '=', o.invitationId)
      .executeTakeFirstOrThrow();
    expect(inv.state).toBe('accepted');
  });

  it('AC-06: revoked between the password check and the transaction -> invalid, no membership', async () => {
    const o = await owner('race@acme.test');
    await accounts.createAccount({
      email: 'race@acme.test',
      displayName: 'Race',
      password: 'my-old-password',
    });
    // The password check is the last step before the transaction: revoke once it has started.
    const uow = new KyselyUnitOfWork(db);
    const repos = workspaceRepos(db);
    const racing = createAcceptInvitation({
      uow,
      invitations: repos.invitations,
      memberships: repos.memberships,
      accounts,
      credentials: {
        verifyPassword: async (email) => {
          await db
            .updateTable('invitations')
            .set({ state: 'revoked', closed_at: new Date() })
            .where('id', '=', o.invitationId)
            .execute();
          return (await accounts.findAccountIdByEmail(email))!;
        },
      },
      sessions: createSessionUseCases({ sessions: createSessionRepo(db), clock: systemClock }),
      clock: systemClock,
    });
    await expect(
      racing.acceptInvitation({ token: o.token, password: 'my-old-password' }),
    ).rejects.toBeInstanceOf(InvitationInvalidError);
    expect(await memberCount(o.workspaceId)).toBe(0);
  });

  it('two concurrent accepts produce one membership', async () => {
    const o = await owner('twice@acme.test');
    const attempt = () =>
      uc.acceptInvitation({ token: o.token, password: 'long-enough-pw', displayName: 'Twice' });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect((lost as PromiseRejectedResult).reason).toBeInstanceOf(InvitationInvalidError);
    expect(await memberCount(o.workspaceId)).toBe(1);
    const accountRows = await db
      .selectFrom('accounts')
      .select('id')
      .where('email', '=', 'twice@acme.test')
      .execute();
    expect(accountRows).toHaveLength(1);
  });

  it('AC-04: two workspaces inviting the same new email, same password: both join, one account', async () => {
    const a = await owner('both@acme.test');
    const b = await owner('both@acme.test');
    const attempt = (token: string) =>
      uc.acceptInvitation({ token, password: 'long-enough-pw', displayName: 'Both' });
    const results = await Promise.allSettled([attempt(a.token), attempt(b.token)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const accountRows = await db
      .selectFrom('accounts')
      .select('id')
      .where('email', '=', 'both@acme.test')
      .execute();
    expect(accountRows).toHaveLength(1);
    expect(await memberCount(a.workspaceId)).toBe(1);
    expect(await memberCount(b.workspaceId)).toBe(1);
  });

  it('AC-04: same new email, different passwords: the loser gets INVALID_CREDENTIALS and stays pending', async () => {
    const a = await owner('diff@acme.test');
    const b = await owner('diff@acme.test');
    const results = await Promise.allSettled([
      uc.acceptInvitation({ token: a.token, password: 'first-password-1', displayName: 'D' }),
      uc.acceptInvitation({ token: b.token, password: 'second-password-2', displayName: 'D' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(InvalidCredentialsError);
    const states = await db
      .selectFrom('invitations')
      .select(['id', 'state'])
      .where('id', 'in', [a.invitationId, b.invitationId])
      .execute();
    expect(states.filter((r) => r.state === 'accepted')).toHaveLength(1);
    expect(states.filter((r) => r.state === 'pending')).toHaveLength(1);
    expect((await memberCount(a.workspaceId)) + (await memberCount(b.workspaceId))).toBe(1);
  });

  it('a short password writes nothing (no account, invitation still pending)', async () => {
    const o = await owner('short@acme.test');
    await expect(
      uc.acceptInvitation({ token: o.token, password: 'short', displayName: 'S' }),
    ).rejects.toMatchObject({ details: { field: 'password' } });
    const acc = await db
      .selectFrom('accounts')
      .select('id')
      .where('email', '=', 'short@acme.test')
      .execute();
    expect(acc).toHaveLength(0);
    const inv = await db
      .selectFrom('invitations')
      .select('state')
      .where('id', '=', o.invitationId)
      .executeTakeFirstOrThrow();
    expect(inv.state).toBe('pending');
  });
});
