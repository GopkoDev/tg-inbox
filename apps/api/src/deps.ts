import { createAccountUseCases } from './modules/auth/app/accounts.js';
import { createCredentialUseCases } from './modules/auth/app/credentials.js';
import { createResetLinkUseCases } from './modules/auth/app/reset-links.js';
import { createSessionUseCases } from './modules/auth/app/sessions.js';
import {
  createOptionalAccountResolver,
  createSessionResolver,
} from './modules/auth/http/session-resolver.js';
import { createAccountRepo } from './modules/auth/infra/account-repo.js';
import { createEmailLock } from './modules/auth/infra/email-lock.js';
import { createPasswordHasher } from './modules/auth/infra/password-hasher.js';
import { createResetLinkRepo } from './modules/auth/infra/reset-link-repo.js';
import { createSessionRepo } from './modules/auth/infra/session-repo.js';
import { createSignInFailureRepo } from './modules/auth/infra/sign-in-failure-repo.js';
import { createAcceptInvitation } from './modules/workspaces/app/accept-invitation.js';
import { publish } from './platform/realtime.js';
import { createWorkspaceAccess } from './modules/workspaces/app/access.js';
import { createTeam } from './modules/workspaces/app/team.js';
import { KyselyUnitOfWork, workspaceRepos } from './modules/workspaces/infra/unit-of-work.js';
import { createWorkspaceAdmin } from './modules/workspaces/app/admin.js';
import { createAcceptUpdate } from './modules/bots/app/accept-update.js';
import { createDisconnect } from './modules/bots/app/disconnect.js';
import { createHealthCheck } from './modules/bots/app/health-check.js';
import { createPasteToken } from './modules/bots/app/paste-token.js';
import { createReconnect } from './modules/bots/app/reconnect.js';
import { createBotSettings } from './modules/bots/app/settings.js';
import { createBotSignals } from './modules/bots/infra/bot-signals.js';
import { createMarkNeedsToken } from './modules/bots/app/mark-needs-token.js';
import { createOpenMedia } from './modules/bots/app/open-media.js';
import { createSendText } from './modules/bots/app/send-text.js';
import { createInboxBotStatus } from './modules/bots/app/inbox-status.js';
import { createBotRepo } from './modules/bots/infra/bot-repo.js';
import { createTelegramGateway } from './modules/bots/infra/telegram-gateway.js';
import { createTokenCipher } from './modules/bots/infra/token-cipher.js';
import { createWebhookSecrets } from './modules/bots/infra/webhook-secret.js';
import { createContacts } from './modules/contacts/app/contacts.js';
import { createContactRepo } from './modules/contacts/infra/contact-repo.js';
import { createConversations } from './modules/conversations/app/conversations.js';
import { createActivityRepo } from './modules/conversations/infra/activity-repo.js';
import { createConversationRepo } from './modules/conversations/infra/conversation-repo.js';
import { createReplies, createReplyDelivery } from './modules/conversations/app/replies.js';
import { createReplyRepo } from './modules/conversations/infra/reply-repo.js';
import { createInboxReads } from './modules/conversations/app/inbox-reads.js';
import { createListQueries } from './modules/conversations/infra/list-queries.js';
import { createReadMarkRepo } from './modules/conversations/infra/read-mark-repo.js';
import { createThreadQueries } from './modules/conversations/infra/thread-queries.js';
import { createOpenMessageMedia } from './modules/inbox/app/open-media.js';
import { createInboxReadUseCases } from './modules/inbox/app/reads.js';
import { createConversationSignals } from './modules/conversations/infra/conversation-signals.js';
import { createMessageRepo } from './modules/conversations/infra/message-repo.js';
import { systemClock, type Clock } from './platform/clock.js';
import type { Config } from './platform/config.js';
import { createDb } from './platform/db.js';

/**
 * Shared dependency builder: the one place module dependencies are constructed. Used by
 * `buildApp()` (HTTP) and the admin CLI. No Fastify import.
 */
