import { createAccountUseCases } from './modules/auth/app/accounts.js';
import { createCredentialUseCases } from './modules/auth/app/credentials.js';
import { createResetLinkUseCases } from './modules/auth/app/reset-links.js';
import { createSessionUseCases } from './modules/auth/app/sessions.js';
import { createSessionResolver } from './modules/auth/http/session-resolver.js';
import { createAccountRepo } from './modules/auth/infra/account-repo.js';
import { createEmailLock } from './modules/auth/infra/email-lock.js';
import { createPasswordHasher } from './modules/auth/infra/password-hasher.js';
import { createResetLinkRepo } from './modules/auth/infra/reset-link-repo.js';
import { createSessionRepo } from './modules/auth/infra/session-repo.js';
import { createSignInFailureRepo } from './modules/auth/infra/sign-in-failure-repo.js';
import { createAcceptInvitation } from './modules/workspaces/app/accept-invitation.js';
import { createWorkspaceAccess } from './modules/workspaces/app/access.js';
import { createTeam } from './modules/workspaces/app/team.js';
import { KyselyUnitOfWork, workspaceRepos } from './modules/workspaces/infra/unit-of-work.js';
import { createWorkspaceAdmin } from './modules/workspaces/app/admin.js';
import { systemClock, type Clock } from './platform/clock.js';
import type { Config } from './platform/config.js';
import { createDb } from './platform/db.js';

/**
 * Shared dependency builder: the one place module dependencies are constructed. Used by
 * `buildApp()` (HTTP) and the admin CLI. No Fastify import.
 */
export function buildDeps(config: Config, overrides: { clock?: Clock } = {}) {
  const clock = overrides.clock ?? systemClock;
  const db = createDb(config.DATABASE_URL);

  // --- auth dependencies (T17 extracts this block into a shared dependency builder) ---
  const hasher = createPasswordHasher();
  const accountRepo = createAccountRepo(db);
  const sessionRepo = createSessionRepo(db);
  const failureRepo = createSignInFailureRepo(db);
  const sessionUseCases = createSessionUseCases({ sessions: sessionRepo, clock });
  const credentialUseCases = createCredentialUseCases({
    accounts: accountRepo,
    failures: failureRepo,
    hasher,
    clock,
    sessionUseCases,
    emailLock: createEmailLock(db),
  });
  const resetLinkUseCases = createResetLinkUseCases({
    accounts: accountRepo,
    links: createResetLinkRepo(db),
    sessions: sessionRepo,
    failures: failureRepo,
    hasher,
    clock,
    sessionUseCases,
    transaction: (fn) => db.transaction().execute(fn),
    publicWebUrl: config.PUBLIC_WEB_URL,
  });
  const accountUseCases = createAccountUseCases({ accounts: accountRepo, hasher, clock });
  const authenticate = createSessionResolver({ sessionUseCases, accountUseCases });
  // --- end auth dependencies ---

  // --- workspaces dependencies (T17 extracts this block into a shared dependency builder) ---
  const workspaceAccess = createWorkspaceAccess({
    uow: new KyselyUnitOfWork(db),
    clock,
    auth: accountUseCases,
  });
  const workspaceUow = new KyselyUnitOfWork(db);
  const acceptInvitation = createAcceptInvitation({
    uow: workspaceUow,
    invitations: workspaceRepos(db).invitations,
    memberships: workspaceRepos(db).memberships,
    accounts: accountUseCases,
    credentials: credentialUseCases,
    sessions: sessionUseCases,
    clock,
  });
  const team = createTeam({
    uow: workspaceUow,
    clock,
    accounts: accountUseCases,
    publicWebUrl: config.PUBLIC_WEB_URL,
  });
  // --- end workspaces dependencies ---

  const workspaceAdmin = createWorkspaceAdmin({
    uow: workspaceUow,
    clock,
    publicWebUrl: config.PUBLIC_WEB_URL,
  });

  return {
    config,
    clock,
    db,
    credentialUseCases,
    sessionUseCases,
    resetLinkUseCases,
    accountUseCases,
    authenticate,
    workspaceAccess,
    acceptInvitation,
    team,
    workspaceAdmin,
    /** Releases the database pool. */
    destroy: () => db.destroy(),
  };
}

export type Deps = ReturnType<typeof buildDeps>;
