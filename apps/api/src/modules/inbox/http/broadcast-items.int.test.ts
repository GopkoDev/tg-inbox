import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttentionCount, ConversationSummary, ThreadBroadcastItem, ThreadPage } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertBroadcast, launchBroadcastFixture } from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertBroadcastItem,
  insertConversation,
  insertMessage,
  insertReadMark,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const at = (hhmm: string) => new Date(`2026-10-23T${hhmm}:00Z`);

describe('inbox thread broadcast items (postgres; AC-08, AC-16)', () => {
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
    role: 'owner' | 'operator',
    displayName: string,
  ): Promise<Who & { membershipId: string }> => {
    const account = await insertAccount(db, { displayName });
    const session = await insertSession(db, account.id, { createdAt: at('08:00') });
    const m = await insertMembership(db, workspaceId, { accountId: account.id, role });
    return { accountId: account.id, cookies: { session: session.token }, membershipId: m.id };
  };
  const get = (who: Who | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const base = (ws: string) => `/api/workspaces/${ws}/inbox`;

  /**
   * "Acme Flowers": Olena's closed, unassigned conversation with messages at 09:00 and 09:10, the
   * broadcast "Spring prices" launched by Olga (deactivated since), delivered at 09:05.
   */
  const seed = async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const operator = await member(ws, 'operator', 'Oleh Operator');
    const owner = await member(ws, 'owner', 'Olga Owner');
    const { bot } = await insertBot(db, { workspaceId: ws });
    const olena = await insertContact(db, { workspaceId: ws, firstName: 'Olena K.' });
    const conversation = await insertConversation(db, {
      workspaceId: ws,
      contactId: olena,
      status: 'closed',
      lastActivityAt: at('09:10'),
      lastMessageReceivedAt: at('09:10'),
    });
    const m1 = await insertMessage(db, {
      workspaceId: ws,
      conversationId: conversation,
      telegramMessageId: 1n,
      sentAt: at('09:00'),
      receivedAt: at('09:00'),
    });
    const m2 = await insertMessage(db, {
      workspaceId: ws,
      conversationId: conversation,
      telegramMessageId: 2n,
      sentAt: at('09:10'),
      receivedAt: at('09:10'),
    });
    const broadcast = await insertBroadcast(db, {
      workspaceId: ws,
      authorAccountId: owner.accountId,
      name: 'Spring prices',
      text: 'New prices from Monday.',
    });
    await launchBroadcastFixture(db, {
      broadcast,
      launchedByAccountId: owner.accountId,
      telegramBotId: bot.telegramBotId,
      recipients: [{ contactId: olena, state: 'delivered' }],
    });
    const itemId = await insertBroadcastItem(db, {
      workspaceId: ws,
      conversationId: conversation,
      broadcastId: broadcast,
      positionAt: at('09:05'),
    });
    await db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: at('11:00') })
      .where('id', '=', owner.membershipId)
      .execute();
    return { ws, operator, owner, olena, conversation, m1, m2, broadcast, itemId };
  };

  it('AC-16: the thread shows the broadcast item between the messages at its time, with its name, text and the launcher named after a deactivation', async () => {
    const s = await seed();
    const res = await get(s.operator, `${base(s.ws)}/conversations/${s.conversation}/items`);
    expect(res.statusCode).toBe(200);
    const page = ThreadPage.parse(res.json());
    expect(page.items.map((i) => [i.type, i.id])).toEqual([
      ['message', s.m1],
      ['broadcast', s.itemId],
      ['message', s.m2],
    ]);
    expect(page.items[1]).toEqual({
      type: 'broadcast',
      id: s.itemId,
      workspace_id: s.ws,
      conversation_id: s.conversation,
      broadcast_id: s.broadcast,
      broadcast_name: 'Spring prices',
      text: 'New prices from Monday.',
      launched_by: { account_id: s.owner.accountId, display_name: 'Olga Owner' },
      state: 'delivered',
      position_at: at('09:05').toISOString(),
    });
  });

  it('AC-16: a not confirmed item is marked and sits at the time of the send', async () => {
    const s = await seed();
    const notConfirmed = await insertBroadcastItem(db, {
      workspaceId: s.ws,
      conversationId: s.conversation,
      broadcastId: await (async () => {
        const id = await insertBroadcast(db, {
          workspaceId: s.ws,
          authorAccountId: s.operator.accountId,
          name: 'Autumn sale',
          text: 'Sale.',
        });
        const { bot } = await insertBot(db, { workspaceId: await insertWorkspace(db) });
        await launchBroadcastFixture(db, {
          broadcast: id,
          launchedByAccountId: s.operator.accountId,
          telegramBotId: bot.telegramBotId,
          recipients: [{ contactId: s.olena, state: 'not_confirmed' }],
        });
        return id;
      })(),
      state: 'not_confirmed',
      positionAt: at('09:01'),
    });
    const res = await get(
      s.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${notConfirmed}`,
    );
    expect(res.statusCode).toBe(200);
    expect(ThreadBroadcastItem.parse(res.json())).toMatchObject({
      id: notConfirmed,
      broadcast_name: 'Autumn sale',
      launched_by: { account_id: s.operator.accountId, display_name: 'Oleh Operator' },
      state: 'not_confirmed',
      position_at: at('09:01').toISOString(),
    });
  });

  it('reads one broadcast item; an item of another conversation or workspace is 404 with no hint (AC-08)', async () => {
    const s = await seed();
    const other = await seed();
    const one = await get(
      s.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${s.itemId}`,
    );
    expect(one.statusCode).toBe(200);
    expect(ThreadBroadcastItem.parse(one.json()).id).toBe(s.itemId);

    const otherConversation = await insertConversation(db, {
      workspaceId: s.ws,
      contactId: await insertContact(db, { workspaceId: s.ws }),
    });
    const notHere = await get(
      s.operator,
      `${base(s.ws)}/conversations/${otherConversation}/broadcast-items/${s.itemId}`,
    );
    const foreign = await get(
      s.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${other.itemId}`,
    );
    const unknown = await get(
      s.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${newId()}`,
    );
    for (const r of [notHere, foreign, unknown]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual(unknown.json());
    }
    // Another workspace's member never reads it.
    const outsider = await get(
      other.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${s.itemId}`,
    );
    expect([403, 404]).toContain(outsider.statusCode);
    expect(
      (await get(null, `${base(s.ws)}/conversations/${s.conversation}/items`)).statusCode,
    ).toBe(401);
  });

  it('AC-16: reading the thread or one item changes no read mark, unread count or attention', async () => {
    const s = await seed();
    await insertReadMark(db, {
      workspaceId: s.ws,
      conversationId: s.conversation,
      accountId: s.operator.accountId,
      readThroughAt: at('09:00'),
    });
    const snapshot = async () => ({
      marks: await db
        .selectFrom('read_marks')
        .selectAll()
        .where('workspace_id', '=', s.ws)
        .orderBy('id')
        .execute(),
      unread: ConversationSummary.parse(
        (await get(s.operator, `${base(s.ws)}/conversations/${s.conversation}`)).json(),
      ).unread_count,
      attention: AttentionCount.parse((await get(s.operator, `${base(s.ws)}/attention`)).json())
        .count,
    });
    const before = await snapshot();
    await get(s.operator, `${base(s.ws)}/conversations/${s.conversation}/items`);
    await get(
      s.operator,
      `${base(s.ws)}/conversations/${s.conversation}/broadcast-items/${s.itemId}`,
    );
    expect(await snapshot()).toEqual(before);
    expect(before.unread).toBe(1);
  });
});
