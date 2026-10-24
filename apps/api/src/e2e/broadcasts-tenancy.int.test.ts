import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Broadcast,
  BroadcastDraft,
  BroadcastLaunched,
  ErrorEnvelope,
  LaunchConfirmation,
  LiveFrame,
  ThreadPage,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { REALTIME_CHANNEL } from '../platform/realtime.js';
import { startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertBroadcast, launchBroadcastFixture } from '../test/fixtures/broadcasts.js';
import { insertBroadcastItem } from '../test/fixtures/conversations.js';
import { signedDelivery, telegramMyChatMember, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { broadcastIntegrity, integrityViolations, truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const ROLLBACK = new Error('rollback');

/**
 * Broadcasts tenancy and secrecy (test-plan §Cross-workspace isolation, sad.md §8, T27): every
 * operation naming another workspace's broadcast, contact, conversation or item answers a bare 404
 * and writes nothing; a link sends only its own workspace's recipients through its own bot; no
 * text, name, username, chat id or token leaves through a log line, a frame, a NOTIFY payload or a
 * job payload; and the `broadcastIntegrity` queries find what they are meant to find.
 */
describe('broadcasts tenancy and secrecy (postgres + pg-boss chain + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  const logLines: string[] = [];
  let nextUpdate = 1;
  let nextMessage = 1;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = {
      ...testConfig(database.url),
      LOG_LEVEL: 'trace' as const,
      TELEGRAM_API_ROOT: fake.apiRoot,
    };
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logLines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    deps = buildDeps(config);
    app = await buildApp(config, { logStream });
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(deps.db);
    fake.reset();
  });

  type Person = { accountId: string; cookies: { session: string } };
  const nowS = () => Math.floor(Date.now() / 1000);
  async function person(
    ws: string,
    role: 'owner' | 'operator',
    name = 'Oleh Operator',
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: name });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, role });
    return { accountId: account.id, cookies: { session: session.token } };
  }

  /** A workspace with its bot, an owner and an operator. */
  async function workspace(name: string) {
    const ws = await insertWorkspace(deps.db, name);
    const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
    fake.bot(token).script({});
    return {
      ws,
      token,
      telegramBotId: bot.telegramBotId,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, 'owner', 'Olga Owner'),
      operator: await person(ws, 'operator'),
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const call = (who: Person | null, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who?.cookies, ...(payload && { payload }) });
  const api = (ws: string, tail: string) => `/api/workspaces/${ws}/${tail}`;
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const ok = async <T>(
    schema: { parse: (v: unknown) => T },
    who: Person,
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ): Promise<T> => {
    const res = await call(who, method, url, payload);
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return schema.parse(res.json());
  };

  async function customerWrites(
    w: W,
    fromId: number,
    from: { first_name: string; last_name?: string; username?: string },
    text = 'Do you have tulips?',
  ) {
    const res = await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: nowS(),
        fromId,
        text,
        from,
      }),
    );
    expect(res.statusCode).toBe(200);
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
    return { fromId, contactId: contact.id, conversationId: conversation.id };
  }

  const tagAudienceDraft = async (w: W, name: string, text: string) => {
    const d = await ok(BroadcastDraft, w.operator, 'POST', api(w.ws, 'broadcasts'), {
      name,
      text,
    });
    return ok(BroadcastDraft, w.operator, 'POST', api(w.ws, `broadcasts/${d.id}/audience`), {
      expected_version: d.version,
      kind: 'tags',
      mode: 'none',
      tag_ids: [],
      exclude_tag_ids: [],
    });
  };
  async function confirmAndLaunch(w: W, id: string) {
    const c = await ok(
      LaunchConfirmation,
      w.owner,
      'GET',
      api(w.ws, `broadcasts/${id}/launch-confirmation`),
    );
    const launched = await ok(
      BroadcastLaunched,
      w.owner,
      'POST',
      api(w.ws, `broadcasts/${id}/launch`),
      { expected_version: c.version, fingerprint: c.fingerprint },
    );
    expect(launched.outcome).toBe('launched');
  }
  async function settled(w: W, id: string) {
    await vi.waitFor(
      async () => {
        const b = await ok(Broadcast, w.owner, 'GET', api(w.ws, `broadcasts/${id}`));
        expect(b.status).not.toBe('sending');
        expect(b.status !== 'draft' && b.totals).toMatchObject({ waiting: 0, sending: 0 });
      },
      { timeout: 20_000, interval: 100 },
    );
  }
  const sentChats = (w: W) =>
    fake
      .calls(w.token)
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.params.chat_id));

  /** Everything the broadcasts feature owns: a refused call must leave it as it was. */
  const stateOf = async () => ({
    broadcasts: await deps.db.selectFrom('broadcasts').selectAll().orderBy('id').execute(),
    audienceTags: await deps.db
      .selectFrom('broadcast_audience_tags')
      .selectAll()
      .orderBy('broadcast_id')
      .orderBy('tag_id')
      .execute(),
    group: await deps.db
      .selectFrom('broadcast_group_contacts')
      .selectAll()
      .orderBy('broadcast_id')
      .orderBy('contact_id')
      .execute(),
    recipients: await deps.db
      .selectFrom('broadcast_recipients')
      .selectAll()
      .orderBy('id')
      .execute(),
    items: await deps.db.selectFrom('broadcast_items').selectAll().orderBy('id').execute(),
    reach: await deps.db
      .selectFrom('contact_bot_reach')
      .selectAll()
      .orderBy('contact_id')
      .execute(),
    contacts: await deps.db.selectFrom('contacts').selectAll().orderBy('id').execute(),
    conversations: await deps.db.selectFrom('conversations').selectAll().orderBy('id').execute(),
  });

  describe('cross-workspace suite (AC-08)', () => {
    /**
     * "Acme Flowers" (A) and "Bolt Bikes" (B). The same Telegram user wrote to both bots; B has a
     * draft with a group, a sent broadcast and its broadcast item.
     */
    async function world() {
      const a = await workspace('Acme Flowers');
      const b = await workspace('Bolt Bikes');
      const shared = 870001;
      const aOlena = await customerWrites(a, shared, { first_name: 'Olena' });
      const aMaria = await customerWrites(a, 870002, { first_name: 'Maria' });
      const bOlena = await customerWrites(b, shared, { first_name: 'Olena' });
      const bTaras = await customerWrites(b, 870003, { first_name: 'Taras' });
      const bDraft = await tagAudienceDraft(b, 'B draft', 'B text');
      const bGroup = await ok(BroadcastDraft, b.operator, 'POST', api(b.ws, 'broadcasts'), {
        name: 'B group',
        text: 'B group text',
      });
      await ok(BroadcastDraft, b.operator, 'POST', api(b.ws, `broadcasts/${bGroup.id}/audience`), {
        expected_version: bGroup.version,
        kind: 'group',
      });
      const added = await call(
        b.operator,
        'POST',
        api(b.ws, `broadcasts/${bGroup.id}/group/contacts`),
        {
          contact_id: bTaras.contactId,
        },
      );
      expect(added.statusCode).toBe(200);
      const bSent = await tagAudienceDraft(b, 'B sent', 'B sent text');
      await confirmAndLaunch(b, bSent.id);
      await settled(b, bSent.id);
      const bItem = await deps.db
        .selectFrom('broadcast_items')
        .select('id')
        .where('workspace_id', '=', b.ws)
        .where('conversation_id', '=', bOlena.conversationId)
        .executeTakeFirstOrThrow();
      const aGroup = await ok(BroadcastDraft, a.operator, 'POST', api(a.ws, 'broadcasts'), {
        name: 'A group',
        text: 'A text',
      });
      const aGroupDraft = await ok(
        BroadcastDraft,
        a.operator,
        'POST',
        api(a.ws, `broadcasts/${aGroup.id}/audience`),
        { expected_version: aGroup.version, kind: 'group' },
      );
      return { a, b, aOlena, aMaria, bOlena, bTaras, bDraft, bGroup, bSent, bItem, aGroupDraft };
    }

    it('answers every broadcasts operation naming another workspace’s broadcast, contact, conversation or item with a bare 404 and writes nothing', async () => {
      const w = await world();
      const before = await stateOf();
      const sendsBefore = fake.calls().length;
      const { a, b } = w;
      const foreign = (id: string) => `broadcasts/${id}`;
      const routes: [method: 'GET' | 'POST', tail: string, payload?: object][] = [];
      for (const id of [w.bDraft.id, w.bGroup.id, w.bSent.id]) {
        routes.push(
          ['GET', foreign(id)],
          ['POST', `${foreign(id)}/save`, { expected_version: 1, name: 'Hijacked' }],
          [
            'POST',
            `${foreign(id)}/audience`,
            { expected_version: 1, kind: 'tags', mode: 'none', tag_ids: [], exclude_tag_ids: [] },
          ],
          ['POST', `${foreign(id)}/audience`, { expected_version: 1, kind: 'group' }],
          ['GET', `${foreign(id)}/group`],
          ['GET', `${foreign(id)}/group/membership?contact=${w.aOlena.contactId}`],
          ['POST', `${foreign(id)}/group/contacts`, { contact_id: w.aOlena.contactId }],
          ['POST', `${foreign(id)}/group/contacts/${w.bTaras.contactId}/remove`],
          ['GET', `${foreign(id)}/group/matching?mode=none`],
          [
            'POST',
            `${foreign(id)}/group/add-matching`,
            { mode: 'none', tag_ids: [], expected_count: 1 },
          ],
          ['POST', `${foreign(id)}/delete`],
          ['POST', `${foreign(id)}/duplicate`, { audience: 'same', include_not_confirmed: false }],
          ['GET', `${foreign(id)}/launch-confirmation`],
          ['POST', `${foreign(id)}/launch`, { expected_version: 1, fingerprint: 'a'.repeat(64) }],
          ['POST', `${foreign(id)}/stop`],
          ['GET', `${foreign(id)}/recipients`],
        );
      }
      // A's own group never takes B's contact; A's inbox never names B's conversation or item.
      routes.push(
        [
          'POST',
          `broadcasts/${w.aGroupDraft.id}/group/contacts`,
          { contact_id: w.bTaras.contactId },
        ],
        [
          'POST',
          `broadcasts/${w.aGroupDraft.id}/group/contacts`,
          { contact_id: w.bOlena.contactId },
        ],
        ['GET', `inbox/conversations/${w.bOlena.conversationId}/items`],
        ['GET', `inbox/conversations/${w.bOlena.conversationId}/broadcast-items/${w.bItem.id}`],
        ['GET', `inbox/conversations/${w.aOlena.conversationId}/broadcast-items/${w.bItem.id}`],
      );
      const hidden = [
        b.ws,
        w.bDraft.id,
        w.bGroup.id,
        w.bSent.id,
        w.bTaras.contactId,
        w.bOlena.contactId,
        w.bOlena.conversationId,
        w.bItem.id,
      ];
      // No hint: the answer is the one for an id that exists nowhere. That is a bare 404, except
      // that an operator meets OWNER_ONLY on the owner-only trio before any lookup.
      const ownerOnly = /\/(launch-confirmation|launch|stop)$/;
      const nowhere = (tail: string) => {
        let out = tail;
        for (const id of hidden) out = out.replaceAll(id, newId());
        return out;
      };
      for (const [method, tail, payload] of routes) {
        for (const who of [a.owner, a.operator]) {
          const res = await call(who, method, api(a.ws, tail), payload);
          const expected = who === a.operator && ownerOnly.test(tail) ? 403 : 404;
          expect(res.statusCode, `${method} ${tail}`).toBe(expected);
          expect(errorOf(res).code, tail).toBe(expected === 404 ? 'NOT_FOUND' : 'OWNER_ONLY');
          const reference = await call(
            who,
            method,
            api(a.ws, nowhere(tail)),
            payload && (JSON.parse(nowhere(JSON.stringify(payload))) as object),
          );
          expect(reference.statusCode, `${method} ${tail} (nowhere)`).toBe(expected);
          expect(errorOf(res), tail).toEqual(errorOf(reference));
          for (const id of hidden) expect(res.body, `${tail} names ${id}`).not.toContain(id);
        }
      }
      // B's own people can still read B: the ids were real.
      expect((await call(b.owner, 'GET', api(b.ws, foreign(w.bSent.id)))).statusCode).toBe(200);
      // An account of B on A's routes: no hint that A exists.
      const aDraft = await tagAudienceDraft(a, 'A draft', 'A text');
      for (const [method, tail, payload] of [
        ['GET', 'broadcasts'],
        ['GET', foreign(aDraft.id)],
        ['POST', 'broadcasts', { name: 'Intruder' }],
        ['GET', `${foreign(aDraft.id)}/launch-confirmation`],
        [
          'POST',
          `${foreign(aDraft.id)}/duplicate`,
          { audience: 'same', include_not_confirmed: false },
        ],
        ['POST', `${foreign(aDraft.id)}/delete`],
      ] as [method: 'GET' | 'POST', tail: string, payload?: object][]) {
        const res = await call(b.owner, method, api(a.ws, tail), payload);
        expect(res.statusCode, `${method} ${tail}`).toBe(404);
        expect(res.body).not.toContain(a.ws);
        expect(res.body).not.toContain(aDraft.id);
      }
      const after = await stateOf();
      // Only A's own draft was added.
      expect({ ...after, broadcasts: after.broadcasts.filter((r) => r.id !== aDraft.id) }).toEqual(
        before,
      );
      expect(fake.calls().length).toBe(sendsBefore);
      expect(await integrityViolations(deps.db, [a.ws, b.ws])).toEqual([]);
    }, 60_000);

    it('sends each workspace’s broadcast only to its own recipients through its own bot, also for a customer of both (AC-08)', async () => {
      const w = await world();
      const { a, b } = w;
      fake.reset();
      fake.bot(a.token).script({});
      fake.bot(b.token).script({});
      const aCast = await tagAudienceDraft(a, 'A spring', 'A spring text');
      const bCast = await tagAudienceDraft(b, 'B spring', 'B spring text');
      await Promise.all([confirmAndLaunch(a, aCast.id), confirmAndLaunch(b, bCast.id)]);
      await Promise.all([settled(a, aCast.id), settled(b, bCast.id)]);

      expect(sentChats(a).sort()).toEqual(
        [String(w.aOlena.fromId), String(w.aMaria.fromId)].sort(),
      );
      expect(sentChats(b).sort()).toEqual(
        [String(w.bOlena.fromId), String(w.bTaras.fromId)].sort(),
      );
      for (const c of fake.calls(a.token)) expect(c.params.text).toBe('A spring text');
      for (const c of fake.calls(b.token)) expect(c.params.text).toBe('B spring text');
      // Each recipient row names its own workspace's contact; each item sits in its own workspace.
      const rows = await deps.db
        .selectFrom('broadcast_recipients as r')
        .innerJoin('contacts as c', 'c.id', 'r.contact_id')
        .select(['r.workspace_id as rw', 'c.workspace_id as cw', 'r.broadcast_id'])
        .execute();
      for (const r of rows) expect(r.rw).toBe(r.cw);
      const aItems = await ok(
        ThreadPage,
        a.operator,
        'GET',
        api(a.ws, `inbox/conversations/${w.aOlena.conversationId}/items`),
      );
      expect(
        aItems.items
          .filter((i) => i.type === 'broadcast')
          .map((i) => i.type === 'broadcast' && i.broadcast_id),
      ).toEqual([aCast.id]);
      expect(await integrityViolations(deps.db, [a.ws, b.ws])).toEqual([]);
    }, 60_000);

    it('refuses a signed-out caller and a member deactivated while on the confirmation; nothing is launched (AC-08)', async () => {
      const a = await workspace('Acme Flowers');
      await customerWrites(a, 870101, { first_name: 'Olena' });
      const co = await person(a.ws, 'owner', 'Petro Partner');
      const d = await tagAudienceDraft(a, 'Spring prices', 'New prices.');
      const c = await ok(
        LaunchConfirmation,
        co,
        'GET',
        api(a.ws, `broadcasts/${d.id}/launch-confirmation`),
      );
      const body = { expected_version: c.version, fingerprint: c.fingerprint };

      const signedOut = await call(null, 'POST', api(a.ws, `broadcasts/${d.id}/launch`), body);
      expect(signedOut.statusCode).toBe(401);
      expect(errorOf(signedOut).code).toBe('UNAUTHENTICATED');

      await deps.db
        .updateTable('memberships')
        .set({ state: 'deactivated', deactivated_at: new Date() })
        .where('workspace_id', '=', a.ws)
        .where('account_id', '=', co.accountId)
        .execute();
      const removed = await call(co, 'POST', api(a.ws, `broadcasts/${d.id}/launch`), body);
      expect(removed.statusCode).toBe(403);
      expect(errorOf(removed).code).toBe('ACCESS_REMOVED');
      const after = await ok(Broadcast, a.owner, 'GET', api(a.ws, `broadcasts/${d.id}`));
      expect(after.status).toBe('draft');
      expect(
        await deps.db
          .selectFrom('broadcast_recipients')
          .select('id')
          .where('workspace_id', '=', a.ws)
          .execute(),
      ).toEqual([]);
      expect(sentChats(a)).toEqual([]);
      expect(await integrityViolations(deps.db, [a.ws])).toEqual([]);
    }, 60_000);
  });

  describe('broadcastIntegrity finds what it is meant to find (non-vacuity)', () => {
    /** Runs `plant` in a transaction that is always rolled back, returning what `check` saw. */
    async function planted<T>(
      plant: (trx: Deps['db']) => Promise<void>,
      check: (trx: Deps['db']) => Promise<T>,
    ): Promise<T> {
      let seen!: T;
      await deps.db
        .transaction()
        .execute(async (trx) => {
          await plant(trx as unknown as Deps['db']);
          seen = await check(trx as unknown as Deps['db']);
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
      return seen;
    }
    const raw = (trx: Deps['db'], text: string) => sql.raw(text).execute(trx);

    /** A and B, each with a bot, an owner and two contacts with conversations; A has a sending broadcast. */
    async function seeded() {
      const a = await workspace('Acme Flowers');
      const b = await workspace('Bolt Bikes');
      const a1 = await customerWrites(a, 880001, { first_name: 'Olena' });
      const a2 = await customerWrites(a, 880002, { first_name: 'Maria' });
      const b1 = await customerWrites(b, 880003, { first_name: 'Taras' });
      const cast = await insertBroadcast(deps.db, {
        workspaceId: a.ws,
        authorAccountId: a.owner.accountId,
        text: 'Hello',
      });
      const rows = await launchBroadcastFixture(deps.db, {
        broadcast: cast,
        launchedByAccountId: a.owner.accountId,
        telegramBotId: a.telegramBotId,
        launchedAt: new Date(),
        recipients: [{ contactId: a1.contactId }, { contactId: a2.contactId }],
      });
      return { a, b, a1, a2, b1, cast, rows };
    }

    it('a clean seed has no row in any query', async () => {
      const { a, b } = await seeded();
      expect(await integrityViolations(deps.db, [a.ws, b.ws])).toEqual([]);
    });

    it('reports a recipient left sending with no link, and not one whose link is queued', async () => {
      const { a, rows, cast } = await seeded();
      const sending = async (trx: Deps['db']) =>
        trx
          .updateTable('broadcast_recipients')
          .set({ state: 'sending', claimed_at: new Date() })
          .where('workspace_id', '=', a.ws)
          .where('broadcast_id', '=', cast)
          .where('id', '=', rows[0]!.id)
          .execute()
          .then(() => undefined);
      expect(
        await planted(sending, (trx) => broadcastIntegrity.sendingWithoutLink(trx, a.ws)),
      ).toEqual([{ id: rows[0]!.id }]);
      expect(
        await planted(
          async (trx) => {
            await sending(trx);
            await raw(
              trx,
              `INSERT INTO pgboss.job (id, name, data, singleton_key, state)
               VALUES ('${crypto.randomUUID()}', 'broadcasts.send', '{"workspace_id":"${a.ws}"}', '${a.ws}', 'created')`,
            );
          },
          (trx) => broadcastIntegrity.sendingWithoutLink(trx, a.ws),
        ),
      ).toEqual([]);
    });

    it('reports two items for one recipient, an item without its outcome and an outcome without its item', async () => {
      const { a, a1, rows, cast } = await seeded();
      const delivered = (trx: Deps['db']) =>
        trx
          .updateTable('broadcast_recipients')
          .set({
            state: 'delivered',
            claimed_at: new Date(),
            outcome_at: new Date(),
            telegram_message_id: 1n as never,
          })
          .where('id', '=', rows[0]!.id)
          .execute();
      // Delivered, no item.
      expect(
        await planted(
          async (trx) => void (await delivered(trx)),
          (trx) => broadcastIntegrity.outcomesWithoutItem(trx, a.ws),
        ),
      ).toEqual([{ id: rows[0]!.id }]);
      // An item for a recipient still waiting.
      const item = await planted(
        async (trx) => {
          await insertBroadcastItem(trx, {
            workspaceId: a.ws,
            broadcastId: cast,
            conversationId: a1.conversationId,
            state: 'delivered',
          });
        },
        (trx) => broadcastIntegrity.itemsWithoutOutcome(trx, a.ws),
      );
      expect(item).toHaveLength(1);
      // Two items for one recipient, once the unique key that forbids it is lifted.
      const twice = await planted(
        async (trx) => {
          await delivered(trx);
          await raw(
            trx,
            'ALTER TABLE broadcast_items DROP CONSTRAINT broadcast_items_broadcast_conversation_key',
          );
          for (let i = 0; i < 2; i += 1) {
            await insertBroadcastItem(trx, {
              workspaceId: a.ws,
              broadcastId: cast,
              conversationId: a1.conversationId,
              state: 'delivered',
            });
          }
        },
        (trx) => broadcastIntegrity.recipientsWithTwoItems(trx, a.ws),
      );
      expect(twice).toEqual([{ id: rows[0]!.id }]);
    });

    it('reports a recipient created after the launch and a recipient count that differs', async () => {
      const { a, cast } = await seeded();
      expect(
        await planted(
          async (trx) =>
            void (await trx
              .updateTable('broadcasts')
              .set({ launched_at: new Date(Date.now() - 60_000) })
              .where('id', '=', cast)
              .execute()),
          (trx) => broadcastIntegrity.recipientsAfterLaunch(trx, a.ws),
        ),
      ).toEqual([{ id: cast }]);
      expect(
        await planted(
          async (trx) =>
            void (await trx
              .deleteFrom('broadcast_recipients')
              .where('broadcast_id', '=', cast)
              .where('position', '=', 2)
              .execute()),
          (trx) => broadcastIntegrity.recipientCountMismatch(trx, a.ws),
        ),
      ).toEqual([{ id: cast }]);
    });

    it('reports the 11th launch in 24 hours', async () => {
      const { a, a1 } = await seeded();
      const over = await planted(
        async (trx) => {
          for (let i = 0; i < 10; i += 1) {
            const id = await insertBroadcast(trx, {
              workspaceId: a.ws,
              authorAccountId: a.owner.accountId,
            });
            await launchBroadcastFixture(trx, {
              broadcast: id,
              launchedByAccountId: a.owner.accountId,
              telegramBotId: a.telegramBotId,
              launchedAt: new Date(Date.now() - (i + 1) * 60_000),
              recipients: [{ contactId: a1.contactId }],
            });
          }
        },
        (trx) => broadcastIntegrity.launchesOverCap(trx, a.ws),
      );
      expect(over).toHaveLength(1);
    });

    it('reports a recipient and a group row naming another workspace’s contact once the composite keys are lifted', async () => {
      const { a, b, b1, cast } = await seeded();
      const crossed = await planted(
        async (trx) => {
          await raw(
            trx,
            'ALTER TABLE broadcast_recipients DROP CONSTRAINT broadcast_recipients_contact_fkey',
          );
          await raw(
            trx,
            'ALTER TABLE broadcast_group_contacts DROP CONSTRAINT broadcast_group_contacts_contact_fkey',
          );
          await trx
            .insertInto('broadcast_recipients')
            .values({
              id: newId(),
              workspace_id: a.ws,
              broadcast_id: cast,
              contact_id: b1.contactId,
              position: 3,
              state: 'waiting',
              telegram_user_id: BigInt(b1.fromId) as never,
            })
            .execute();
          const draft = await insertBroadcast(trx, {
            workspaceId: a.ws,
            authorAccountId: a.owner.accountId,
            audience: { kind: 'group' },
          });
          await trx
            .insertInto('broadcast_group_contacts')
            .values({
              workspace_id: a.ws,
              broadcast_id: draft,
              contact_id: b1.contactId,
              added_by_account_id: a.owner.accountId,
              added_at: new Date(),
            })
            .execute();
        },
        async (trx) => ({
          a: await broadcastIntegrity.contactsAcrossWorkspaces(trx, a.ws),
          b: await broadcastIntegrity.contactsAcrossWorkspaces(trx, b.ws),
        }),
      );
      expect(crossed.a).toHaveLength(2);
      expect(crossed.b).toEqual([]);
    });
  });

  describe('secrecy: no text, name, username, chat id or token leaves through a log line, a frame, a NOTIFY payload or a job payload', () => {
    it('keeps every secret out while a broadcast is drafted, launched, sent, blocked and stopped', async () => {
      const w = await workspace('Secrecy Flowers');
      const secrets = {
        text: 'Zephyrine tulip sale, code QX-4471',
        name: 'Quillfeather campaign',
        first: 'Zephyrine',
        last: 'Quillfeather',
        username: 'zq_quill_7731',
        chats: [7700123401, 7700123402, 7700123403],
      };
      const notifications: string[] = [];
      const listener = new pg.Client({ connectionString: database.url });
      await listener.connect();
      listener.on('notification', (m) => notifications.push(String(m.payload)));
      await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
      const frames: string[] = [];
      const socket = await app.injectWS(api(w.ws, 'inbox/live'), {
        headers: { origin: ORIGIN, cookie: `session=${w.operator.cookies.session}` },
      });
      socket.on('message', (data: Buffer) => {
        frames.push(String(data));
        LiveFrame.parse(JSON.parse(String(data)));
      });
      logLines.length = 0;

      const people = [];
      for (const [i, chat] of secrets.chats.entries()) {
        people.push(
          await customerWrites(w, chat, {
            first_name: `${secrets.first}${i}`,
            last_name: secrets.last,
            username: `${secrets.username}${i}`,
          }),
        );
      }
      // One blocks the bot; the draft is built by tags, then as a group with the picker's search.
      const blocked = await signedDelivery(
        app,
        w.hook,
        telegramMyChatMember({
          updateId: nextUpdate++,
          fromId: secrets.chats[2]!,
          date: nowS(),
          status: 'kicked',
        }),
      );
      expect(blocked.statusCode).toBe(200);
      const d = await tagAudienceDraft(w, secrets.name, secrets.text);
      await call(
        w.operator,
        'GET',
        api(w.ws, `broadcasts/${d.id}/group/matching?q=${secrets.first}&mode=any`),
      );
      await confirmAndLaunch(w, d.id);
      await settled(w, d.id);
      // A second one, stopped at once by the owner.
      fake.bot(w.token).script({ sendMessage: [{ kind: 'hang', ms: 1000 }] });
      const s = await tagAudienceDraft(w, `${secrets.name} 2`, `${secrets.text} 2`);
      await confirmAndLaunch(w, s.id);
      await call(w.owner, 'POST', api(w.ws, `broadcasts/${s.id}/stop`));
      await settled(w, s.id);
      await call(w.operator, 'POST', api(w.ws, `broadcasts/${s.id}/duplicate`), {
        audience: 'not_reached',
        include_not_confirmed: false,
      });
      await call(w.operator, 'GET', api(w.ws, `broadcasts/${d.id}/recipients`));
      await call(
        w.operator,
        'GET',
        api(w.ws, `inbox/conversations/${people[0]!.conversationId}/items`),
      );

      // A link logs its line after its last report flush, a moment after the outcomes commit.
      await vi.waitFor(
        () => expect(logLines.some((l) => l.includes('broadcast.link'))).toBe(true),
        { timeout: 10_000, interval: 50 },
      );
      await new Promise((r) => setTimeout(r, 400));
      socket.terminate();
      await listener.end();
      const jobs = await sql<{ name: string; data: unknown }>`
        select name, data from pgboss.job where name like 'broadcasts.%'`.execute(deps.db);

      expect(frames.length).toBeGreaterThan(0);
      expect(notifications.length).toBeGreaterThan(0);
      expect(jobs.rows.length).toBeGreaterThan(0);
      for (const job of jobs.rows) {
        const keys = Object.keys(job.data as object).sort();
        expect(
          keys.every((k) => k === 'workspace_id' || k === 'broadcast_id'),
          `${job.name} carries ${keys.join(', ')}`,
        ).toBe(true);
      }
      const forbidden = [
        secrets.text,
        'QX-4471',
        secrets.name,
        secrets.first,
        secrets.last,
        secrets.username,
        w.token,
        ...secrets.chats.map(String),
      ];
      const everything = [
        ['log', logLines],
        ['frames', frames],
        ['notify', notifications],
        ['jobs', jobs.rows.map((j) => JSON.stringify(j.data))],
      ] as const;
      for (const [where, lines] of everything) {
        for (const line of lines) {
          for (const word of forbidden) {
            expect(
              line.toLowerCase().includes(word.toLowerCase()),
              `${where} carries ${word}`,
            ).toBe(false);
          }
        }
      }
      // The log did record the broadcast's life, by ids, counts and reasons.
      expect(logLines.some((l) => l.includes('broadcast.launched'))).toBe(true);
      expect(logLines.some((l) => l.includes('broadcast.link'))).toBe(true);
      expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
    }, 60_000);
  });
});
