import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Broadcast,
  BroadcastDraft,
  BroadcastLaunched,
  BroadcastStopped,
  LaunchConfirmation,
  LiveFrame,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { startJobs, type Jobs } from '../platform/jobs.js';
import { webhookUrl } from '../modules/bots/app/webhook-url.js';
import {
  sendAnswers,
  startFakeTelegram,
  type BotScript,
  type FakeTelegram,
} from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertContact } from '../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../test/fixtures/conversations.js';
import { insertTelegramLink } from '../test/fixtures/notifications.js';
import { signedDelivery, telegramMyChatMember } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
// Spec §6 budgets (asserted as written; the measured values are logged).
const PACE_PER_SECOND = 25;
const COMPLETION_1000_MS = 90 * SECOND;
const REPLY_P95_MS = 2 * SECOND;
const DRAFT_COUNT_P95_MS = 500;
const LAUNCH_10000_MS = 2 * SECOND;
const STOP_EFFECT_MS = 2 * SECOND;
const BLOCK_FRESHNESS_MS = 5 * SECOND;
const REPORT_LIVE_P95_MS = 3 * SECOND;
const OTHER_WORKSPACE_SLACK_MS = 1 * SECOND;
/**
 * The fake records when a send *reaches* it, not when the sender started it: a few ms of transport
 * jitter between two sends 25 slots apart can bring the 26th arrival a hair inside one second of
 * the first although their starts were 1 000 ms apart (the same allowance as the bots pacer test).
 */
const ARRIVAL_JITTER_MS = 10;

/**
 * Broadcast sending at pilot scale (spec §6, test-plan "NFR validation (load)"), the single-run CI
 * version of each scenario: one pace window run, one 1 000-recipient run with replies, another
 * workspace's replies and pings and the report's live update, one reply rate limit, one draft read
 * per kind and one launch on 10 000 contacts, one stop, one block notice. Real routes, the real
 * pg-boss chain and the fake Bot API against Postgres; seeds are set-based inserts.
 */
