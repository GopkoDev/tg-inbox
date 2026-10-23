import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AttentionCount,
  ConnectLinkLimitReachedError,
  ErrorEnvelope,
  IssuedConnectLink,
  NotificationSettings,
  PingsNeedWorkingBotError,
  TelegramAlreadyLinkedError,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../../../test/fixtures/conversations.js';
import { insertConnectLink, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-19T10:00:00Z');
const at = (hhmm: string) => new Date(`2026-10-19T${hhmm}:00Z`);

describe('notifications routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; cookies: { session: string } };
  const member = async (
    workspaceId: string,
    role: 'owner' | 'operator' = 'operator',
    state: 'active' | 'deactivated' = 'active',
  ): Promise<Who> => {
    const account = await insertAccount(db);
    const session = await insertSession(db, account.id, { createdAt: at('09:00') });
    await insertMembership(db, workspaceId, { accountId: account.id, role, state });
    return { accountId: account.id, cookies: { session: session.token } };
  };
  const call = (
    who: Who | null,
    method: 'GET' | 'POST',
    url: string,
    extra: { payload?: string; headers?: Record<string, string> } = {},
  ) => app.inject({ method, url, cookies: who?.cookies, ...extra });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const url = (ws: string, tail: string) => `/api/workspaces/${ws}/${tail}`;

  const workspaceWithBot = async (
    state: 'connected' | 'needs_token' | 'taken_over' = 'connected',
  ) => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const { bot } = await insertBot(db, { workspaceId: ws, state, username: 'acme_flowers_bot' });
    return { ws, bot };
  };

  const routes = [
    ['GET', 'inbox/attention'],
    ['GET', 'notifications'],
    ['POST', 'notifications/telegram/connect-link'],
    ['POST', 'notifications/telegram/disconnect'],
  ] as const;

  describe.each(routes)('%s %s', (method, tail) => {
    it('AC-12: 401 signed out, 403 ACCESS_REMOVED for a deactivated member, 404 with no hint for a stranger or a malformed id', async () => {
      const { ws } = await workspaceWithBot();
      const out = await call(null, method, url(ws, tail));
      expect(out.statusCode).toBe(401);
      expect(errorOf(out).code).toBe('UNAUTHENTICATED');

      const removed = await member(ws, 'operator', 'deactivated');
      const gone = await call(removed, method, url(ws, tail));
      expect(gone.statusCode).toBe(403);
      expect(errorOf(gone).code).toBe('ACCESS_REMOVED');

      const other = await workspaceWithBot();
      const stranger = await member(other.ws);
      const foreign = await call(stranger, method, url(ws, tail));
      expect(foreign.statusCode).toBe(404);
      const unknown = await call(stranger, method, url(newUnknown(), tail));
      const malformed = await call(stranger, method, url('not-a-uuid', tail));
      expect(unknown.body).toBe(foreign.body);
      expect(malformed.statusCode).toBe(404);
      expect(malformed.body).toBe(foreign.body);
    });
  });
  const newUnknown = () => '01920000-0000-7000-8000-00000000dead';

  it("AC-01: attention count is the caller's open unread conversations, for both roles", async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws, 'operator');
    const owner = await member(ws, 'owner');
    const mate = await member(ws, 'operator');
    const waiting = async (assignee: string | null, status: 'open' | 'closed' = 'open') => {
      const contactId = await insertContact(db, { workspaceId: ws });
      const conversationId = await insertConversation(db, {
        workspaceId: ws,
        contactId,
        status,
        assigneeAccountId: assignee,
        lastMessageReceivedAt: at('09:30'),
        lastActivityAt: at('09:30'),
      });
      await insertMessage(db, {
        workspaceId: ws,
        conversationId,
        telegramMessageId: 1n,
        receivedAt: at('09:30'),
        sentAt: at('09:30'),
      });
    };
    await waiting(me.accountId);
    await waiting(me.accountId);
    await waiting(null);
    await waiting(mate.accountId);
    await waiting(null, 'closed');

    const res = await call(me, 'GET', url(ws, 'inbox/attention'), {
      headers: { 'x-background-request': '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(AttentionCount.parse(res.json())).toEqual({ workspace_id: ws, count: 3 });
    const forOwner = await call(owner, 'GET', url(ws, 'inbox/attention'));
    // Same rule for an owner: theirs (none) plus the unassigned one.
    expect(AttentionCount.parse(forOwner.json()).count).toBe(1);
  });

  it('AC-04/AC-13: settings — not connected with a ready bot offers connect; no working bot does not', async () => {
    const { ws } = await workspaceWithBot();
    const op = await member(ws, 'operator');
    const res = await call(op, 'GET', url(ws, 'notifications'));
    expect(res.statusCode).toBe(200);
    expect(NotificationSettings.parse(res.json())).toMatchObject({
      workspace_id: ws,
      caller_role: 'operator',
      telegram: { state: 'not_connected' },
      can_connect: true,
    });

    const taken = await workspaceWithBot('taken_over');
    const owner = await member(taken.ws, 'owner');
    const refused = NotificationSettings.parse(
      (await call(owner, 'GET', url(taken.ws, 'notifications'))).json(),
    );
    expect(refused).toMatchObject({ caller_role: 'owner', can_connect: false });
    expect(refused.bot.state).toBe('taken_over');
  });

  it("AC-10/AC-12: settings show only the caller's own link, never a Telegram id", async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    const mate = await member(ws);
    const mine = await insertTelegramLink(db, {
      workspaceId: ws,
      accountId: me.accountId,
      displayName: 'Maria S',
      telegramUserId: 424242424n,
    });
    await insertTelegramLink(db, {
      workspaceId: ws,
      accountId: mate.accountId,
      displayName: 'Teammate T',
      blockedAt: at('09:00'),
    });
    const res = await call(me, 'GET', url(ws, 'notifications'));
    const body = NotificationSettings.parse(res.json());
    expect(body.telegram).toMatchObject({
      state: 'connected',
      display_name: 'Maria S',
      pings: 'on',
    });
    expect(res.body).not.toContain('Teammate T');
    expect(res.body).not.toContain(String(mine.telegramUserId));

    const blocked = NotificationSettings.parse(
      (await call(mate, 'GET', url(ws, 'notifications'))).json(),
    );
    expect(blocked.telegram).toMatchObject({ state: 'connected', pings: 'not_reachable' });
  });

  it('AC-04/AC-05: a connect link is made for the caller, stores only a hash, and a newer one replaces the older', async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    const first = await call(me, 'POST', url(ws, 'notifications/telegram/connect-link'));
    expect(first.statusCode).toBe(201);
    const issued = IssuedConnectLink.parse(first.json());
    expect(issued).toMatchObject({ workspace_id: ws, bot_username: 'acme_flowers_bot' });
    expect(issued.expires_at).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString());
    const token = new URL(issued.url).searchParams.get('start')!.slice('tgi_'.length);

    const rows = await db
      .selectFrom('connect_links')
      .selectAll()
      .where('workspace_id', '=', ws)
      .where('account_id', '=', me.accountId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.toString('utf8')).not.toContain(token);

    await call(me, 'POST', url(ws, 'notifications/telegram/connect-link'));
    const after = await db
      .selectFrom('connect_links')
      .select('replaced_at')
      .where('workspace_id', '=', ws)
      .where('account_id', '=', me.accountId)
      .execute();
    expect(after).toHaveLength(2);
    expect(after.filter((r) => r.replaced_at !== null)).toHaveLength(1);
  });

  it('AC-13: the sixth request in 10 minutes is 429 CONNECT_LINK_LIMIT_REACHED with Retry-After and no row', async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    for (let i = 0; i < 5; i++) {
      await insertConnectLink(db, {
        workspaceId: ws,
        accountId: me.accountId,
        createdAt: new Date(NOW.getTime() - (5 - i) * 60_000),
        replacedAt: new Date(NOW.getTime() - 30_000),
      });
    }
    const res = await call(me, 'POST', url(ws, 'notifications/telegram/connect-link'));
    expect(res.statusCode).toBe(429);
    const body = ConnectLinkLimitReachedError.parse(res.json());
    // The oldest of the five (5 minutes ago) leaves the window 5 minutes from now.
    expect(body.error.details).toEqual({
      limit: 5,
      window_seconds: 600,
      retry_at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    });
    expect(res.headers['retry-after']).toBe('300');
    const count = await db
      .selectFrom('connect_links')
      .select(db.fn.countAll<string>().as('n'))
      .where('workspace_id', '=', ws)
      .where('account_id', '=', me.accountId)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(5);
  });

  it('AC-06: an already linked member gets 409 TELEGRAM_ALREADY_LINKED with their settings', async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    await insertTelegramLink(db, { workspaceId: ws, accountId: me.accountId });
    const res = await call(me, 'POST', url(ws, 'notifications/telegram/connect-link'));
    expect(res.statusCode).toBe(409);
    const body = TelegramAlreadyLinkedError.parse(res.json());
    expect(body.error.details.settings).toMatchObject({
      workspace_id: ws,
      telegram: { state: 'connected' },
      can_connect: false,
    });
  });

  it.each(['needs_token', 'taken_over'] as const)(
    'AC-13: a %s bot gives 409 PINGS_NEED_WORKING_BOT with the settings and creates no link',
    async (state) => {
      const { ws } = await workspaceWithBot(state);
      const owner = await member(ws, 'owner');
      const res = await call(owner, 'POST', url(ws, 'notifications/telegram/connect-link'));
      expect(res.statusCode).toBe(409);
      const body = PingsNeedWorkingBotError.parse(res.json());
      expect(body.error.details.settings).toMatchObject({
        caller_role: 'owner',
        can_connect: false,
        telegram: { state: 'not_connected' },
      });
      expect(body.error.details.settings.bot.state).toBe(state);
      const rows = await db
        .selectFrom('connect_links')
        .select('id')
        .where('workspace_id', '=', ws)
        .execute();
      expect(rows).toHaveLength(0);
    },
  );

  it('a workspace with no bot at all is also 409 PINGS_NEED_WORKING_BOT', async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const op = await member(ws);
    const res = await call(op, 'POST', url(ws, 'notifications/telegram/connect-link'));
    expect(res.statusCode).toBe(409);
    expect(PingsNeedWorkingBotError.parse(res.json()).error.details.settings.bot.state).toBe(
      'not_connected',
    );
  });

  it('a body with a non-JSON content type is 415 on both POSTs', async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    for (const tail of [
      'notifications/telegram/connect-link',
      'notifications/telegram/disconnect',
    ]) {
      const res = await call(me, 'POST', url(ws, tail), {
        payload: 'x',
        headers: { 'content-type': 'text/plain' },
      });
      expect(res.statusCode).toBe(415);
      expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it("AC-04/AC-12: disconnect removes only the caller's link, is idempotent and answers the settings", async () => {
    const { ws } = await workspaceWithBot();
    const me = await member(ws);
    const mate = await member(ws);
    const owner = await member(ws, 'owner');
    await insertTelegramLink(db, { workspaceId: ws, accountId: me.accountId });
    await insertTelegramLink(db, { workspaceId: ws, accountId: mate.accountId });

    const first = await call(me, 'POST', url(ws, 'notifications/telegram/disconnect'));
    expect(first.statusCode).toBe(200);
    expect(NotificationSettings.parse(first.json())).toMatchObject({
      telegram: { state: 'not_connected' },
      can_connect: true,
    });
    const again = await call(me, 'POST', url(ws, 'notifications/telegram/disconnect'));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());

    // A business owner has no link and removes nothing of anyone else's.
    const byOwner = await call(owner, 'POST', url(ws, 'notifications/telegram/disconnect'));
    expect(byOwner.statusCode).toBe(200);
    const live = await db
      .selectFrom('telegram_links')
      .select('account_id')
      .where('workspace_id', '=', ws)
      .where('removed_at', 'is', null)
      .execute();
    expect(live.map((l) => l.account_id)).toEqual([mate.accountId]);
    const jobs = await db
      .selectFrom('telegram_links')
      .select('removed_reason')
      .where('account_id', '=', me.accountId)
      .executeTakeFirstOrThrow();
    expect(jobs.removed_reason).toBe('member');
  });
});
