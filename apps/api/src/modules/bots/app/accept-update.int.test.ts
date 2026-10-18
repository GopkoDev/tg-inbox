import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { telegramUpdate } from '../../../test/fixtures/telegram.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import { createConversations } from '../../conversations/app/conversations.js';
import { createConversationRepo } from '../../conversations/infra/conversation-repo.js';
import { createMessageRepo } from '../../conversations/infra/message-repo.js';
import { createBotRepo } from '../infra/bot-repo.js';
import { createTokenCipher } from '../infra/token-cipher.js';
import { createAcceptUpdate } from './accept-update.js';

const T = new Date('2026-10-11T10:00:00Z');
const T_S = T.getTime() / 1000;
const log = { info: () => undefined };

describe('acceptUpdate (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let accept: ReturnType<typeof createAcceptUpdate>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    const clock = fixedClock(new Date(T.getTime() + 60_000));
    accept = createAcceptUpdate({
      bots: createBotRepo(db, createTokenCipher(testBotKey)),
      conversations: createConversations({
        transaction: (fn) => db.transaction().execute(fn),
        conversations: createConversationRepo(db),
        messages: createMessageRepo(db),
        contacts: createContacts({ repo: createContactRepo(db), clock }),
        clock,
      }),
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const holdings = async (workspaceId: string) => ({
    contacts: await db
      .selectFrom('contacts')
      .select('telegram_user_id')
      .where('workspace_id', '=', workspaceId)
      .execute(),
    conversations: await db
      .selectFrom('conversations')
      .select('telegram_chat_id')
      .where('workspace_id', '=', workspaceId)
      .execute(),
    messages: await db
      .selectFrom('messages')
      .select('body')
      .where('workspace_id', '=', workspaceId)
      .execute(),
  });

  it('the same person writing to two businesses lands separately in each (AC-13)', async () => {
    const acme = await insertWorkspace(db);
    const bolt = await insertWorkspace(db);
    const a = await insertBot(db, { workspaceId: acme, connectedAt: T });
    const b = await insertBot(db, { workspaceId: bolt, connectedAt: T });
    const person = { fromId: 760001, date: T_S + 5 };

    expect(
      await accept.acceptUpdate(
        a.bot.id,
        a.webhookSecret!,
        telegramUpdate({ ...person, updateId: 1, messageId: 1, text: 'to Acme' }),
        log,
      ),
    ).toBe('captured');
    expect(
      await accept.acceptUpdate(
        b.bot.id,
        b.webhookSecret!,
        telegramUpdate({ ...person, updateId: 1, messageId: 1, text: 'to Bolt' }),
        log,
      ),
    ).toBe('captured');

    expect(await holdings(acme)).toEqual({
      contacts: [{ telegram_user_id: '760001' }],
      conversations: [{ telegram_chat_id: '760001' }],
      messages: [{ body: 'to Acme' }],
    });
    expect(await holdings(bolt)).toEqual({
      contacts: [{ telegram_user_id: '760001' }],
      conversations: [{ telegram_chat_id: '760001' }],
      messages: [{ body: 'to Bolt' }],
    });
  });

  it("bot A's secret on bot B's id captures nothing in either workspace (AC-14)", async () => {
    const acme = await insertWorkspace(db);
    const bolt = await insertWorkspace(db);
    const a = await insertBot(db, { workspaceId: acme, connectedAt: T });
    const b = await insertBot(db, { workspaceId: bolt, connectedAt: T });
    const outcome = await accept.acceptUpdate(
      b.bot.id,
      a.webhookSecret!,
      telegramUpdate({ fromId: 760002, date: T_S + 5, updateId: 1, messageId: 1 }),
      log,
    );
    expect(outcome).toBe('unauthorized');
    expect((await holdings(acme)).messages).toEqual([]);
    expect((await holdings(bolt)).messages).toEqual([]);
  });
});
