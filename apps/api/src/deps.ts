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
import { BROADCAST_MESSAGES_PER_SECOND, createPacer } from './modules/bots/app/pacer.js';
import { createSendBroadcastMessage } from './modules/bots/app/send-broadcast-message.js';
import { createPingReadiness } from './modules/bots/app/ping-readiness.js';
import { createSendMemberMessage } from './modules/bots/app/send-member-message.js';
import { createInboxBotStatus } from './modules/bots/app/inbox-status.js';
import { createLaunchReadiness } from './modules/bots/app/launch-readiness.js';
import { createMeasureBlockedShare } from './modules/broadcasts/app/blocked-share.js';
import { createDrafts } from './modules/broadcasts/app/drafts.js';
import { createDuplicate } from './modules/broadcasts/app/duplicate.js';
import { createBroadcastGroup } from './modules/broadcasts/app/group.js';
import { createLaunchBroadcast } from './modules/broadcasts/app/launch.js';
import type { ContactsApi as BroadcastContactsApi } from './modules/broadcasts/app/ports.js';
import { createLaunchPreview } from './modules/broadcasts/app/preview.js';
import { createBroadcastReads } from './modules/broadcasts/app/reads.js';
import { createStopBroadcast } from './modules/broadcasts/app/stop.js';
import { createSendLink } from './modules/broadcasts/app/send-link.js';
import { createSettle } from './modules/broadcasts/app/settle.js';
import { createBroadcastJobs } from './modules/broadcasts/infra/jobs.js';
import { createBroadcastSignals, createReportSignals } from './modules/broadcasts/infra/signals.js';
import { createAudienceTagRepo } from './modules/broadcasts/infra/audience-tag-repo.js';
import { createBroadcastRepo } from './modules/broadcasts/infra/broadcast-repo.js';
import { createGroupRepo } from './modules/broadcasts/infra/group-repo.js';
import { createRecipientRepo } from './modules/broadcasts/infra/recipient-repo.js';
import { createBotRepo } from './modules/bots/infra/bot-repo.js';
import { createTelegramGateway } from './modules/bots/infra/telegram-gateway.js';
import { createTokenCipher } from './modules/bots/infra/token-cipher.js';
import { createWebhookSecrets } from './modules/bots/infra/webhook-secret.js';
import { randomBytes } from 'node:crypto';
import { createConnectLinkIssuer } from './modules/notifications/app/connect-link.js';
import { createDisconnectTelegram } from './modules/notifications/app/disconnect.js';
import { createSettings } from './modules/notifications/app/settings.js';
import { createDeliverAnswer } from './modules/notifications/app/deliver-answer.js';
import { createLinkLifecycle } from './modules/notifications/app/link-lifecycle.js';
import { createIntercept } from './modules/notifications/app/intercept.js';
import { createPresence } from './modules/notifications/app/presence.js';
import { createSendPings } from './modules/notifications/app/send-pings.js';
import { createRedeem } from './modules/notifications/app/redeem.js';
import { createPingRepo } from './modules/notifications/infra/ping-repo.js';
import { createPresenceRepo } from './modules/notifications/infra/presence-repo.js';
import { createConnectLinkRepo } from './modules/notifications/infra/connect-link-repo.js';
import { createBotMessageSender, createPingStarter } from './modules/notifications/infra/jobs.js';
import { createNotificationSignals } from './modules/notifications/infra/signals.js';
import { createTelegramLinkRepo } from './modules/notifications/infra/telegram-link-repo.js';
import { createContactReads, createContacts } from './modules/contacts/app/contacts.js';
import { createContactAudiences } from './modules/contacts/app/audiences.js';
import { createContactReach } from './modules/contacts/app/reach.js';
import { createAudienceQuery } from './modules/contacts/infra/audience-query.js';
import { createTagAdmin } from './modules/contacts/app/tag-admin.js';
import { createTagWrites } from './modules/contacts/app/tags.js';
import { createReachSignals, createTagSignals } from './modules/contacts/infra/tag-signals.js';
import { createContactListQuery } from './modules/contacts/infra/contact-list-query.js';
import { createContactRepo } from './modules/contacts/infra/contact-repo.js';
import { createReachRepo } from './modules/contacts/infra/reach-repo.js';
import { createContactTagRepo } from './modules/contacts/infra/contact-tag-repo.js';
import { createTagHistoryRepo } from './modules/contacts/infra/tag-history-repo.js';
import { createTagRepo } from './modules/contacts/infra/tag-repo.js';
import { createBroadcastItems } from './modules/conversations/app/broadcast-items.js';
import { createConversations } from './modules/conversations/app/conversations.js';
import { createBroadcastItemRepo } from './modules/conversations/infra/broadcast-item-repo.js';
import { createActivityRepo } from './modules/conversations/infra/activity-repo.js';
import { createConversationRepo } from './modules/conversations/infra/conversation-repo.js';
import { createReplies, createReplyDelivery } from './modules/conversations/app/replies.js';
import { createReplyRepo } from './modules/conversations/infra/reply-repo.js';
import { createInboxReads } from './modules/conversations/app/inbox-reads.js';
import { createListQueries } from './modules/conversations/infra/list-queries.js';
import { createNotificationReads } from './modules/conversations/app/notification-reads.js';
import { createNotificationQueries } from './modules/conversations/infra/notification-queries.js';
import { createReadMarkRepo } from './modules/conversations/infra/read-mark-repo.js';
import { createThreadQueries } from './modules/conversations/infra/thread-queries.js';
import { createStateChanges } from './modules/conversations/app/state-changes.js';
import { createChangeState } from './modules/inbox/app/change-state.js';
import type { Transaction } from 'kysely';
import type { DB } from './platform/db.types.gen.js';
import { createOpenMessageMedia } from './modules/inbox/app/open-media.js';
import { createInboxReadUseCases } from './modules/inbox/app/reads.js';
import { createConversationSignals } from './modules/conversations/infra/conversation-signals.js';
import { createMessageRepo } from './modules/conversations/infra/message-repo.js';
import { systemClock, type Clock } from './platform/clock.js';
import type { Config } from './platform/config.js';
import { createDb } from './platform/db.js';
import type { Jobs } from './platform/jobs.js';