describe(
  'broadcasts sending and timing at pilot scale (postgres + pg-boss + fake Bot API)',
  {
    timeout: 300_000,
  },
  () => {
    let database: TestDatabase;
    let fake: FakeTelegram;
    let deps: Deps;
    let app: FastifyInstance;
    let boss: Jobs;
    let nextUpdate = 1;
    const touched: string[] = [];

    beforeAll(async () => {
      database = await startTestDatabase();
      fake = await startFakeTelegram();
      const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
      deps = buildDeps(config);
      app = await buildApp(config);
      await app.ready();
      // `deps.startPings` queues on this database; the app's workers run the sweep.
      boss = await startJobs(database.url);
      deps.bindNotificationJobs(boss);
    }, 120_000);
    afterAll(async () => {
      await boss?.stop({ graceful: false });
      await app?.close();
      await deps?.destroy();
      await fake?.stop();
      await database?.stop();
    });

    type Person = { accountId: string; cookies: { session: string } };
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
    const call = (who: Person, method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, cookies: who.cookies, ...(payload && { payload }) });
    const api = (ws: string, tail: string) => `/api/workspaces/${ws}/${tail}`;
    const ok = async <T>(
      schema: { parse: (v: unknown) => T },
      res: Promise<LightMyRequestResponse>,
    ): Promise<T> => {
      const r = await res;
      expect(r.statusCode, r.body.slice(0, 300)).toBeLessThan(300);
      return schema.parse(r.json());
    };
    const log = (what: string, value: number | string) =>
      console.info(`[broadcasts-load] ${what}: ${value}`);

    async function person(ws: string, role: 'owner' | 'operator', name: string): Promise<Person> {
      const account = await insertAccount(deps.db, { displayName: name });
      const session = await insertSession(deps.db, account.id, {
        createdAt: new Date(Date.now() - 3_600_000),
      });
      await insertMembership(deps.db, ws, { accountId: account.id, role });
      return { accountId: account.id, cookies: { session: session.token } };
    }

    let nextTelegramId = 20_000_000;
    /**
     * A workspace with its bot and `reachable` customers who wrote to it (set-based: contacts, an
     * open conversation each, the reach row), plus `blocked` who blocked it and `neverWrote` who
     * never wrote to it. `tags` names tags put on ranges of the reachable customers.
     */
    async function seed(o: {
      name: string;
      reachable: number;
      blocked?: number;
      neverWrote?: number;
      tags?: { name: string; from: number; to: number }[];
    }) {
      const db = deps.db;
      const ws = await insertWorkspace(db, o.name);
      touched.push(ws);
      const { bot, token, webhookSecret } = await insertBot(db, {
        workspaceId: ws,
        lastCheckedAt: new Date(),
      });
      // The fake reports our own webhook, so a health check that falls due during a long run
      // keeps the bot connected (an unscripted fake would read as taken over).
      const hookUrl = webhookUrl(
        deps.config.TELEGRAM_WEBHOOK_BASE_URL ?? deps.config.PUBLIC_WEB_URL,
        bot.id,
      );
      const script = (more: BotScript = {}) =>
        fake.bot(token).script({ webhookUrl: hookUrl, ...more });
      script();
      const owner = await person(ws, 'owner', 'Olga Owner');
      const operator = await person(ws, 'operator', 'Oleh Operator');
      const blocked = o.blocked ?? 0;
      const neverWrote = o.neverWrote ?? 0;
      const total = o.reachable + blocked + neverWrote;
      const base = nextTelegramId;
      nextTelegramId += total + 1;
      const now = new Date();
      // Test-owned SQL: ids from gen_random_uuid() here, never in the app. `n` orders the customers.
      await sql`
      insert into contacts (id, workspace_id, telegram_user_id, first_name, last_name, username,
                            language_code, profile_seen_at, created_at, first_wrote_at, last_wrote_at)
      select gen_random_uuid(), ${ws}, ${base}::bigint + n, 'Customer ' || n, 'Seed', 'cust_' || n,
             'en', ${now}, ${now}, ${now}, ${now}
        from generate_series(1, ${total}::int) as n`.execute(db);
      await sql`
      insert into conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
                                 last_activity_at, last_message_received_at, status, state_version,
                                 customer_message_seq, waiting_since, waiting_started_by)
      select gen_random_uuid(), c.workspace_id, c.id, c.telegram_user_id, ${now}, ${now}, ${now},
             'open', 0, 0, ${now}, 'message'
        from contacts c where c.workspace_id = ${ws}`.execute(db);
      // Reachable: 1…reachable wrote; then `blocked` wrote and blocked; the rest never wrote.
      await sql`
      insert into contact_bot_reach (workspace_id, contact_id, telegram_bot_id, wrote_at, blocked_at, changed_at)
      select c.workspace_id, c.id, ${bot.telegramBotId}::bigint, ${now},
             case when c.telegram_user_id - ${base}::bigint > ${o.reachable}::int then ${now}::timestamptz end,
             ${now}
        from contacts c
       where c.workspace_id = ${ws}
         and c.telegram_user_id - ${base}::bigint <= ${o.reachable + blocked}::int`.execute(db);
      const tagIds: Record<string, string> = {};
      for (const t of o.tags ?? []) {
        const id = newId();
        tagIds[t.name] = id;
        await sql`
        insert into tags (id, workspace_id, name, name_key, created_by_account_id, created_at)
        values (${id}, ${ws}, ${t.name}, ${t.name.toLowerCase()}, ${owner.accountId}, ${now})`.execute(
          db,
        );
        await sql`
        insert into contact_tags (workspace_id, contact_id, tag_id, added_by_account_id, added_at)
        select ${ws}, c.id, ${id}, ${owner.accountId}, ${now}
          from contacts c
         where c.workspace_id = ${ws}
           and c.telegram_user_id - ${base}::bigint between ${t.from}::int and ${t.to}::int`.execute(
          db,
        );
        await sql`
        insert into contact_tag_history (id, workspace_id, contact_id, tag_id, tag_name, kind,
                                         actor_account_id, source, created_at)
        select gen_random_uuid(), l.workspace_id, l.contact_id, l.tag_id, ${t.name}, 'added',
               l.added_by_account_id, 'profile', l.added_at
          from contact_tags l where l.workspace_id = ${ws} and l.tag_id = ${id}`.execute(db);
      }
      await sql`analyze contacts`.execute(db);
      await sql`analyze contact_bot_reach`.execute(db);
      await sql`analyze contact_tags`.execute(db);
      await sql`analyze conversations`.execute(db);
      const conversations = (
        await db
          .selectFrom('conversations as v')
          .innerJoin('contacts as c', 'c.id', 'v.contact_id')
          .select(['v.id', 'c.telegram_user_id'])
          .where('v.workspace_id', '=', ws)
          .orderBy('c.telegram_user_id')
          .execute()
      ).map((r) => r.id);
      return {
        ws,
        token,
        telegramBotId: bot.telegramBotId,
        hook: { id: bot.id, secret: webhookSecret! },
        owner,
        operator,
        tagIds,
        base,
        conversations,
        script,
      };
    }
    type W = Awaited<ReturnType<typeof seed>>;

    async function tagDraft(
      w: W,
      name: string,
      o: { mode: 'any' | 'all' | 'none'; tags?: string[]; exclude?: string[] },
    ) {
      const d = await ok(
        BroadcastDraft,
        call(w.operator, 'POST', api(w.ws, 'broadcasts'), { name, text: `${name} text` }),
      );
      return ok(
        BroadcastDraft,
        call(w.operator, 'POST', api(w.ws, `broadcasts/${d.id}/audience`), {
          expected_version: d.version,
          kind: 'tags',
          mode: o.mode,
          tag_ids: (o.tags ?? []).map((t) => w.tagIds[t]!),
          exclude_tag_ids: (o.exclude ?? []).map((t) => w.tagIds[t]!),
        }),
      );
    }
    const confirmation = (w: W, id: string) =>
      ok(
        LaunchConfirmation,
        call(w.owner, 'GET', api(w.ws, `broadcasts/${id}/launch-confirmation`)),
      );
    async function launch(w: W, c: LaunchConfirmation) {
      const started = performance.now();
      const res = await call(w.owner, 'POST', api(w.ws, `broadcasts/${c.broadcast_id}/launch`), {
        expected_version: c.version,
        fingerprint: c.fingerprint,
      });
      const ms = performance.now() - started;
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
      expect(BroadcastLaunched.parse(res.json()).outcome).toBe('launched');
      return ms;
    }
    const read = async (w: W, id: string) => {
      const b = await ok(Broadcast, call(w.owner, 'GET', api(w.ws, `broadcasts/${id}`)));
      if (b.status === 'draft') throw new Error('expected a launched broadcast');
      return b;
    };
    async function settled(w: W, id: string, timeout: number) {
      await vi.waitFor(
        async () => {
          const b = await read(w, id);
          expect(b.status).not.toBe('sending');
          expect(b.totals).toMatchObject({ waiting: 0, sending: 0 });
        },
        { timeout, interval: 250 },
      );
      return read(w, id);
    }
    /** Each `sendMessage` the fake recorded for a bot, with the time it reached the fake. */
    const sendsOf = (token: string) => {
      const times = fake.sendTimes(token);
      return fake
        .calls(token)
        .filter((c) => c.method === 'sendMessage')
        .map((c, i) => ({
          chat: String(c.params.chat_id),
          text: String(c.params.text),
          at: times[i]!,
        }));
    };
    /** The most sends of `times` in any 1 s window (less the arrival jitter allowance). */
    const maxPerSecond = (times: number[]) => {
      const sorted = [...times].sort((a, b) => a - b);
      let most = 0;
      for (const [i, t] of sorted.entries()) {
        let n = 0;
        for (let j = i; j < sorted.length && sorted[j]! < t + SECOND - ARRIVAL_JITTER_MS; j++) n++;
        most = Math.max(most, n);
      }
      return most;
    };
    /** Sends a reply and times it from the request to the reply being accepted by Telegram. */
    async function timedReply(w: W, conversationId: string, text: string) {
      const started = performance.now();
      const res = await call(
        w.operator,
        'POST',
        api(w.ws, `inbox/conversations/${conversationId}/replies`),
        {
          client_key: newId(),
          body: text,
          last_seen_reply_id: null,
        },
      );
      expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
      const replyId = (res.json() as { id: string }).id;
      for (;;) {
        const row = await deps.db
          .selectFrom('replies')
          .select('state')
          .where('id', '=', replyId)
          .executeTakeFirstOrThrow();
        if (row.state !== 'sending') {
          expect(row.state).toBe('sent');
          return performance.now() - started;
        }
        if (performance.now() - started > 30 * SECOND) throw new Error('a reply did not leave');
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    /** `count` replies at 2 per second to the given conversations; their latencies. */
    async function replyBatch(w: W, conversations: string[], label: string) {
      const latencies: number[] = [];
      const inFlight: Promise<void>[] = [];
      for (const [i, conversationId] of conversations.entries()) {
        inFlight.push(
          timedReply(w, conversationId, `${label} ${i}`).then((ms) => void latencies.push(ms)),
        );
        await new Promise((r) => setTimeout(r, 500));
      }
      await Promise.all(inFlight);
      return latencies;
    }

    it('two broadcasts of one bot sending together take turns and no 1 s window holds more than 25 of its sends (AC-15)', async () => {
      /**
       * One run: two broadcasts of 150 sending together, Telegram answering after 50 ms. The fake
       * shares the test's event loop, so a stall on a loaded machine bunches the recorded arrivals;
       * like the other timing checks here, the budget holds when one of up to three runs meets it
       * (a pacer above 25 per second exceeds it in every run).
       */
      async function run(attempt: number) {
        const w = await seed({
          name: `Pace Flowers ${attempt}`,
          reachable: 300,
          tags: [
            { name: 'P1', from: 1, to: 150 },
            { name: 'P2', from: 151, to: 300 },
          ],
        });
        w.script({ sendMessage: Array.from({ length: 300 }, () => sendAnswers.hang(50)) });
        const one = await tagDraft(w, 'First', { mode: 'any', tags: ['P1'] });
        const two = await tagDraft(w, 'Second', { mode: 'any', tags: ['P2'] });
        await launch(w, await confirmation(w, one.id));
        await launch(w, await confirmation(w, two.id));
        const a = await settled(w, one.id, 60 * SECOND);
        const b = await settled(w, two.id, 60 * SECOND);
        expect(a.totals.delivered).toBe(150);
        expect(b.totals.delivered).toBe(150);

        const sends = sendsOf(w.token);
        expect(sends).toHaveLength(300);
        expect(new Set(sends.map((s) => s.chat)).size).toBe(300);
        // Turns: in the first half of the run both broadcasts are sending, neither waits.
        const half = sends.slice(0, 150);
        const firsts = half.filter((s) => s.text === 'First text').length;
        expect(firsts).toBeGreaterThanOrEqual(60);
        expect(150 - firsts).toBeGreaterThanOrEqual(60);
        expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
        return maxPerSecond(sends.map((s) => s.at));
      }
      const seen: number[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        seen.push(await run(attempt));
        if (seen.at(-1)! <= PACE_PER_SECOND) break;
      }
      log('most broadcast sends of one bot in a 1 s window (per run)', seen.join(' / '));
      expect(Math.min(...seen)).toBeLessThanOrEqual(PACE_PER_SECOND);
    });

    it('1 000 recipients with a 150 ms answer all have an outcome within 90 s; replies meanwhile keep p95 ≤ 2 s; the report re-read shows an outcome within 3 s; another workspace’s replies and pings stay within 1 s of their idle p95 (AC-11, AC-15)', async () => {
      const a = await seed({ name: 'Busy Flowers', reachable: 1000 });
      const b = await seed({ name: 'Quiet Bikes', reachable: 40 });
      // Every send of A's bot (broadcast and reply alike) is answered after 150 ms.
      a.script({
        sendMessage: Array.from({ length: 1100 }, () => sendAnswers.hang(150)),
      });

      // B's pings: one customer waiting for 6 minutes, linked members away from the panel.
      const since = new Date(Date.now() - 6 * MINUTE);
      const waiter = await insertConversation(deps.db, {
        workspaceId: b.ws,
        contactId: await insertContact(deps.db, { workspaceId: b.ws, telegramUserId: 31_000_000n }),
        waitingSince: since,
        waitingStartedBy: 'message',
        lastMessageReceivedAt: since,
        lastActivityAt: since,
      });
      await insertMessage(deps.db, {
        workspaceId: b.ws,
        conversationId: waiter,
        telegramMessageId: 1n,
        receivedAt: since,
        sentAt: since,
      });
      const memberChats = new Map<string, number>();
      const linkMembers = async (from: number, n: number) => {
        const accounts: string[] = [];
        for (let i = 0; i < n; i++) {
          const { accountId } = await insertMembership(deps.db, b.ws);
          await insertTelegramLink(deps.db, {
            workspaceId: b.ws,
            accountId,
            telegramBotId: b.telegramBotId,
            telegramUserId: BigInt(from + i),
          });
          memberChats.set(accountId, from + i);
          accounts.push(accountId);
        }
        return accounts;
      };
      /** From each ping's ledger row (written before its send) to its arrival at the fake. */
      const pingLatencies = async (accounts: string[]) => {
        let rows: { account_id: string; created_at: Date }[] = [];
        await vi.waitFor(
          async () => {
            rows = await deps.db
              .selectFrom('pings')
              .select(['account_id', 'created_at'])
              .where('workspace_id', '=', b.ws)
              .where('account_id', 'in', accounts)
              .where('outcome', '=', 'accepted')
              .execute();
            expect(rows).toHaveLength(accounts.length);
          },
          { timeout: 60 * SECOND, interval: 100 },
        );
        const arrivals = sendsOf(b.token);
        return rows.map((r) => {
          const chat = String(memberChats.get(r.account_id));
          const sent = arrivals.find((s) => s.chat === chat)!;
          return sent.at - r.created_at.getTime();
        });
      };

      // Baseline with A idle: B's replies and pings.
      const idleReplies = await replyBatch(b, b.conversations.slice(0, 10), 'Idle reply');
      const idleMembers = await linkMembers(32_000_000, 10);
      expect(await deps.startPings(b.ws)).toBe(true);
      const idlePings = await pingLatencies(idleMembers);

      // A launches 1 000; a socket of A re-reads the report on each report signal, one at a time.
      const d = await tagDraft(a, 'Big send', { mode: 'none' });
      const socket = await app.injectWS(api(a.ws, 'inbox/live'), {
        headers: { origin: ORIGIN, cookie: `session=${a.operator.cookies.session}` },
      });
      const rereads: { at: number; outcomes: number }[] = [];
      let reading = false;
      let again = false;
      const reread = async () => {
        if (reading) {
          again = true;
          return;
        }
        reading = true;
        do {
          again = false;
          const t = (await read(a, d.id)).totals;
          rereads.push({ at: Date.now(), outcomes: 1000 - t.waiting - t.sending });
        } while (again);
        reading = false;
      };
      socket.on('message', (data: Buffer) => {
        const f = LiveFrame.parse(JSON.parse(String(data)));
        if (f.type === 'broadcast.changed' && f.broadcast_id === d.id && f.change === 'report') {
          void reread();
        }
      });
      // Committed outcomes, sampled from the database.
      const committed: { at: number; outcomes: number }[] = [];
      const sampler = setInterval(() => {
        const at = Date.now();
        void deps.db
          .selectFrom('broadcast_recipients')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', a.ws)
          .where('broadcast_id', '=', d.id)
          .where('state', 'not in', ['waiting', 'sending'])
          .executeTakeFirstOrThrow()
          .then((r) => void committed.push({ at, outcomes: Number(r.n) }));
      }, 250);

      const launchedAt = Date.now();
      await launch(a, await confirmation(a, d.id));
      await vi.waitFor(() => expect(sendsOf(a.token).length).toBeGreaterThanOrEqual(50), {
        timeout: 30 * SECOND,
        interval: 50,
      });
      // During: A's own replies, B's replies and a fresh set of B's members to ping.
      const busyMembers = await linkMembers(33_000_000, 10);
      const [busyReplies, otherReplies] = await Promise.all([
        replyBatch(a, a.conversations.slice(0, 20), 'Busy reply'),
        replyBatch(b, b.conversations.slice(10, 20), 'Other reply'),
      ]);
      const busyPings = await pingLatencies(busyMembers);
      expect(sendsOf(a.token).filter((s) => s.text === 'Big send text').length).toBeLessThan(1000);

      const done = await settled(a, d.id, COMPLETION_1000_MS);
      const finishedIn = Date.now() - launchedAt;
      clearInterval(sampler);
      log('1 000 recipients, launch to every outcome (ms)', finishedIn);
      expect(done.totals.delivered).toBe(1000);
      expect(finishedIn).toBeLessThanOrEqual(COMPLETION_1000_MS);
      const broadcastSends = sendsOf(a.token).filter((s) => s.text === 'Big send text');
      expect(broadcastSends).toHaveLength(1000);
      expect(new Set(broadcastSends.map((s) => s.chat)).size).toBe(1000);

      log('A reply p95 during the broadcast (ms)', Math.round(p95(busyReplies)));
      expect(p95(busyReplies)).toBeLessThanOrEqual(REPLY_P95_MS);
      log(
        'B reply p95 idle / during (ms)',
        `${Math.round(p95(idleReplies))} / ${Math.round(p95(otherReplies))}`,
      );
      expect(p95(otherReplies)).toBeLessThanOrEqual(p95(idleReplies) + OTHER_WORKSPACE_SLACK_MS);
      log(
        'B ping p95 idle / during (ms)',
        `${Math.round(p95(idlePings))} / ${Math.round(p95(busyPings))}`,
      );
      expect(p95(busyPings)).toBeLessThanOrEqual(p95(idlePings) + OTHER_WORKSPACE_SLACK_MS);

      // The report's re-read caught up with each committed count within 3 s.
      await vi.waitFor(() => expect(rereads.at(-1)?.outcomes).toBe(1000), {
        timeout: 10 * SECOND,
        interval: 100,
      });
      socket.terminate();
      const lags = committed
        .filter((c) => c.outcomes > 0)
        .map((c) => {
          const seen = rereads.find((r) => r.at >= c.at && r.outcomes >= c.outcomes);
          return seen ? seen.at - c.at : Number.POSITIVE_INFINITY;
        });
      expect(lags.length).toBeGreaterThan(10);
      log('report re-read lag p95 (ms)', Math.round(p95(lags)));
      expect(p95(lags)).toBeLessThanOrEqual(REPORT_LIVE_P95_MS);
      expect(await integrityViolations(deps.db, [a.ws, b.ws])).toEqual([]);
    });

    it('a 429 answered to a reply stops every broadcast send until retry_after; then the broadcast continues without skips or doubles (AC-15)', async () => {
      const w = await seed({ name: 'Limited Flowers', reachable: 40 });
      // The broadcast's first 8 sends (all a link keeps in flight) hang 2 s; the next send to reach
      // Telegram — the reply sent meanwhile — is told to retry after 3 s.
      w.script({
        sendMessage: [
          ...Array.from({ length: 8 }, () => sendAnswers.hang(2000)),
          sendAnswers.tooMany(3),
        ],
      });
      const d = await tagDraft(w, 'Paced', { mode: 'none' });
      await launch(w, await confirmation(w, d.id));
      await vi.waitFor(() => expect(sendsOf(w.token)).toHaveLength(8), {
        timeout: 10 * SECOND,
        interval: 20,
      });
      const res = await call(
        w.operator,
        'POST',
        api(w.ws, `inbox/conversations/${w.conversations[39]}/replies`),
        {
          client_key: newId(),
          body: 'A reply',
          last_seen_reply_id: null,
        },
      );
      expect(res.statusCode).toBe(201);
      await vi.waitFor(() => expect(sendsOf(w.token)).toHaveLength(9), {
        timeout: 10 * SECOND,
        interval: 20,
      });
      const limitedAt = sendsOf(w.token)[8]!;
      expect(limitedAt.text).toBe('A reply');
      let pausedUntil = 0;
      await vi.waitFor(
        async () => {
          const row = await deps.db
            .selectFrom('bots')
            .select('send_paused_until')
            .where('workspace_id', '=', w.ws)
            .executeTakeFirstOrThrow();
          expect(row.send_paused_until).not.toBeNull();
          pausedUntil = row.send_paused_until!.getTime();
        },
        { timeout: 5 * SECOND, interval: 20 },
      );
      expect(pausedUntil).toBeGreaterThanOrEqual(limitedAt.at + 2 * SECOND);

      const done = await settled(w, d.id, 60 * SECOND);
      expect(done.totals.delivered).toBe(40);
      const broadcastSends = sendsOf(w.token).filter((s) => s.text === 'Paced text');
      // No broadcast send reached Telegram between the 429 and the pause's end.
      const during = broadcastSends.filter((s) => s.at > limitedAt.at && s.at < pausedUntil);
      expect(during).toEqual([]);
      // Every recipient exactly once: none skipped, none doubled.
      expect(broadcastSends).toHaveLength(40);
      expect(new Set(broadcastSends.map((s) => s.chat)).size).toBe(40);
      expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
    });

    describe('10 000 contacts', () => {
      let w: W;
      beforeAll(async () => {
        // 10 000 reachable carry "Big"; 100 tags in all with about 30 000 links; 5 blocked and
        // 5 who never wrote outside "Big".
        const tags = [{ name: 'Big', from: 1, to: 10_000 }];
        for (let i = 1; i <= 99; i++) {
          const from = ((i - 1) * 101) % 10_000;
          tags.push({ name: `Tag ${String(i).padStart(3, '0')}`, from: from + 1, to: from + 202 });
        }
        w = await seed({
          name: 'Pilot Flowers',
          reachable: 10_000,
          blocked: 5,
          neverWrote: 5,
          tags,
        });
      }, 300_000);

      const timed = async (run: () => Promise<LightMyRequestResponse>) => {
        const started = performance.now();
        const res = await run();
        const ms = performance.now() - started;
        expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
        return { res, ms };
      };
      /**
       * Server time on a shared machine is noisy: the budget holds when the p95 of one of up to three
       * batches of runs meets it (a missing index or a scan costs far more, in every batch).
       */
      async function withinBudget(batch: () => Promise<number[]>, budget: number, what: string) {
        const seen: number[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const mine = p95(await batch());
          seen.push(Math.round(mine));
          if (mine <= budget) {
            log(what, seen.join(' / '));
            return;
          }
        }
        expect.fail(`${what}: p95 ${seen.join(' / ')} ms, budget ${budget} ms`);
      }

      it('counts a draft of 10 000 contacts in ≤ 500 ms, as a tag audience and as a group (spec §6)', async () => {
        const tagged = await tagDraft(w, 'Everyone', {
          mode: 'any',
          tags: ['Big'],
          exclude: ['Tag 007'],
        });
        expect(tagged.breakdown.audience_size).toBe(10_000 - 202);
        const group = await ok(
          BroadcastDraft,
          call(w.operator, 'POST', api(w.ws, 'broadcasts'), { name: 'Group', text: 'Group text' }),
        );
        await ok(
          BroadcastDraft,
          call(w.operator, 'POST', api(w.ws, `broadcasts/${group.id}/audience`), {
            expected_version: group.version,
            kind: 'group',
          }),
        );
        await sql`
        insert into broadcast_group_contacts (workspace_id, broadcast_id, contact_id, added_by_account_id, added_at)
        select c.workspace_id, ${group.id}, c.id, ${w.operator.accountId}, now()
          from contacts c
         where c.workspace_id = ${w.ws}
         order by c.telegram_user_id desc
         limit 10000`.execute(deps.db);
        await sql`analyze broadcast_group_contacts`.execute(deps.db);
        const readDraft = (id: string) => () =>
          timed(() => call(w.operator, 'GET', api(w.ws, `broadcasts/${id}`)));
        const first = BroadcastDraft.parse((await readDraft(group.id)()).res.json());
        expect(first.breakdown).toEqual({
          audience_size: 10_000,
          reach: { blocked_count: 5, never_wrote_count: 5, reachable_count: 9_990 },
        });
        const batch = (id: string) => async () => {
          const out: number[] = [];
          for (let i = 0; i < 10; i++) out.push((await readDraft(id)()).ms);
          return out;
        };
        await withinBudget(
          batch(tagged.id),
          DRAFT_COUNT_P95_MS,
          'tag audience draft read p95 (ms)',
        );
        await withinBudget(batch(group.id), DRAFT_COUNT_P95_MS, 'group draft read p95 (ms)');
      });

      it('freezes 10 000 recipients in ≤ 2 s; a stop takes effect at once: no send of it starts 2 s after the stop (AC-18)', async () => {
        // The launch is one-shot per draft; a noisy machine gets up to three launches (the cap is 10).
        const launched: string[] = [];
        const seen: number[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const d = await tagDraft(w, `Ten thousand ${attempt + 1}`, {
            mode: 'any',
            tags: ['Big'],
          });
          const c = await confirmation(w, d.id);
          expect(c.breakdown.recipient_count).toBe(10_000);
          const ms = await launch(w, c);
          launched.push(d.id);
          seen.push(Math.round(ms));
          const rows = await deps.db
            .selectFrom('broadcast_recipients')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('workspace_id', '=', w.ws)
            .where('broadcast_id', '=', d.id)
            .executeTakeFirstOrThrow();
          expect(Number(rows.n)).toBe(10_000);
          if (ms <= LAUNCH_10000_MS) break;
        }
        log('launch of 10 000 (ms)', seen.join(' / '));
        expect(Math.min(...seen)).toBeLessThanOrEqual(LAUNCH_10000_MS);

        // The chain is sending them all; stop each once it has sent a little.
        await vi.waitFor(() => expect(sendsOf(w.token).length).toBeGreaterThanOrEqual(50), {
          timeout: 30 * SECOND,
          interval: 50,
        });
        const stops: { id: string; requestedAt: number }[] = [];
        for (const id of launched) {
          const requestedAt = Date.now();
          const stopped = await ok(
            BroadcastStopped,
            call(w.owner, 'POST', api(w.ws, `broadcasts/${id}/stop`)),
          );
          expect(stopped.outcome).toBe('stopped');
          stops.push({ id, requestedAt });
        }
        for (const { id } of stops) {
          const b = await settled(w, id, 30 * SECOND);
          expect(b.status).toBe('stopped');
          expect(b.totals.stopped).toBeGreaterThan(9_000);
        }
        await new Promise((r) => setTimeout(r, 3 * SECOND));
        // Every send reached the fake before the last stop's request + 2 s (the commit is later).
        const last = Math.max(...stops.map((s) => s.requestedAt));
        const late = sendsOf(w.token).filter((s) => s.at > last + STOP_EFFECT_MS);
        log('sends after the stop (+2 s)', late.length);
        expect(late).toEqual([]);
        expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
      });

      it('a my_chat_member block notice marks the contact and signals it within 5 s (spec §6)', async () => {
        const socket = await app.injectWS(api(w.ws, 'inbox/live'), {
          headers: { origin: ORIGIN, cookie: `session=${w.operator.cookies.session}` },
        });
        const fromId = w.base + 42;
        const contact = await deps.db
          .selectFrom('contacts')
          .select('id')
          .where('workspace_id', '=', w.ws)
          .where('telegram_user_id', '=', BigInt(fromId) as never)
          .executeTakeFirstOrThrow();
        let signalledAt = 0;
        socket.on('message', (data: Buffer) => {
          const f = LiveFrame.parse(JSON.parse(String(data)));
          if (f.type === 'contact.changed' && f.contact_id === contact.id && f.change === 'reach') {
            signalledAt ||= Date.now();
          }
        });
        const receivedAt = Date.now();
        const res = await signedDelivery(
          app,
          w.hook,
          telegramMyChatMember({
            updateId: nextUpdate++,
            fromId,
            date: Math.floor(receivedAt / 1000),
            status: 'kicked',
          }),
        );
        expect(res.statusCode).toBe(200);
        let markedAt = 0;
        await vi.waitFor(
          async () => {
            const row = await deps.db
              .selectFrom('contact_bot_reach')
              .select('blocked_at')
              .where('workspace_id', '=', w.ws)
              .where('contact_id', '=', contact.id)
              .executeTakeFirstOrThrow();
            expect(row.blocked_at).not.toBeNull();
            markedAt ||= Date.now();
            expect(signalledAt).toBeGreaterThan(0);
          },
          { timeout: BLOCK_FRESHNESS_MS + SECOND, interval: 20 },
        );
        socket.terminate();
        const freshness = Math.max(markedAt, signalledAt) - receivedAt;
        log('block notice to mark + signal (ms)', freshness);
        expect(freshness).toBeLessThanOrEqual(BLOCK_FRESHNESS_MS);
      });
    });
  },
);
