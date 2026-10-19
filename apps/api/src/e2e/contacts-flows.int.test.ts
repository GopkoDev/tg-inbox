import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttentionCount,
  ContactPage,
  ContactProfile,
  ContactTagAdded,
  ContactTagRemoved,
  ConversationSummary,
  ErrorEnvelope,
  LiveFrame,
  TagDeleted,
  TagHistoryPage,
  TagList,
  TagRenameResult,
  ThreadPage,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { createNotificationQueries } from '../modules/conversations/infra/notification-queries.js';
import { startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertContact } from '../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../test/fixtures/tags.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
type WebSocket = Awaited<ReturnType<FastifyInstance['injectWS']>>;

/**
 * Contacts end-to-end stories (test-plan §E2E): the real routes, the real webhook, the live socket
 * and the fake Bot API against Postgres. After every story the integrity queries of every touched
 * workspace find no row.
 */
describe('contacts end-to-end stories (postgres + fake Bot API + live socket)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let nextUpdate = 1;
  let nextMessage = 1;
  let touched: string[] = [];
  let sockets: WebSocket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(deps.db);
    fake.reset();
    touched = [];
    sockets = [];
  });
  afterEach(async () => {
    for (const s of sockets) s.terminate();
    expect(await integrityViolations(deps.db, touched)).toEqual([]);
  });

  type Person = { accountId: string; cookies: { session: string } };
  const nowS = () => Math.floor(Date.now() / 1000);

  async function person(
    ws: string,
    o: { name: string; role?: 'owner' | 'operator'; state?: 'active' | 'deactivated' },
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: o.name });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, {
      accountId: account.id,
      role: o.role ?? 'operator',
      state: o.state ?? 'active',
    });
    return { accountId: account.id, cookies: { session: session.token } };
  }

  /** A workspace with a connected bot (scripted on the fake), an owner and two operators. */
  async function workspace(name = 'Acme Flowers') {
    const ws = await insertWorkspace(deps.db, name);
    touched.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
    fake.bot(token).script({});
    return {
      ws,
      token,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, { name: 'Olga Owner', role: 'owner' }),
      operator: await person(ws, { name: 'Oleh Operator' }),
      mate: await person(ws, { name: 'Tim Teammate' }),
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const call = (who: Person | null, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who?.cookies, ...(payload && { payload }) });
  const api = (w: W, tail: string) => `/api/workspaces/${w.ws}/${tail}`;
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  const deliver = (
    w: W,
    fromId: number,
    text: string,
    from: { first_name?: string; username?: string } = {},
    later = 0,
  ) =>
    signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: nowS() + later,
        fromId,
        text,
        from: { first_name: 'Maria', username: `maria_${fromId}`, ...from },
      }),
    );
  /** A customer's message through the webhook: the contact id and the conversation id. */
  async function customerWrites(
    w: W,
    fromId: number,
    text = 'Do you have tulips?',
    from = {},
    later = 0,
  ) {
    expect((await deliver(w, fromId, text, from, later)).statusCode).toBe(200);
    const contact = await deps.db
      .selectFrom('contacts')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('telegram_user_id', '=', BigInt(fromId) as never)
      .executeTakeFirstOrThrow();
    const conversation = await deps.db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('contact_id', '=', contact.id)
      .executeTakeFirstOrThrow();
    return { contactId: contact.id, conversationId: conversation.id };
  }

  async function openSocket(w: W, who: Person) {
    const socket = await app.injectWS(api(w, 'inbox/live'), {
      headers: { origin: ORIGIN, cookie: `session=${who.cookies.session}` },
    });
    sockets.push(socket);
    const frames: LiveFrame[] = [];
    socket.on('message', (data: Buffer) => frames.push(LiveFrame.parse(JSON.parse(String(data)))));
    return { socket, frames };
  }
  const framesOf = (frames: LiveFrame[], type: string) => frames.filter((f) => f.type === type);
  const waitFor = (fn: () => void | Promise<void>) =>
    vi.waitFor(fn, { timeout: 3000, interval: 20 });

  const add = async (
    w: W,
    who: Person,
    contactId: string,
    tag: { name: string } | { tag_id: string },
    source: 'inbox' | 'profile' = 'inbox',
  ) => {
    const res = await call(who, 'POST', api(w, `contacts/${contactId}/tags`), { ...tag, source });
    expect(res.statusCode, res.body).toBe(200);
    return ContactTagAdded.parse(res.json());
  };
  const remove = async (
    w: W,
    who: Person,
    contactId: string,
    tagId: string,
    source: 'inbox' | 'profile' = 'profile',
  ) => {
    const res = await call(who, 'POST', api(w, `contacts/${contactId}/tags/${tagId}/remove`), {
      source,
    });
    expect(res.statusCode, res.body).toBe(200);
    return ContactTagRemoved.parse(res.json());
  };
  const profile = async (w: W, who: Person, contactId: string) => {
    const res = await call(who, 'GET', api(w, `contacts/${contactId}`));
    expect(res.statusCode).toBe(200);
    return ContactProfile.parse(res.json());
  };
  const history = async (w: W, who: Person, contactId: string) => {
    const res = await call(who, 'GET', api(w, `contacts/${contactId}/tag-history`));
    expect(res.statusCode).toBe(200);
    return TagHistoryPage.parse(res.json()).items;
  };
  const list = async (w: W, who: Person, query = '') => {
    const res = await call(who, 'GET', api(w, `contacts${query}`));
    expect(res.statusCode).toBe(200);
    return ContactPage.parse(res.json());
  };
  const tagList = async (w: W, who: Person) => {
    const res = await call(who, 'GET', api(w, 'tags'));
    expect(res.statusCode).toBe(200);
    return TagList.parse(res.json());
  };
  const sends = (token: string) => fake.calls(token).filter((c) => c.method === 'sendMessage');

  it('story 1 — tagging from the inbox, a teammate sees it live, the list finds the contact (AC-06)', async () => {
    const w = await workspace();
    const { contactId } = await customerWrites(w, 920001);
    const mine = await openSocket(w, w.operator);
    const theirs = await openSocket(w, w.mate);
    const elsewhere = await workspace('Bolt Bikes');
    const stranger = await openSocket(elsewhere, elsewhere.operator);
    const sentBefore = sends(w.token).length;

    const vip = await add(w, w.operator, contactId, { name: 'VIP' });
    expect(vip).toMatchObject({ outcome: 'recorded', tag_created: true, tag: { name: 'VIP' } });
    const wholesale = await add(w, w.operator, contactId, { name: 'Wholesale' });
    const reset = theirs.frames.length;

    // "vi" offers VIP; "Kyiv" matches nothing, so it is created by name, then Wholesale goes.
    const kyiv = await add(w, w.operator, contactId, { name: 'Kyiv' });
    expect(kyiv.tag_created).toBe(true);
    const removed = await remove(w, w.operator, contactId, wholesale.tag.id);
    expect(removed.outcome).toBe('recorded');
    expect(removed.tags.map((t) => t.name).sort()).toEqual(['Kyiv', 'VIP']);

    // The teammate's open profile hears about both changes and the refetch shows the result.
    await waitFor(() => {
      const heard = framesOf(theirs.frames.slice(reset), 'contact.changed');
      expect(heard.length).toBeGreaterThanOrEqual(2);
      for (const f of heard) expect(f).toMatchObject({ contact_id: contactId, change: 'tags' });
    });
    const seen = await profile(w, w.mate, contactId);
    expect(seen.tags.map((t) => t.name).sort()).toEqual(['Kyiv', 'VIP']);
    expect(seen.tags.find((t) => t.name === 'VIP')!.added_by).toMatchObject({
      display_name: 'Oleh Operator',
    });
    // The member who made the change hears it too (their other tab); no frame crosses workspaces.
    await waitFor(() => expect(framesOf(mine.frames, 'contact.changed').length).toBeGreaterThan(0));
    expect(framesOf(stranger.frames, 'contact.changed')).toEqual([]);
    expect(framesOf(stranger.frames, 'tags.changed')).toEqual([]);

    // The same change twice: nothing recorded, no entry, no frame.
    const frameCount = theirs.frames.length;
    const entries = (await history(w, w.mate, contactId)).length;
    expect((await add(w, w.operator, contactId, { tag_id: vip.tag.id })).outcome).toBe('unchanged');
    expect((await remove(w, w.operator, contactId, wholesale.tag.id)).outcome).toBe('unchanged');
    expect(await history(w, w.mate, contactId)).toHaveLength(entries);
    await new Promise((r) => setTimeout(r, 150));
    expect(framesOf(theirs.frames.slice(frameCount), 'contact.changed')).toEqual([]);

    // History: three additions and one removal, newest first, with member, source and time.
    const entriesNow = await history(w, w.mate, contactId);
    expect(entriesNow.map((e) => [e.kind, e.tag_name]).reverse()).toEqual([
      ['added', 'VIP'],
      ['added', 'Wholesale'],
      ['added', 'Kyiv'],
      ['removed', 'Wholesale'],
    ]);
    for (const e of entriesNow) {
      expect(e).toMatchObject({
        actor: { display_name: 'Oleh Operator' },
        source: expect.any(String),
      });
    }

    // The Contacts list filter finds the contact by the new tags; none excludes it.
    const byKyiv = await list(w, w.mate, `?mode=any&tag=${kyiv.tag.id}`);
    expect(byKyiv.items.map((i) => i.id)).toEqual([contactId]);
    expect(
      (await list(w, w.mate, `?mode=all&tag=${kyiv.tag.id}&tag=${vip.tag.id}`)).items,
    ).toHaveLength(1);
    expect((await list(w, w.mate, `?mode=any&tag=${wholesale.tag.id}`)).items).toEqual([]);

    // A tag change is never sent to the customer.
    expect(sends(w.token)).toHaveLength(sentBefore);
  }, 60_000);

  it('story 2 — owner rename, merge on confirmation and delete against the confirmed count (AC-09, AC-10)', async () => {
    const w = await workspace();
    const db = deps.db;
    const owner = w.owner.accountId;
    const op = w.operator.accountId;
    const vipId = await insertTag(db, {
      workspaceId: w.ws,
      createdByAccountId: owner,
      name: 'VIP',
    });
    const clientsId = await insertTag(db, {
      workspaceId: w.ws,
      createdByAccountId: owner,
      name: 'vip-clients',
    });
    const promoId = await insertTag(db, {
      workspaceId: w.ws,
      createdByAccountId: owner,
      name: 'Old promo',
    });
    const contacts: string[] = [];
    for (let i = 0; i < 54; i++) contacts.push(await insertContact(db, { workspaceId: w.ws }));
    const at = (day: number) => new Date(Date.UTC(2026, 5, day));
    // VIP on 12 contacts (0-11); vip-clients on 3: contact 0 (also VIP, added earlier here),
    // contact 12 and 13 (only vip-clients); Old promo on the 40 after them.
    for (const i of [...Array(12).keys()]) {
      await insertContactTag(db, {
        workspaceId: w.ws,
        contactId: contacts[i]!,
        tagId: vipId,
        addedByAccountId: owner,
        addedAt: at(10),
      });
    }
    for (const [i, day, by] of [
      [0, 2, op],
      [12, 3, op],
      [13, 4, owner],
    ] as const) {
      await insertContactTag(db, {
        workspaceId: w.ws,
        contactId: contacts[i]!,
        tagId: clientsId,
        addedByAccountId: by,
        addedAt: at(day),
      });
    }
    for (const i of [...Array(40).keys()]) {
      await insertContactTag(db, {
        workspaceId: w.ws,
        contactId: contacts[14 + i]!,
        tagId: promoId,
        addedByAccountId: op,
        addedAt: at(20),
      });
    }
    const sockets = [await openSocket(w, w.owner), await openSocket(w, w.operator)];
    const ownerCall = (tail: string, payload: object) =>
      call(w.owner, 'POST', api(w, tail), payload);
    const tagsChanged = () => sockets.map((s) => framesOf(s.frames, 'tags.changed').length);

    // Rename vip-clients -> Loyal.
    const renamed = TagRenameResult.parse(
      (await ownerCall(`tags/${clientsId}/rename`, { name: 'Loyal' })).json(),
    );
    expect(renamed).toMatchObject({
      outcome: 'renamed',
      tag: { id: clientsId, name: 'Loyal', contact_count: 3 },
    });
    expect((await profile(w, w.owner, contacts[13]!)).tags.map((t) => t.name)).toEqual(['Loyal']);
    await waitFor(() => expect(tagsChanged()).toEqual([1, 1]));

    // Rename Loyal -> vip: the name is held by VIP, so it says so and changes nothing.
    const clash = await ownerCall(`tags/${clientsId}/rename`, { name: 'vip' });
    expect(clash.statusCode).toBe(409);
    expect(errorOf(clash)).toMatchObject({
      code: 'TAG_NAME_TAKEN',
      details: { tag: { id: vipId, name: 'VIP', contact_count: 12 } },
    });
    expect(tagsChanged()).toEqual([1, 1]);

    // Confirmed: merge into VIP. 14 contacts, Loyal gone.
    const merged = TagRenameResult.parse(
      (
        await ownerCall(`tags/${clientsId}/rename`, { name: 'vip', merge_into_tag_id: vipId })
      ).json(),
    );
    expect(merged).toMatchObject({
      outcome: 'merged',
      merged_tag_id: clientsId,
      tag: { id: vipId, name: 'VIP', contact_count: 14 },
    });
    await waitFor(() => expect(tagsChanged()).toEqual([2, 2]));
    const tags = await tagList(w, w.owner);
    expect(tags.items.map((t) => t.name).sort()).toEqual(['Old promo', 'VIP']);
    // The contact with both keeps the earlier addition; a Loyal-only contact keeps who and when.
    const both = (await profile(w, w.owner, contacts[0]!)).tags;
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ name: 'VIP', added_at: at(2).toISOString() });
    expect((await profile(w, w.owner, contacts[13]!)).tags[0]).toMatchObject({
      name: 'VIP',
      added_at: at(4).toISOString(),
      added_by: { display_name: 'Olga Owner' },
    });
    // History: the 3 carriers record the merge by the owner; VIP-only contacts get none.
    for (const i of [0, 12, 13]) {
      const entries = await history(w, w.owner, contacts[i]!);
      expect(entries.find((e) => e.kind === 'merged')).toMatchObject({
        tag_name: 'Loyal',
        merged_into_name: 'VIP',
        actor: { display_name: 'Olga Owner' },
        source: 'settings',
      });
    }
    expect((await history(w, w.owner, contacts[5]!)).map((e) => e.kind)).toEqual(['added']);

    // Delete Old promo: a stale count refuses with the current one, then the confirmed count deletes.
    const stale = await ownerCall(`tags/${promoId}/delete`, { expected_count: 39 });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale)).toMatchObject({
      code: 'TAG_COUNT_CHANGED',
      details: { tag: { id: promoId, contact_count: 40 } },
    });
    expect((await tagList(w, w.owner)).items.map((t) => t.name)).toContain('Old promo');
    expect(tagsChanged()).toEqual([2, 2]);
    const deleted = TagDeleted.parse(
      (await ownerCall(`tags/${promoId}/delete`, { expected_count: 40 })).json(),
    );
    expect(deleted).toMatchObject({ tag_id: promoId, removed_from_count: 40 });
    await waitFor(() => expect(tagsChanged()).toEqual([3, 3]));
    expect((await tagList(w, w.owner)).items.map((t) => t.name)).toEqual(['VIP']);
    const deletions = await db
      .selectFrom('contact_tag_history')
      .select('contact_id')
      .where('workspace_id', '=', w.ws)
      .where('kind', '=', 'deleted')
      .where('tag_id', '=', promoId)
      .execute();
    expect(new Set(deletions.map((d) => d.contact_id))).toEqual(new Set(contacts.slice(14, 54)));
    expect(
      (await history(w, w.owner, contacts[20]!)).find((e) => e.kind === 'deleted'),
    ).toMatchObject({
      tag_name: 'Old promo',
      actor: { display_name: 'Olga Owner' },
    });
    expect((await profile(w, w.owner, contacts[20]!)).tags).toEqual([]);

    // Case-only rename changes the display only; the same text changes nothing.
    const recased = TagRenameResult.parse(
      (await ownerCall(`tags/${vipId}/rename`, { name: 'vip' })).json(),
    );
    expect(recased).toMatchObject({ outcome: 'renamed', tag: { name: 'vip', contact_count: 14 } });
    const same = TagRenameResult.parse(
      (await ownerCall(`tags/${vipId}/rename`, { name: 'vip' })).json(),
    );
    expect(same.outcome).toBe('unchanged');

    // AC-10: every tag's count equals the list's matching count for it.
    for (const t of (await tagList(w, w.operator)).items) {
      expect((await list(w, w.operator, `?mode=any&tag=${t.id}`)).matching_count).toBe(
        t.contact_count,
      );
    }
    // The operator cannot rename or delete.
    const refused = await call(w.operator, 'POST', api(w, `tags/${vipId}/rename`), { name: 'x' });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe('OWNER_ONLY');
  }, 120_000);

  it('story 3 — a renamed customer keeps the tags, a deactivated adder stays named, tagging works with the bot disconnected, another workspace is a separate contact (AC-13)', async () => {
    const w = await workspace();
    const bolt = await workspace('Bolt Bikes');
    const leaver = await person(w.ws, { name: 'Lena Leaver' });
    const { contactId } = await customerWrites(w, 920013, 'Hello');
    await add(w, leaver, contactId, { name: 'VIP' });
    await add(w, leaver, contactId, { name: 'Kyiv' });
    // The adder leaves the team.
    await deps.db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date() })
      .where('workspace_id', '=', w.ws)
      .where('account_id', '=', leaver.accountId)
      .execute();

    // The customer changes their Telegram name and writes again.
    await customerWrites(
      w,
      920013,
      'Hello again',
      { first_name: 'Marie', username: 'marie_new' },
      30,
    );
    const renamedProfile = await profile(w, w.operator, contactId);
    expect(renamedProfile.first_name).toBe('Marie');
    expect(renamedProfile.tags.map((t) => t.name).sort()).toEqual(['Kyiv', 'VIP']);
    for (const t of renamedProfile.tags) {
      expect(t.added_by.display_name).toBe('Lena Leaver');
    }
    for (const e of await history(w, w.operator, contactId)) {
      expect(e.actor.display_name).toBe('Lena Leaver');
    }

    // The same person writes to another workspace's bot: a separate contact, none of the tags.
    const other = await customerWrites(bolt, 920013, 'Hi Bolt');
    expect(other.contactId).not.toBe(contactId);
    expect((await profile(bolt, bolt.operator, other.contactId)).tags).toEqual([]);
    expect((await tagList(bolt, bolt.operator)).items).toEqual([]);
    expect((await list(bolt, bolt.operator)).total_count).toBe(1);

    // The bot is disconnected: tagging, the list and the profile still work, nothing goes to Telegram.
    const off = await call(w.owner, 'POST', api(w, 'bot/disconnect'));
    expect(off.statusCode).toBe(200);
    const calls = fake.calls(w.token).length;
    await add(w, w.operator, contactId, { name: 'Loyal' });
    const vipId = (await tagList(w, w.operator)).items.find((t) => t.name === 'VIP')!.id;
    await remove(w, w.operator, contactId, vipId);
    const afterOff = await profile(w, w.operator, contactId);
    expect(afterOff.tags.map((t) => t.name).sort()).toEqual(['Kyiv', 'Loyal']);
    expect((await list(w, w.operator, `?mode=any&tag=${vipId}`)).items).toEqual([]);
    expect(fake.calls(w.token)).toHaveLength(calls);
  }, 60_000);

  it('story 4 — reading a profile never marks anything read, while customer messages arrive (AC-05)', async () => {
    const w = await workspace();
    const { contactId, conversationId } = await customerWrites(w, 920005, 'First');
    expect((await deliver(w, 920005, 'Second')).statusCode).toBe(200);
    const queries = createNotificationQueries(deps.db);
    const who = [w.operator, w.owner];
    const snapshot = async () => ({
      marks: await deps.db
        .selectFrom('read_marks')
        .selectAll()
        .where('workspace_id', '=', w.ws)
        .orderBy('id')
        .execute(),
      unread: ConversationSummary.parse(
        (await call(w.operator, 'GET', api(w, `inbox/conversations/${conversationId}`))).json(),
      ).unread_count,
      attention: AttentionCount.parse(
        (await call(w.operator, 'GET', api(w, 'inbox/attention'))).json(),
      ).count,
      due: await queries.waitingForPings(w.ws, { accountIds: who.map((p) => p.accountId) }),
    });
    const readProfile = async (p: Person) => {
      await profile(w, p, contactId);
      await history(w, p, contactId);
      const summary = await call(p, 'GET', api(w, `inbox/contacts/${contactId}/conversation`));
      expect(summary.statusCode).toBe(200);
      const items = await call(p, 'GET', api(w, `inbox/conversations/${conversationId}/items`));
      expect(items.statusCode).toBe(200);
      expect(ThreadPage.parse(items.json()).items.length).toBeGreaterThan(0);
    };

    const before = await snapshot();
    expect(before.unread).toBe(2);
    expect(before.attention).toBeGreaterThan(0);
    for (const p of who) await readProfile(p);
    expect(await snapshot()).toEqual(before);

    // A new customer message lands while the profile is open: still unread, nothing read.
    expect((await deliver(w, 920005, 'Third')).statusCode).toBe(200);
    for (const p of who) await readProfile(p);
    const after = await snapshot();
    expect(after.marks).toEqual(before.marks);
    expect(after.unread).toBe(3);
    expect(after.attention).toBe(before.attention);
    expect(after.due).toEqual(before.due);

    // Only opening the conversation in the inbox marks it read, as before.
    const thread = ThreadPage.parse(
      (await call(w.operator, 'GET', api(w, `inbox/conversations/${conversationId}/items`))).json(),
    );
    const last = thread.items.filter((i) => i.type === 'message').at(-1)!;
    const read = await call(
      w.operator,
      'POST',
      api(w, `inbox/conversations/${conversationId}/read`),
      { read_through_at: last.type === 'message' ? last.received_at : '' },
    );
    expect(read.statusCode).toBe(200);
    expect(
      ConversationSummary.parse(
        (await call(w.operator, 'GET', api(w, `inbox/conversations/${conversationId}`))).json(),
      ).unread_count,
    ).toBe(0);
  }, 60_000);
});
