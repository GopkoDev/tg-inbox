import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createAccountUseCases } from './modules/auth/app/accounts.js';
import { createCredentialUseCases } from './modules/auth/app/credentials.js';
import { createResetLinkUseCases } from './modules/auth/app/reset-links.js';
import { createSessionUseCases } from './modules/auth/app/sessions.js';
import { registerAuth } from './modules/auth/http/routes.js';
import { createSessionResolver } from './modules/auth/http/session-resolver.js';
import { createAccountRepo } from './modules/auth/infra/account-repo.js';
import { createPasswordHasher } from './modules/auth/infra/password-hasher.js';
import { createResetLinkRepo } from './modules/auth/infra/reset-link-repo.js';
import { createSessionRepo } from './modules/auth/infra/session-repo.js';
import { createSignInFailureRepo } from './modules/auth/infra/sign-in-failure-repo.js';
import { createAcceptInvitation } from './modules/workspaces/app/accept-invitation.js';
import { createWorkspaceAccess } from './modules/workspaces/app/access.js';
import { registerWorkspaces } from './modules/workspaces/http/routes.js';
import { KyselyUnitOfWork, workspaceRepos } from './modules/workspaces/infra/unit-of-work.js';
import { registerHealth } from './modules/health/http/routes.js';
import { systemClock, type Clock } from './platform/clock.js';
import type { Config } from './platform/config.js';
import { createDb } from './platform/db.js';
import { registerErrorHandler } from './platform/errors.js';
import { startJobs } from './platform/jobs.js';
import { loggerOptions } from './platform/logger.js';

/** Composition root: builds every dependency and registers every module plugin. */
export async function buildApp(
  config: Config,
  overrides: { clock?: Clock } = {},
): Promise<FastifyInstance> {
  const clock = overrides.clock ?? systemClock;
  const app = Fastify({ logger: loggerOptions(config) });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(websocket);
  await app.register(cookie);

  const db = createDb(config.DATABASE_URL);
  const jobs = await startJobs(config.DATABASE_URL);
  app.addHook('onClose', async () => {
    await jobs.stop({ graceful: true });
    await db.destroy();
  });

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
  // --- end workspaces dependencies ---

  await registerHealth(app, { db });
  await app.register(
    async (api) =>
      registerAuth(api, {
        credentialUseCases,
        sessionUseCases,
        resetLinkUseCases,
        cookie: { secure: config.NODE_ENV !== 'development' },
      }),
    { prefix: '/api' },
  );
  await app.register(
    async (api) =>
      registerWorkspaces(api, {
        access: workspaceAccess,
        authenticate,
        invitationRoutes: {
          invitations: acceptInvitation,
          sessionUseCases,
          accountUseCases,
          cookie: { secure: config.NODE_ENV !== 'development' },
        },
      }),
    { prefix: '/api' },
  );

  return app;
}
