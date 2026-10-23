import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContactPage, ContactTagAdded, ErrorEnvelope, LiveFrame, TagList } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { REALTIME_CHANNEL } from '../platform/realtime.js';
import { startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../test/fixtures/tags.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { contactIntegrity, integrityViolations } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const ROLLBACK = new Error('rollback');

describe('contacts tenancy and secrecy (postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  const logLines: string[] = [];

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
  });
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });

  type Person = { accountId: string; cookies: { session: string } };
  async function person(
    ws: string,
    role: 'owner' | 'operator',
    state: 'active' | 'deactivated' = 'active',
    name = 'Oleh Operator',
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: name });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, role, state });
    return { accountId: account.id, cookies: { session: session.token } };
  }
  const call = (who: Person | null, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who?.cookies, ...(payload && { payload }) });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  /** Everything the contacts feature owns in the database: a refused call must leave it as it was. */
  const stateOf = async () => ({
    tags: await deps.db.selectFrom('tags').selectAll().orderBy('id').execute(),
    links: await deps.db
      .selectFrom('contact_tags')
      .selectAll()
      .orderBy('workspace_id')
      .orderBy('contact_id')
      .orderBy('tag_id')
      .execute(),
    history: await deps.db.selectFrom('contact_tag_history').selectAll().orderBy('id').execute(),
    contacts: await deps.db.selectFrom('contacts').selectAll().orderBy('id').execute(),
  });

  describe('cross-workspace suite (AC-12)', () => {
    async function world() {
      const { a, b } = await twoWorkspacesWithTags(deps.db);
      // A second tag in each so counts and filters have something to confuse.
      const extra = await insertTag(deps.db, {
        workspaceId: b.workspaceId,
        createdByAccountId: b.ownerAccountId,
        name: 'Only in B',
      });
      await insertContactTag(deps.db, {
        workspaceId: b.workspaceId,
        contactId: b.otherContactId,
        tagId: extra,
        addedByAccountId: b.operatorAccountId,
      });
      return {
        a,
        b,
        extra,
        ownerA: await person(a.workspaceId, 'owner'),
        operatorA: await person(a.workspaceId, 'operator'),
        ownerB: await person(b.workspaceId, 'owner'),
        base: (ws: string) => `/api/workspaces/${ws}`,
      };
    }

    it('answers every contacts and tags operation of another workspace with a bare 404 and changes nothing', async () => {
      const w = await world();
      const before = await stateOf();
      const urls: [string, string, object?][] = [
        ['GET', `/contacts`],
        ['GET', `/contacts?mode=any&tag=${w.b.tagId}`],
        ['GET', `/contacts/${w.b.taggedContactId}`],
        ['GET', `/contacts/${w.b.taggedContactId}/tag-history`],
        ['GET', `/tags`],
        ['POST', `/contacts/${w.b.taggedContactId}/tags`, { name: 'Intruder', source: 'inbox' }],
        ['POST', `/contacts/${w.b.taggedContactId}/tags`, { tag_id: w.b.tagId, source: 'inbox' }],
        ['POST', `/contacts/${w.b.taggedContactId}/tags/${w.b.tagId}/remove`, { source: 'inbox' }],
        ['POST', `/tags/${w.b.tagId}/rename`, { name: 'Hijacked' }],
        ['POST', `/tags/${w.b.tagId}/delete`, { expected_count: 1 }],
      ];
      for (const [method, tail, payload] of urls) {
        for (const who of [w.ownerA, w.operatorA]) {
          const res = await call(
            who,
            method as 'GET' | 'POST',
            `${w.base(w.b.workspaceId)}${tail}`,
            payload,
          );
          expect(res.statusCode, `${method} ${tail}`).toBe(404);
          expect(errorOf(res).code, tail).toBe('NOT_FOUND');
          // No hint: the body names neither workspace, contact nor tag.
          expect(res.body).not.toContain(w.b.workspaceId);
          expect(res.body).not.toContain(w.b.taggedContactId);
          expect(res.body).not.toContain(w.b.tagId);
        }
      }
      expect(await stateOf()).toEqual(before);
    });

    it('refuses a foreign contact, a foreign tag on an own contact and an own tag on a foreign contact', async () => {
      const w = await world();
      const own = w.base(w.a.workspaceId);
      const before = await stateOf();
      const expectRefused = async (
        res: Awaited<ReturnType<typeof call>>,
        code: string,
        what: string,
      ) => {
        expect(res.statusCode, what).toBe(404);
        expect(errorOf(res).code, what).toBe(code);
      };
      // Foreign contact id on A's routes.
      for (const who of [w.ownerA, w.operatorA]) {
        await expectRefused(
          await call(who, 'GET', `${own}/contacts/${w.b.taggedContactId}`),
          'NOT_FOUND',
          'profile',
        );
        await expectRefused(
          await call(who, 'GET', `${own}/contacts/${w.b.taggedContactId}/tag-history`),
          'NOT_FOUND',
          'history',
        );
        await expectRefused(
          await call(who, 'POST', `${own}/contacts/${w.b.taggedContactId}/tags`, {
            tag_id: w.a.tagId,
            source: 'profile',
          }),
          'NOT_FOUND',
          'own tag on foreign contact',
        );
        await expectRefused(
          await call(who, 'POST', `${own}/contacts/${w.b.taggedContactId}/tags`, {
            name: 'Fresh',
            source: 'profile',
          }),
          'NOT_FOUND',
          'new name on foreign contact',
        );
        await expectRefused(
          await call(
            who,
            'POST',
            `${own}/contacts/${w.b.taggedContactId}/tags/${w.b.tagId}/remove`,
            { source: 'profile' },
          ),
          'NOT_FOUND',
          'remove on foreign contact',
        );
        // Foreign tag id on an own contact.
        await expectRefused(
          await call(who, 'POST', `${own}/contacts/${w.a.otherContactId}/tags`, {
            tag_id: w.b.tagId,
            source: 'profile',
          }),
          'TAG_NOT_FOUND',
          'foreign tag on own contact',
        );
      }
      for (const tagId of [w.b.tagId, w.extra]) {
        await expectRefused(
          await call(w.ownerA, 'POST', `${own}/tags/${tagId}/rename`, { name: 'Hijacked' }),
          'TAG_NOT_FOUND',
          'rename',
        );
        await expectRefused(
          await call(w.ownerA, 'POST', `${own}/tags/${tagId}/delete`, { expected_count: 1 }),
          'TAG_NOT_FOUND',
          'delete',
        );
      }
      // Merging into a foreign tag is refused too.
      const merge = await call(w.ownerA, 'POST', `${own}/tags/${w.a.tagId}/rename`, {
        name: 'Only in B',
        merge_into_tag_id: w.extra,
      });
      expect(merge.statusCode).toBe(409);
      expect(errorOf(merge)).toMatchObject({
        code: 'TAG_MERGE_TARGET_CHANGED',
        details: { name_holder: null },
      });
      // Removing a foreign tag from an own contact changes nothing.
      const removeForeign = await call(
        w.operatorA,
        'POST',
        `${own}/contacts/${w.a.taggedContactId}/tags/${w.b.tagId}/remove`,
        { source: 'profile' },
      );
      expect(removeForeign.statusCode).toBe(200);
      expect(removeForeign.json().outcome).toBe('unchanged');
      expect(await stateOf()).toEqual(before);
      expect(await integrityViolations(deps.db, [w.a.workspaceId, w.b.workspaceId])).toEqual([]);
    });

    it('keeps counts, filters and lists inside the workspace, tags of the same name included', async () => {
      const w = await world();
      const own = w.base(w.a.workspaceId);
      const page = ContactPage.parse(
        (await call(w.operatorA, 'GET', `${own}/contacts?mode=any&tag=${w.a.tagId}`)).json(),
      );
      expect(page.items.map((i) => i.id)).toEqual([w.a.taggedContactId]);
      expect(page.total_count).toBe(2);
      // B's tag id in A's filter finds no contact and is reported missing, not resolved.
      const foreign = ContactPage.parse(
        (await call(w.operatorA, 'GET', `${own}/contacts?mode=any&tag=${w.b.tagId}`)).json(),
      );
      // The unknown id is dropped (the page says so); what is listed is only A's contacts.
      expect(foreign.items.map((i) => i.id).sort()).toEqual([...w.a.contactIds].sort());
      expect(foreign.missing_tag_ids).toEqual([w.b.tagId]);
      const foreignAll = ContactPage.parse(
        (
          await call(
            w.operatorA,
            'GET',
            `${own}/contacts?mode=all&tag=${w.a.tagId}&tag=${w.b.tagId}`,
          )
        ).json(),
      );
      expect(foreignAll.missing_tag_ids).toEqual([w.b.tagId]);
      // None never lists a contact of B, and the tag list counts only A's links.
      const none = ContactPage.parse(
        (await call(w.operatorA, 'GET', `${own}/contacts?mode=none`)).json(),
      );
      expect(none.items.map((i) => i.id)).toEqual([w.a.otherContactId]);
      const tags = TagList.parse((await call(w.operatorA, 'GET', `${own}/tags`)).json());
      expect(tags.items).toEqual([{ id: w.a.tagId, name: 'VIP', contact_count: 1 }]);
      // The same name in both workspaces: an add by name in A never touches B's VIP.
      const added = ContactTagAdded.parse(
        (
          await call(w.operatorA, 'POST', `${own}/contacts/${w.a.otherContactId}/tags`, {
            name: 'vip',
            source: 'inbox',
          })
        ).json(),
      );
      expect(added.tag.id).toBe(w.a.tagId);
      const bTags = TagList.parse(
        (await call(w.ownerB, 'GET', `${w.base(w.b.workspaceId)}/tags`)).json(),
      );
      expect(bTags.items.find((t) => t.id === w.b.tagId)!.contact_count).toBe(1);
      // A write by A's owner renaming A's VIP leaves B's tag alone.
      await call(w.ownerA, 'POST', `${own}/tags/${w.a.tagId}/rename`, { name: 'Gold' });
      const bAfter = await deps.db
        .selectFrom('tags')
        .select('name')
        .where('id', '=', w.b.tagId)
        .executeTakeFirstOrThrow();
      expect(bAfter.name).toBe('VIP');
    });

    it('refuses signed-out and deactivated callers on every route, and a person of no membership', async () => {
      const w = await world();
      const removed = await person(w.a.workspaceId, 'operator', 'deactivated');
      const own = w.base(w.a.workspaceId);
      const before = await stateOf();
      const routes: [string, string, object?][] = [
        ['GET', `/contacts`],
        ['GET', `/contacts/${w.a.taggedContactId}`],
        ['GET', `/contacts/${w.a.taggedContactId}/tag-history`],
        ['GET', `/tags`],
        ['POST', `/contacts/${w.a.taggedContactId}/tags`, { name: 'X', source: 'inbox' }],
        ['POST', `/contacts/${w.a.taggedContactId}/tags/${w.a.tagId}/remove`, { source: 'inbox' }],
        ['POST', `/tags/${w.a.tagId}/rename`, { name: 'Z' }],
        ['POST', `/tags/${w.a.tagId}/delete`, { expected_count: 1 }],
      ];
      for (const [method, tail, payload] of routes) {
        const m = method as 'GET' | 'POST';
        expect((await call(null, m, `${own}${tail}`, payload)).statusCode, tail).toBe(401);
        const gone = await call(removed, m, `${own}${tail}`, payload);
        expect(gone.statusCode, tail).toBe(403);
        expect(errorOf(gone).code).toBe('ACCESS_REMOVED');
        const out = await call(w.ownerB, m, `${own}${tail}`, payload);
        expect(out.statusCode, tail).toBe(404);
      }
      expect(await stateOf()).toEqual(before);
    });
  });

  describe('integrity queries find what they are meant to find (non-vacuity)', () => {
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
    const sqlOf = async (trx: Deps['db'], text: string) => {
      const { sql } = await import('kysely');
      await sql.raw(text).execute(trx);
    };

    it('reports a link with no history entry, accepts a merged-only one, and a clean workspace', async () => {
      const { a } = await twoWorkspacesWithTags(deps.db);
      expect(await integrityViolations(deps.db, [a.workspaceId])).toEqual([]);
      const rows = await planted(
        async (trx) => {
          const tag = await insertTag(trx, {
            workspaceId: a.workspaceId,
            createdByAccountId: a.ownerAccountId,
          });
          await insertContactTag(trx, {
            workspaceId: a.workspaceId,
            contactId: a.otherContactId,
            tagId: tag,
            addedByAccountId: a.operatorAccountId,
            history: false,
          });
        },
        (trx) => contactIntegrity.linksWithoutHistory(trx, a.workspaceId),
      );
      expect(rows).toHaveLength(1);
      // A link whose only entry is a merge into its tag is fine.
      const merged = await planted(
        async (trx) => {
          const from = await insertTag(trx, {
            workspaceId: a.workspaceId,
            createdByAccountId: a.ownerAccountId,
            name: 'From',
          });
          await insertContactTag(trx, {
            workspaceId: a.workspaceId,
            contactId: a.otherContactId,
            tagId: a.tagId,
            addedByAccountId: a.operatorAccountId,
            history: false,
          });
          await trx
            .insertInto('contact_tag_history')
            .values({
              id: crypto.randomUUID(),
              workspace_id: a.workspaceId,
              contact_id: a.otherContactId,
              tag_id: from,
              tag_name: 'From',
              kind: 'merged',
              merged_into_tag_id: a.tagId,
              merged_into_name: 'VIP',
              actor_account_id: a.ownerAccountId,
              source: 'settings',
              created_at: new Date(),
            })
            .execute();
        },
        (trx) => contactIntegrity.linksWithoutHistory(trx, a.workspaceId),
      );
      expect(merged).toEqual([]);
    });

    it('reports a workspace over 100 tags and a contact over 20', async () => {
      const { a, b } = await twoWorkspacesWithTags(deps.db);
      const over = await planted(
        async (trx) => {
          for (let i = 0; i < 100; i++) {
            await insertTag(trx, {
              workspaceId: a.workspaceId,
              createdByAccountId: a.ownerAccountId,
              name: `Bulk ${i}`,
            });
          }
        },
        async (trx) => ({
          a: await contactIntegrity.tagsOverLimit(trx, a.workspaceId),
          b: await contactIntegrity.tagsOverLimit(trx, b.workspaceId),
        }),
      );
      expect(over.a).toHaveLength(1);
      expect(over.b).toEqual([]);
      const heavy = await planted(
        async (trx) => {
          for (let i = 0; i < 20; i++) {
            const tag = await insertTag(trx, {
              workspaceId: a.workspaceId,
              createdByAccountId: a.ownerAccountId,
              name: `Carried ${i}`,
            });
            await insertContactTag(trx, {
              workspaceId: a.workspaceId,
              contactId: a.taggedContactId,
              tagId: tag,
              addedByAccountId: a.operatorAccountId,
            });
          }
        },
        (trx) => contactIntegrity.contactsOverTagLimit(trx, a.workspaceId),
      );
      expect(heavy).toEqual([{ id: a.taggedContactId }]);
    });

    it('reports two tags of one key and a link across workspaces once the constraints that forbid them are lifted', async () => {
      const { a, b } = await twoWorkspacesWithTags(deps.db);
      const twin = await planted(
        async (trx) => {
          await sqlOf(trx, 'ALTER TABLE tags DROP CONSTRAINT tags_workspace_id_name_key_key');
          await trx
            .insertInto('tags')
            .values({
              id: crypto.randomUUID(),
              workspace_id: a.workspaceId,
              name: 'vip',
              name_key: 'vip',
              created_by_account_id: a.ownerAccountId,
              created_at: new Date(),
            })
            .execute();
        },
        (trx) => contactIntegrity.duplicateTagKeys(trx, a.workspaceId),
      );
      expect(twin).toEqual([{ name_key: 'vip' }]);
      const crossed = await planted(
        async (trx) => {
          await sqlOf(trx, 'ALTER TABLE contact_tags DROP CONSTRAINT contact_tags_tag_fkey');
          await sqlOf(trx, 'ALTER TABLE contact_tags DROP CONSTRAINT contact_tags_contact_fkey');
          await trx
            .insertInto('contact_tags')
            .values({
              workspace_id: a.workspaceId,
              contact_id: b.otherContactId,
              tag_id: b.tagId,
              added_by_account_id: a.operatorAccountId,
              added_at: new Date(),
            })
            .execute();
        },
        async (trx) => ({
          a: await contactIntegrity.linksAcrossWorkspaces(trx, a.workspaceId),
          b: await contactIntegrity.linksAcrossWorkspaces(trx, b.workspaceId),
        }),
      );
      expect(crossed.a).toHaveLength(1);
      expect(crossed.b).toEqual([]);
      // The constraints are back after the rollback.
      await expect(
        deps.db
          .insertInto('contact_tags')
          .values({
            workspace_id: a.workspaceId,
            contact_id: b.otherContactId,
            tag_id: b.tagId,
            added_by_account_id: a.operatorAccountId,
            added_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow();
    });
  });

  describe('secrecy: no tag name, contact name or username leaves through a frame, a signal or a log line', () => {
    it('keeps every secret out of the log, the socket frames and the NOTIFY payloads', async () => {
      const ws = await insertWorkspace(deps.db, 'Secrecy Flowers');
      const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
      fake.bot(token).script({});
      const owner = await person(ws, 'owner', 'active', 'Olga Owner');
      const operator = await person(ws, 'operator', 'active', 'Oleh Operator');
      const secrets = {
        first: 'Zephyrine',
        last: 'Quillfeather',
        username: 'zq_quill_7731',
        tags: ['Zebra-Secret-Tag', 'Quasar-Hidden-Tag', 'Walrus-Merged-Tag', 'Nimbus-Doomed-Tag'],
      };
      const hook = { id: bot.id, secret: webhookSecret! };

      // Raw NOTIFY payloads and the member's socket frames.
      const notifications: string[] = [];
      const listener = new pg.Client({ connectionString: database.url });
      await listener.connect();
      listener.on('notification', (m) => notifications.push(String(m.payload)));
      await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
      const frames: string[] = [];
      const socket = await app.injectWS(`/api/workspaces/${ws}/inbox/live`, {
        headers: { origin: ORIGIN, cookie: `session=${operator.cookies.session}` },
      });
      socket.on('message', (data: Buffer) => {
        frames.push(String(data));
        LiveFrame.parse(JSON.parse(String(data)));
      });

      const from = {
        first_name: secrets.first,
        last_name: secrets.last,
        username: secrets.username,
      };
      const delivery = await signedDelivery(
        app,
        hook,
        telegramUpdate({
          updateId: 990001,
          messageId: 1,
          date: Math.floor(Date.now() / 1000),
          fromId: 940001,
          text: 'Hello there',
          from,
        }),
      );
      expect(delivery.statusCode).toBe(200);
      const contact = await deps.db
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', ws)
        .executeTakeFirstOrThrow();
      const url = (tail: string) => `/api/workspaces/${ws}/${tail}`;

      const [zebra, quasar, walrus, nimbus] = secrets.tags as [string, string, string, string];
      const added = async (name: string) =>
        ContactTagAdded.parse(
          (
            await call(operator, 'POST', url(`contacts/${contact.id}/tags`), {
              name,
              source: 'inbox',
            })
          ).json(),
        );
      const zebraTag = await added(zebra);
      const quasarTag = await added(quasar);
      const walrusTag = await added(walrus);
      const nimbusTag = await added(nimbus);
      // Refusals, unchanged outcomes, reads, a removal.
      expect(
        (
          await call(operator, 'POST', url(`contacts/${contact.id}/tags`), {
            name: '   ',
            source: 'inbox',
          })
        ).statusCode,
      ).toBe(400);
      await added(zebra);
      await call(operator, 'POST', url(`contacts/${contact.id}/tags/${quasarTag.tag.id}/remove`), {
        source: 'profile',
      });
      await added(quasar);
      await call(
        operator,
        'GET',
        url(`contacts?q=${secrets.first}&mode=any&tag=${zebraTag.tag.id}`),
      );
      await call(operator, 'GET', url(`contacts/${contact.id}`));
      await call(operator, 'GET', url(`contacts/${contact.id}/tag-history`));
      await call(operator, 'GET', url('tags'));
      // Owner: a clash (refused), a rename, a merge and a delete.
      await call(owner, 'POST', url(`tags/${walrusTag.tag.id}/rename`), {
        name: zebra.toLowerCase(),
      });
      await call(owner, 'POST', url(`tags/${walrusTag.tag.id}/rename`), {
        name: 'Walrus-Renamed-Tag',
      });
      await call(owner, 'POST', url(`tags/${walrusTag.tag.id}/rename`), {
        name: zebra,
        merge_into_tag_id: zebraTag.tag.id,
      });
      await call(owner, 'POST', url(`tags/${nimbusTag.tag.id}/delete`), { expected_count: 7 });
      await call(owner, 'POST', url(`tags/${nimbusTag.tag.id}/delete`), { expected_count: 1 });

      await new Promise((r) => setTimeout(r, 400));
      socket.terminate();
      await listener.end();

      expect(frames.length).toBeGreaterThan(0);
      expect(notifications.length).toBeGreaterThan(0);
      const everything = [
        ['log', logLines],
        ['frames', frames],
        ['notify', notifications],
      ] as const;
      const forbidden = [
        ...secrets.tags,
        'Walrus-Renamed-Tag',
        secrets.first,
        secrets.last,
        secrets.username,
        'Hello there',
      ];
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
      // The log did record the changes, by ids and outcome codes.
      expect(logLines.some((l) => l.includes('contact tag change'))).toBe(true);
      expect(await integrityViolations(deps.db, [ws])).toEqual([]);
    }, 60_000);
  });
});