export function buildDeps(config: Config, overrides: { clock?: Clock } = {}) {
  const clock = overrides.clock ?? systemClock;
  const db = createDb(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    connectionTimeoutMillis: config.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
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
  const optionalAccount = createOptionalAccountResolver({ sessionUseCases, accountUseCases });
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
    publish,
    // T10 replaces this no-op with conversations.unassignDeactivatedMember
    onMembershipDeactivated: async () => {},
    publicWebUrl: config.PUBLIC_WEB_URL,
  });
  // --- end workspaces dependencies ---

  const workspaceAdmin = createWorkspaceAdmin({
    uow: workspaceUow,
    clock,
    publicWebUrl: config.PUBLIC_WEB_URL,
  });

  // --- contacts → conversations → bots (one-way: bots → conversations → contacts, bots → contacts) ---
  const transaction = <T>(fn: (tx: typeof db) => Promise<T>) => db.transaction().execute(fn);
  const contacts = createContacts({ repo: createContactRepo(db), clock });
  const conversations = createConversations({
    transaction,
    conversations: createConversationRepo(db),
    messages: createMessageRepo(db),
    activities: createActivityRepo(db),
    contacts,
    signals: createConversationSignals(),
    clock,
  });
  const botRepo = createBotRepo(db, createTokenCipher(config.BOT_TOKEN_ENCRYPTION_KEY));
  const telegram = createTelegramGateway({
    ...(config.TELEGRAM_API_ROOT && { apiRoot: config.TELEGRAM_API_ROOT }),
    maxConnections: config.TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
  });
  const secrets = createWebhookSecrets(config.BOT_TOKEN_ENCRYPTION_KEY.key);
  const webhookBaseUrl = config.TELEGRAM_WEBHOOK_BASE_URL;
  const botSettings = createBotSettings({ bots: botRepo, conversations, contacts });
  const botOwnerDeps = {
    bots: botRepo,
    telegram,
    secrets,
    clock,
    settings: botSettings,
    transaction,
    signals: createBotSignals(),
    webhookBaseUrl,
  };
  const markNeedsToken = createMarkNeedsToken({
    bots: botRepo,
    clock,
    transaction,
    signals: botOwnerDeps.signals,
  });
  const bots = {
    settings: botSettings,
    markNeedsToken,
    sendText: createSendText({ bots: botRepo, telegram, markNeedsToken }).sendText,
    openMedia: createOpenMedia({ bots: botRepo, telegram, markNeedsToken }).openMedia,
    inboxStatus: createInboxBotStatus({ bots: botRepo }),
    paste: createPasteToken({ ...botOwnerDeps, conversations }),
    reconnect: createReconnect(botOwnerDeps),
    disconnect: createDisconnect({ ...botOwnerDeps, conversations }),
    acceptUpdate: createAcceptUpdate({ bots: botRepo, conversations }),
    healthCheck: createHealthCheck({
      bots: botRepo,
      telegram,
      clock,
      transaction,
      signals: botOwnerDeps.signals,
      webhookBaseUrl,
    }),
  };
  // --- end bots dependencies ---

  const replyDeps = {
    transaction,
    replies: createReplyRepo(db),
    signals: createConversationSignals(),
    clock,
  };
  const conversationReplies = createReplies(replyDeps);
  const replyDelivery = createReplyDelivery(replyDeps);

  // --- inbox: calls the app layers of conversations, contacts, bots and workspaces ---
  const inboxConversations = createInboxReads({
    transaction,
    lists: createListQueries(db),
    threads: createThreadQueries(db),
    marks: createReadMarkRepo(db),
    signals: createConversationSignals(),
    clock,
  });
  const inboxReads = createInboxReadUseCases({
    conversations: inboxConversations,
    contacts,
    workspaces: workspaceAccess,
    bots: bots.inboxStatus,
    clock,
  });
  const inboxMedia = createOpenMessageMedia({
    conversations: inboxConversations,
    bots: { openMedia: bots.openMedia },
  });
  // --- end inbox dependencies ---

  return {
    config,
    clock,
    db,
    credentialUseCases,
    sessionUseCases,
    resetLinkUseCases,
    accountUseCases,
    authenticate,
    optionalAccount,
    workspaceAccess,
    acceptInvitation,
    team,
    workspaceAdmin,
    contacts,
    conversations,
    bots,
    inboxReads,
    inboxMedia,
    conversationReplies,
    replyDelivery,
    /** Releases the database pool. */
    destroy: () => db.destroy(),
  };
}

export type Deps = ReturnType<typeof buildDeps>;
