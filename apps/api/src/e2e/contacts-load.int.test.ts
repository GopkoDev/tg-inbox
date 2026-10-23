import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ContactPage,
  ContactProfile,
  ContactTagAdded,
  LiveFrame,
  TagDeleted,
  TagHistoryPage,
  TagList,
  TagRenameResult,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const CONTACTS = 10_000;
const UNTAGGED = 500; // contacts that carry no tag, for the `none` filter
const REGULAR_TAGS = 98; // plus two tags carried by every contact: the 100-tag pilot ceiling
const LIST_BUDGET_MS = 500;
const RUNS = 5;

/**
 * Pilot scale (spec §6): one workspace with 10 000 contacts and 100 tags (~40 000 links, each with
 * its history entry), the NFR timings measured as server time through `app.inject()`.
 */
// A generous test timeout: the budgets under test are asserted, a slow machine must not time out first.
describe(
  'contacts at pilot scale: 10 000 contacts, 100 tags (postgres)',
  { timeout: 300_000 },
  () => {
    let database: TestDatabase;
    let deps: Deps;
    let app: FastifyInstance;
    let ws: string;
    let owner: { accountId: string; cookies: { session: string } };
    let operator: { accountId: string; cookies: { session: string } };
    let regular: { id: string; name: string }[] = [];
    let bigA: string;
    let bigB: string;
    let contactIds: string[] = [];

    beforeAll(async () => {
      database = await startTestDatabase();
      const config = testConfig(database.url);
      deps = buildDeps(config);
      app = await buildApp(config);
      await app.ready();
      const db = deps.db;
      ws = await insertWorkspace(db, 'Pilot Flowers');
      const person = async (role: 'owner' | 'operator', name: string) => {
        const account = await insertAccount(db, { displayName: name });
        const session = await insertSession(db, account.id, {
          createdAt: new Date(Date.now() - 3_600_000),
        });
        await insertMembership(db, ws, { accountId: account.id, role });
        return { accountId: account.id, cookies: { session: session.token } };
      };
      owner = await person('owner', 'Olga Owner');
      operator = await person('operator', 'Oleh Operator');
      const actor = owner.accountId;
      const now = new Date();

      // Set-based seed. Test-owned SQL: ids come from gen_random_uuid() here, never in the app.
      await sql`
      insert into contacts (id, workspace_id, telegram_user_id, first_name, last_name, username,
                            language_code, profile_seen_at, created_at, first_wrote_at, last_wrote_at)
      select gen_random_uuid(), ${ws}, 5000000 + n, 'Customer ' || n, 'Seed', 'cust_' || n, 'en',
             ${now}, ${now}, ${now}::timestamptz - (n || ' minutes')::interval,
             ${now}::timestamptz - (n || ' seconds')::interval
        from generate_series(1, ${CONTACTS + UNTAGGED}::int) as n`.execute(db);
      await sql`
      insert into tags (id, workspace_id, name, name_key, created_by_account_id, created_at)
      select gen_random_uuid(), ${ws}, 'Tag ' || lpad(n::text, 3, '0'),
             'tag ' || lpad(n::text, 3, '0'), ${actor}, ${now}
        from generate_series(1, ${REGULAR_TAGS}::int) as n`.execute(db);
      await sql`
      insert into tags (id, workspace_id, name, name_key, created_by_account_id, created_at)
      values (gen_random_uuid(), ${ws}, 'Big A', 'big a', ${actor}, ${now}),
             (gen_random_uuid(), ${ws}, 'Big B', 'big b', ${actor}, ${now})`.execute(db);
      const tags = await db
        .selectFrom('tags')
        .select(['id', 'name'])
        .where('workspace_id', '=', ws)
        .orderBy('name')
        .execute();
      regular = tags.filter((t) => t.name.startsWith('Tag '));
      bigA = tags.find((t) => t.name === 'Big A')!.id;
      bigB = tags.find((t) => t.name === 'Big B')!.id;
      contactIds = (
        await db
          .selectFrom('contacts')
          .select('id')
          .where('workspace_id', '=', ws)
          .orderBy('last_wrote_at', 'desc')
          .execute()
      ).map((c) => c.id);

      // Three regular tags per contact (distinct by construction) plus both big tags.
      await sql`
      insert into contact_tags (workspace_id, contact_id, tag_id, added_by_account_id, added_at)
      select ${ws}, c.id, t.id, ${actor}, ${now}
        from (select id, row_number() over (order by id) as rn from contacts
               where workspace_id = ${ws} and telegram_user_id <= ${5_000_000 + CONTACTS}) c
        join (select id, row_number() over (order by name) - 1 as k from tags
               where workspace_id = ${ws} and name like 'Tag %') t
          on t.k in (c.rn % ${REGULAR_TAGS}, (c.rn + 33) % ${REGULAR_TAGS}, (c.rn + 66) % ${REGULAR_TAGS})`.execute(
        db,
      );
      await sql`
      insert into contact_tags (workspace_id, contact_id, tag_id, added_by_account_id, added_at)
      select ${ws}, c.id, t.id, ${actor}, ${now}
        from contacts c cross join tags t
       where c.workspace_id = ${ws} and c.telegram_user_id <= ${5_000_000 + CONTACTS} and t.workspace_id = ${ws} and t.name in ('Big A', 'Big B')`.execute(
        db,
      );
      await sql`
      insert into contact_tag_history (id, workspace_id, contact_id, tag_id, tag_name, kind,
                                       actor_account_id, source, created_at)
      select gen_random_uuid(), l.workspace_id, l.contact_id, l.tag_id, t.name, 'added',
             l.added_by_account_id, 'profile', l.added_at
        from contact_tags l join tags t on t.id = l.tag_id and t.workspace_id = l.workspace_id
       where l.workspace_id = ${ws}`.execute(db);
      await sql`analyze contacts`.execute(db);
      await sql`analyze contact_tags`.execute(db);
      await sql`analyze tags`.execute(db);
    }, 300_000);
    afterAll(async () => {
      await app?.close();
      await deps?.destroy();
      await database?.stop();
    });

    const url = (tail: string) => `/api/workspaces/${ws}/${tail}`;
    const timed = async (run: () => Promise<LightMyRequestResponse>) => {
      const started = performance.now();
      const res = await run();
      const ms = performance.now() - started;
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
      return { res, ms };
    };
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
    /**
     * Server time on a shared machine is noisy: the budget holds when the p95 of one of up to three
     * batches of runs meets it (a missing index or a scan costs far more, in every batch).
     */
    async function withinBudget(batch: () => Promise<number[]>, budget: number, what: string) {
      const seen: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const mine = p95(await batch());
        seen.push(Math.round(mine));
        if (mine <= budget) return;
      }
      expect.fail(`${what}: p95 ${seen.join(' / ')} ms, budget ${budget} ms`);
    }
    const get = (tail: string, who = operator) =>
      app.inject({ method: 'GET', url: url(tail), cookies: who.cookies });
    const post = (tail: string, payload: object, who = operator) =>
      app.inject({ method: 'POST', url: url(tail), cookies: who.cookies, payload });

    it('seeded what the scenario says', async () => {
      const tags = TagList.parse((await get('tags')).json());
      expect(tags.items).toHaveLength(100);
      expect(tags.items.find((t) => t.id === bigA)!.contact_count).toBe(CONTACTS);
      const page = ContactPage.parse((await get('contacts')).json());
      expect(page.total_count).toBe(CONTACTS + UNTAGGED);
      expect(page.items).toHaveLength(50);
      expect(page.items.every((c) => c.tags.length === 5)).toBe(true);
    });

    const ids = (list: { id: string }[]) => list.map((t) => `&tag=${t.id}`).join('');
    const filters: [string, () => string][] = [
      ['no tag filter', () => ''],
      ['any of one tag', () => `&mode=any${ids(regular.slice(0, 1))}`],
      ['any of five tags', () => `&mode=any${ids(regular.slice(0, 5))}`],
      ['all of two tags', () => `&mode=all${ids([{ id: bigA }, regular[0]!])}`],
      // Tags 0, 33 and 66 sit together on the contacts whose seed number is 0 modulo 98.
      [
        'all of five tags',
        () =>
          `&mode=all${ids([{ id: bigA }, { id: bigB }, regular[0]!, regular[33]!, regular[66]!])}`,
      ],
      ['none (no tags)', () => `&mode=none`],
    ];
    for (const [label, filter] of filters) {
      it(`lists the first page with a search and counts within ${LIST_BUDGET_MS} ms: ${label}`, async () => {
        const query = `contacts?q=customer%201${filter()}`;
        await timed(() => get(query)); // warm the plan cache
        const page = ContactPage.parse((await get(query)).json());
        expect(page.matching_count).toBeGreaterThan(0);
        expect(page.items.length).toBeGreaterThan(0);
        await withinBudget(
          async () => {
            const runs: number[] = [];
            for (let i = 0; i < RUNS; i++) runs.push((await timed(() => get(query))).ms);
            return runs;
          },
          LIST_BUDGET_MS,
          label,
        );
      });
    }

    it(`opens a profile and its first history page within ${LIST_BUDGET_MS} ms`, async () => {
      const id = contactIds[4000]!;
      await timed(() => get(`contacts/${id}`));
      await withinBudget(
        async () => {
          const runs: number[] = [];
          for (let i = 0; i < RUNS; i++) {
            const started = performance.now();
            const [profile, history] = await Promise.all([
              get(`contacts/${id}`),
              get(`contacts/${id}/tag-history`),
            ]);
            runs.push(performance.now() - started);
            expect(ContactProfile.parse(profile.json()).tags).toHaveLength(5);
            expect(TagHistoryPage.parse(history.json()).items).toHaveLength(5);
          }
          return runs;
        },
        LIST_BUDGET_MS,
        'profile + first history page',
      );
    });

    it('records a tag change within 300 ms and pushes it to a connected socket within 3 s', async () => {
      const mate = await insertAccount(deps.db, { displayName: 'Tim Teammate' });
      const mateSession = await insertSession(deps.db, mate.id, {
        createdAt: new Date(Date.now() - 3_600_000),
      });
      await insertMembership(deps.db, ws, { accountId: mate.id });
      const socket = await app.injectWS(url('inbox/live'), {
        headers: { origin: ORIGIN, cookie: `session=${mateSession.token}` },
      });
      const frames: LiveFrame[] = [];
      socket.on('message', (data: Buffer) =>
        frames.push(LiveFrame.parse(JSON.parse(String(data)))),
      );
      try {
        let next = 100;
        /** One batch: RUNS changes on fresh contacts; every one must push. */
        const batch = async () => {
          const changeMs: number[] = [];
          const pushMs: number[] = [];
          for (let i = 0; i < RUNS; i++) {
            const contactId = contactIds[next++]!;
            const seen = frames.length;
            // A tag the contact does not carry yet (the workspace is at its 100-tag ceiling).
            const carried = new Set(
              (
                await deps.db
                  .selectFrom('contact_tags')
                  .select('tag_id')
                  .where('workspace_id', '=', ws)
                  .where('contact_id', '=', contactId)
                  .execute()
              ).map((l) => l.tag_id),
            );
            const tag = regular.find((t) => !carried.has(t.id))!;
            const started = performance.now();
            const { res, ms } = await timed(() =>
              post(`contacts/${contactId}/tags`, { tag_id: tag.id, source: 'inbox' }),
            );
            changeMs.push(ms);
            expect(ContactTagAdded.parse(res.json()).outcome).toBe('recorded');
            await vi.waitFor(
              () =>
                expect(
                  frames
                    .slice(seen)
                    .some((f) => f.type === 'contact.changed' && f.contact_id === contactId),
                ).toBe(true),
              { timeout: 3000, interval: 10 },
            );
            pushMs.push(performance.now() - started);
          }
          return { changeMs, pushMs };
        };
        const pushes: number[] = [];
        await withinBudget(
          async () => {
            const { changeMs, pushMs } = await batch();
            pushes.push(p95(pushMs));
            return changeMs;
          },
          300,
          'tag change',
        );
        // Change to push, counted from the request: within 3 s in every batch (the wait above
        // times out otherwise).
        expect(Math.max(...pushes)).toBeLessThanOrEqual(3000);
      } finally {
        socket.terminate();
      }
    });

    /** A pair of tags both carried by every tagged contact, each link with its history entry. */
    async function seedPair(label: string) {
      const db = deps.db;
      const now = new Date();
      await sql`
      insert into tags (id, workspace_id, name, name_key, created_by_account_id, created_at)
      values (gen_random_uuid(), ${ws}, ${`${label} A`}, ${`${label.toLowerCase()} a`}, ${owner.accountId}, ${now}),
             (gen_random_uuid(), ${ws}, ${`${label} B`}, ${`${label.toLowerCase()} b`}, ${owner.accountId}, ${now})`.execute(
        db,
      );
      const pair = await db
        .selectFrom('tags')
        .select(['id', 'name'])
        .where('workspace_id', '=', ws)
        .where('name', 'in', [`${label} A`, `${label} B`])
        .execute();
      const a = pair.find((t) => t.name === `${label} A`)!;
      const b = pair.find((t) => t.name === `${label} B`)!;
      await sql`
      insert into contact_tags (workspace_id, contact_id, tag_id, added_by_account_id, added_at)
      select ${ws}, c.id, t.id, ${owner.accountId}, ${now}
        from contacts c cross join (select ${a.id}::uuid as id union all select ${b.id}::uuid) t
       where c.workspace_id = ${ws} and c.telegram_user_id <= ${5_000_000 + CONTACTS}`.execute(db);
      await sql`
      insert into contact_tag_history (id, workspace_id, contact_id, tag_id, tag_name, kind,
                                       actor_account_id, source, created_at)
      select gen_random_uuid(), l.workspace_id, l.contact_id, l.tag_id, t.name, 'added',
             l.added_by_account_id, 'profile', l.added_at
        from contact_tags l join tags t on t.id = l.tag_id and t.workspace_id = l.workspace_id
       where l.workspace_id = ${ws} and l.tag_id in (${a.id}, ${b.id})`.execute(db);
      return { a: a.id, b: b.id, aName: a.name, bName: b.name };
    }

    const counted = async (kind: string, tagId: string) =>
      Number(
        (
          await deps.db
            .selectFrom('contact_tag_history')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('workspace_id', '=', ws)
            .where('kind', '=', kind as never)
            .where('tag_id', '=', tagId)
            .executeTakeFirstOrThrow()
        ).n,
      );

    /** Merges `from` into `into` (carried by every contact) and deletes `into`; checks every effect. */
    async function mergeAndDelete(from: string, into: string, intoName: string) {
      const merged = await timed(() =>
        post(`tags/${from}/rename`, { name: intoName, merge_into_tag_id: into }, owner),
      );
      expect(TagRenameResult.parse(merged.res.json())).toMatchObject({
        outcome: 'merged',
        tag: { id: into, contact_count: CONTACTS },
      });
      expect(await counted('merged', from)).toBe(CONTACTS);
      const deleted = await timed(() =>
        post(`tags/${into}/delete`, { expected_count: CONTACTS }, owner),
      );
      expect(TagDeleted.parse(deleted.res.json()).removed_from_count).toBe(CONTACTS);
      expect(await counted('deleted', into)).toBe(CONTACTS);
      const left = TagList.parse((await get('tags')).json());
      expect(left.items.some((t) => t.id === from || t.id === into)).toBe(false);
      return { mergeMs: merged.ms, deleteMs: deleted.ms };
    }

    it('merges one tag of 10 000 contacts into another and deletes it within 2 s each, with a history entry per contact', async () => {
      // Server time on a shared CI machine is noisy: the budget holds if one of three runs meets it.
      const runs: { mergeMs: number; deleteMs: number }[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const pair =
          attempt === 0
            ? { a: bigA, b: bigB, bName: 'Big B' }
            : await seedPair(`Spare ${attempt}`).then((p) => ({ a: p.a, b: p.b, bName: p.bName }));
        const run = await mergeAndDelete(pair.a, pair.b, pair.bName);
        runs.push(run);
        if (run.mergeMs <= 2000 && run.deleteMs <= 2000) break;
      }
      const best = runs.at(-1)!;
      expect(
        best.mergeMs,
        `merge ${Math.round(best.mergeMs)} ms (runs ${JSON.stringify(runs)})`,
      ).toBeLessThanOrEqual(2000);
      expect(best.deleteMs, `delete ${Math.round(best.deleteMs)} ms`).toBeLessThanOrEqual(2000);
      // Integrity after the heavy paths: every link keeps a history entry, nothing crosses.
      expect(await integrityViolations(deps.db, [ws])).toEqual([]);
    }, 300_000);
  },
);