/**
 * Shared dependency builder: the one place module dependencies are constructed. Used by
 * `buildApp()` (HTTP) and the admin CLI. No Fastify import.
 */
export function buildDeps(
  config: Config,
  overrides: { clock?: Clock; logger?: { info(obj: object, msg: string): void } } = {},
) {
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
  // --- end workspaces dependencies ---

  const workspaceAdmin = createWorkspaceAdmin({
    uow: workspaceUow,
    clock,
    publicWebUrl: config.PUBLIC_WEB_URL,
  });

  // --- contacts → conversations → bots (one-way: bots → conversations → contacts, bots → contacts) ---
  const transaction = <T>(fn: (tx: typeof db) => Promise<T>) => db.transaction().execute(fn);
  const contacts = createContacts({
    repo: createContactRepo(db),
    reach: createReachRepo(db),
    signals: createReachSignals(),
    clock,
  });
  // The contacts reach write `bots` calls when it learns a block (ADR-0003): bots -> contacts.
  const contactReach = createContactReach({
    transaction,
    contacts: createContactRepo(db),
    reach: createReachRepo(db),
    signals: createReachSignals(),
  });
  const conversations = createConversations({
    transaction,
    conversations: createConversationRepo(db),
    messages: createMessageRepo(db),
    activities: createActivityRepo(db),
    contacts,
    signals: createConversationSignals(),
    clock,
  });
  const notificationReads = createNotificationReads({
    reads: createNotificationQueries(db),
  });
  // The notifications link repositories and lifecycle are built before `team` and `bots`: both call
  // them inside their own transactions (sad.md §5 ports).
  const telegramLinks = createTelegramLinkRepo(db);
  const connectLinks = createConnectLinkRepo(db);
  const linkLifecycle = createLinkLifecycle({
    links: telegramLinks,
    connectLinks,
    signals: createNotificationSignals(),
    clock,
  });
  const team = createTeam({
    uow: workspaceUow,
    clock,
    accounts: accountUseCases,
    publish,
    // Read through notifications (account ids only; built below, called later): `workspaces` imports nothing from it.
    linkedAccounts: (workspaceId) => notificationSettings.linkedAccounts(workspaceId),
    // Composed port (sad.md §11): unassign the member's conversations, then remove their Telegram link.
    onMembershipDeactivated: async (tx, event) => {
      await conversations.unassignDeactivatedMember(tx, event);
      await linkLifecycle.removeLinkOnDeactivation(tx, event);
    },
    publicWebUrl: config.PUBLIC_WEB_URL,
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
  // Order: contacts -> conversations -> bots core -> notifications -> bots ports (the inbound
  // interceptor) -> team. `notifications` reads `bots` through these two reads only.
  const { pingReadiness } = createPingReadiness({ bots: botRepo });
  const inboxStatus = createInboxBotStatus({ bots: botRepo });

  // --- notifications: calls the app layers of workspaces and bots (one-way: bots -> notifications by port) ---
  const botMessages = createBotMessageSender();
  const pingStarter = createPingStarter();
  const membershipLocks = {
    // `transaction` always hands out a Kysely transaction; the port types it as the shared executor.
    lockActiveMembers: (tx: unknown, workspaceId: string, accountIds: string[]) =>
      workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
  };
  const redeem = createRedeem({
    transaction,
    membership: membershipLocks,
    links: telegramLinks,
    connectLinks,
    signals: createNotificationSignals(),
    enqueue: botMessages.enqueue,
    startPings: async (tx, workspaceId) => {
      await pingStarter.start(workspaceId, { tx });
    },
    clock,
  });
  const { intercept } = createIntercept({
    transaction,
    links: telegramLinks,
    redeem,
    enqueue: botMessages.enqueue,
    clock,
  });
  const interceptor = { intercept };
  // What the live-socket hub reports: one lease per open tab (ADR-0002).
  const presenceRepo = createPresenceRepo(db);
  const pingRepo = createPingRepo(db);
  const presence = createPresence({ presence: presenceRepo, pings: pingRepo, clock });
  // --- end notifications dependencies ---

  const sendMemberMessage = createSendMemberMessage({
    bots: botRepo,
    telegram,
    markNeedsToken,
    clock,
    pacer: createPacer(),
  }).sendMemberMessage;
  const sendPings = createSendPings({
    transaction,
    membership: membershipLocks,
    links: telegramLinks,
    presence: presenceRepo,
    pings: pingRepo,
    reads: notificationReads,
    bots: { pingReadiness },
    workspaces: workspaceAccess,
    send: sendMemberMessage,
    signals: createNotificationSignals(),
    clock,
    panelUrl: config.PUBLIC_WEB_URL,
    ...(overrides.logger && { logger: overrides.logger }),
  });
  // The member's own settings, connect link and disconnect (the three notifications routes).
  const notificationBots = { inboxBotStatus: inboxStatus.inboxBotStatus, pingReadiness };
  const notificationSettings = createSettings({ links: telegramLinks, bots: notificationBots });
  const connectLinkIssuer = createConnectLinkIssuer({
    transaction,
    membership: membershipLocks,
    links: telegramLinks,
    connectLinks,
    bots: notificationBots,
    settings: notificationSettings,
    clock,
    randomBytes,
  });
  const disconnectTelegram = createDisconnectTelegram({
    transaction,
    links: telegramLinks,
    signals: createNotificationSignals(),
    enqueue: botMessages.enqueue,
    settings: notificationSettings,
    clock,
  });
  const deliverAnswer = createDeliverAnswer({
    links: telegramLinks,
    bots: { pingReadiness },
    workspaces: workspaceAccess,
    send: sendMemberMessage,
    panelUrl: config.PUBLIC_WEB_URL,
    clock,
  });

  const bots = {
    settings: botSettings,
    markNeedsToken,
    sendText: createSendText({
      bots: botRepo,
      telegram,
      markNeedsToken,
      clock,
      reach: contactReach,
    }).sendText,
    sendMemberMessage,
    // Broadcast sends: their own pacer (25 per second per bot), so replies never queue behind them.
    broadcastSender: createSendBroadcastMessage({
      bots: botRepo,
      telegram,
      markNeedsToken,
      clock,
      pacer: createPacer({ perSecond: BROADCAST_MESSAGES_PER_SECOND }),
      reach: contactReach,
    }),
    pingReadiness,
    openMedia: createOpenMedia({ bots: botRepo, telegram, markNeedsToken }).openMedia,
    inboxStatus,
    paste: createPasteToken({
      ...botOwnerDeps,
      conversations,
      // Removes the links made with another bot, in the connect transaction (flow 16).
      onBotConnected: (tx, event) => linkLifecycle.onBotConnected(tx, event),
    }),
    reconnect: createReconnect(botOwnerDeps),
    disconnect: createDisconnect({ ...botOwnerDeps, conversations }),
    acceptUpdate: createAcceptUpdate({
      bots: botRepo,
      conversations,
      interceptor,
      reach: contactReach,
    }),
    healthCheck: createHealthCheck({
      bots: botRepo,
      telegram,
      clock,
      transaction,
      signals: botOwnerDeps.signals,
      secrets,
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
  const replyDelivery = createReplyDelivery({
    ...replyDeps,
    conversations: createConversationRepo(db),
    activities: createActivityRepo(db),
  });

  // --- inbox: calls the app layers of conversations, contacts, bots, workspaces and broadcasts ---
  // A broadcast item in the thread: one row of `conversations` (ADR-0010).
  const broadcastItems = createBroadcastItems({
    items: createBroadcastItemRepo(db),
    signals: createConversationSignals(),
    clock,
  });
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
    // `broadcastReads` is built after the contacts reads below (its tag names come from them).
    broadcasts: { itemDetails: (workspaceId, ids) => broadcastReads.itemDetails(workspaceId, ids) },
    broadcastItems,
    clock,
  });
  // Assign / unassign: memberships FOR SHARE, then the conversation row (sad.md §8 lock order).
  const stateChanges = createStateChanges({
    conversations: createConversationRepo(db),
    activities: createActivityRepo(db),
    signals: createConversationSignals(),
    clock,
  });
  const changeState = createChangeState({
    transaction,
    workspaces: {
      // `transaction` always hands out a Kysely transaction; the port types it as the shared executor.
      lockActiveMembers: (tx, workspaceId, accountIds) =>
        workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
      displayNames: workspaceAccess.displayNames,
    },
    changes: stateChanges,
    reads: inboxReads,
    clock,
  });
  const inboxMedia = createOpenMessageMedia({
    conversations: inboxConversations,
    bots: { openMedia: bots.openMedia },
  });
  // --- end inbox dependencies ---

  // --- contacts: reads (the list, the profile and its tag history), the member tag writes and the
  // owner tag management; the contacts -> workspaces edge (display names of adders and actors,
  // deactivated members included) is wired here. ---
  const contactRepo = createContactRepo(db);
  const tagRepo = createTagRepo(db);
  const contactTagRepo = createContactTagRepo(db);
  const tagHistoryRepo = createTagHistoryRepo(db);
  const contactReads = createContactReads({
    repo: contactRepo,
    lists: createContactListQuery(db),
    tags: tagRepo,
    contactTags: contactTagRepo,
    tagHistory: tagHistoryRepo,
    workspaces: workspaceAccess,
    // The contacts -> bots runtime edge (ADR-0002): the current Telegram bot, read through the
    // bots core's app layer; whose blocked marks the list and the profile show.
    currentBot: {
      currentBot: async (workspaceId) => {
        const bot = await pingReadiness(workspaceId);
        return bot === null ? null : { telegramBotId: bot.telegramBotId };
      },
    },
  });
  const tagSignals = createTagSignals();
  const tagWrites = createTagWrites({
    transaction,
    contacts: contactRepo,
    tags: tagRepo,
    contactTags: contactTagRepo,
    tagHistory: tagHistoryRepo,
    signals: tagSignals,
    workspaces: workspaceAccess,
    clock,
    ...(overrides.logger && { logger: overrides.logger }),
  });
  const tagAdmin = createTagAdmin({
    transaction,
    tags: tagRepo,
    contactTags: contactTagRepo,
    tagHistory: tagHistoryRepo,
    signals: tagSignals,
    clock,
    ...(overrides.logger && { logger: overrides.logger }),
  });
  // --- end contacts reads ---

  // --- broadcasts: built after team (sad.md §5); calls the app layers of contacts (audiences,
  // tag names, the block mark), conversations (broadcast items), bots (launch readiness, the
  // broadcast sender) and workspaces (membership locks, display names). Nothing calls it back
  // except `inbox` (itemDetails, through a per-request closure above) and its own workers. The
  // pg-boss queue starts after `buildDeps()`, so the jobs port is late-bound (`bindBroadcastJobs`).
  const contactAudiences = createContactAudiences({
    audiences: createAudienceQuery(db),
    tags: createTagRepo(db),
  });
  const broadcastContacts: BroadcastContactsApi = {
    // Tag names at this moment: the workspace has at most 100 tags (CLAUDE.md), read through the
    // contacts tag admin's list.
    resolveTags: async (workspaceId, tagIds) => {
      const wanted = new Set(tagIds);
      return (await tagAdmin.listTags(workspaceId)).items
        .filter((t) => wanted.has(t.id))
        .map((t) => ({ id: t.id, name: t.name }));
    },
    audienceBreakdown: contactAudiences.audienceBreakdown,
    reachableContacts: contactAudiences.reachableContacts,
    isBlocked: contactAudiences.isBlocked,
    matchingContactIds: contactAudiences.matchingContactIds,
    contactCards: contactAudiences.contactCards,
  };
  const broadcastWorkspaces = {
    // `transaction` always hands out a Kysely transaction; the port types it as the shared executor.
    lockActiveMembers: (tx: unknown, workspaceId: string, accountIds: readonly string[]) =>
      workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, [...accountIds]),
    displayNames: workspaceAccess.displayNames,
  };
  const launchReadiness = createLaunchReadiness({ bots: botRepo });
  const broadcastRepo = createBroadcastRepo(db);
  const audienceTagRepo = createAudienceTagRepo(db);
  const groupRepo = createGroupRepo(db);
  const recipientRepo = createRecipientRepo(db);
  const broadcastJobs = createBroadcastJobs();
  const broadcastSignals = createBroadcastSignals();
  const broadcastLogger = overrides.logger && { logger: overrides.logger };
  const broadcastReads = createBroadcastReads({
    broadcasts: broadcastRepo,
    audienceTags: audienceTagRepo,
    groups: groupRepo,
    recipients: recipientRepo,
    contacts: broadcastContacts,
    bots: launchReadiness,
    workspaces: broadcastWorkspaces,
  });
  // Every use case answers through the reads, after its writing transaction.
  const broadcastViews = {
    draftView: broadcastReads.draftView,
    broadcastView: broadcastReads.getBroadcast,
  };
  const broadcastDrafts = createDrafts({
    transaction,
    broadcasts: broadcastRepo,
    audienceTags: audienceTagRepo,
    groups: groupRepo,
    contacts: broadcastContacts,
    workspaces: broadcastWorkspaces,
    signals: broadcastSignals,
    views: broadcastViews,
    clock,
  });
  const broadcastGroup = createBroadcastGroup({
    transaction,
    broadcasts: broadcastRepo,
    groups: groupRepo,
    contacts: broadcastContacts,
    bots: launchReadiness,
    workspaces: broadcastWorkspaces,
    signals: broadcastSignals,
    views: broadcastViews,
    clock,
  });
  const broadcastDuplicate = createDuplicate({
    transaction,
    broadcasts: broadcastRepo,
    audienceTags: audienceTagRepo,
    groups: groupRepo,
    recipients: recipientRepo,
    signals: broadcastSignals,
    views: broadcastViews,
    clock,
  });
  const launchPreview = createLaunchPreview({
    broadcasts: broadcastRepo,
    audienceTags: audienceTagRepo,
    groups: groupRepo,
    contacts: broadcastContacts,
    bots: launchReadiness,
    clock,
  });
  const launchBroadcast = createLaunchBroadcast({
    transaction,
    broadcasts: broadcastRepo,
    audienceTags: audienceTagRepo,
    recipients: recipientRepo,
    contacts: broadcastContacts,
    workspaces: broadcastWorkspaces,
    preview: launchPreview,
    signals: broadcastSignals,
    jobs: broadcastJobs,
    views: broadcastViews,
    drafts: broadcastViews,
    clock,
    ...broadcastLogger,
  });
  const settle = createSettle({
    transaction,
    broadcasts: broadcastRepo,
    recipients: recipientRepo,
    signals: broadcastSignals,
    jobs: broadcastJobs,
    clock,
    ...broadcastLogger,
  });
  const stopBroadcast = createStopBroadcast({
    transaction,
    broadcasts: broadcastRepo,
    workspaces: broadcastWorkspaces,
    settle,
    views: broadcastViews,
  });
  // The sending chain (ADR-0007): one link per `broadcasts.send` job of a workspace.
  const sendLink = createSendLink({
    transaction,
    broadcasts: broadcastRepo,
    recipients: recipientRepo,
    contacts: broadcastContacts,
    bots: bots.broadcastSender,
    conversations: broadcastItems,
    settle,
    // One coalescer per process: its last publish time must survive between links.
    reports: createReportSignals(broadcastSignals, clock),
    jobs: broadcastJobs,
    clock,
    ...broadcastLogger,
  });
  const measureBlockedShare = createMeasureBlockedShare({
    broadcasts: broadcastRepo,
    recipients: recipientRepo,
    contacts: broadcastContacts,
    logger: overrides.logger ?? { info() {} },
  });
  // --- end broadcasts dependencies ---

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
    contactReads,
    tagWrites,
    tagAdmin,
    conversations,
    notificationReads,
    bots,
    presence,
    notificationSettings,
    connectLinkIssuer,
    disconnectTelegram,
    deliverAnswer,
    sendPings,
    /** The sixth controlled tenancy exception: workspace ids with a live link, for the cron backstop. */
    workspacesWithLiveLink: () => telegramLinks.workspacesWithLiveLink(),
    /** Starts (or keeps) a workspace's ping chain; a live chain absorbs it. */
    startPings: pingStarter.start,
    /** Binds the started job queue to the notifications jobs (the queue starts after `buildDeps()`). */
    bindNotificationJobs: (boss: Jobs) => {
      botMessages.bind(boss);
      pingStarter.bind(boss);
    },
    /** The broadcasts use cases behind `registerBroadcasts`. */
    broadcasts: {
      reads: broadcastReads,
      drafts: broadcastDrafts,
      group: broadcastGroup,
      duplicate: broadcastDuplicate,
      preview: launchPreview,
      launch: launchBroadcast,
      stop: stopBroadcast,
    },
    /** One link of a workspace's broadcasts sending chain (the `broadcasts.send` worker). */
    sendLink,
    /** The 48-hour blocked share (the `broadcasts.measure-blocked-share` worker). */
    measureBlockedShare,
    /** Binds the started job queue to the broadcasts jobs (the queue starts after `buildDeps()`). */
    bindBroadcastJobs: (boss: Jobs) => broadcastJobs.bind(boss),
    inboxReads,
    inboxMedia,
    changeState,
    conversationReplies,
    replyDelivery,
    /** Releases the database pool. */
    destroy: () => db.destroy(),
  };
}

export type Deps = ReturnType<typeof buildDeps>;
