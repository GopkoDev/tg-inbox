import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DestinationCodeCreated,
  DestinationList,
  ErrorEnvelope,
  Post,
  PostScheduled,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { startJobs, type Jobs } from '../platform/jobs.js';
import { POST_SEND_QUEUE } from '../modules/posts/infra/jobs.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, postIntegrity, truncateAll } from './helpers.js';

const CHANNEL_ID = -1001234567890;

/**
 * Posts end to end (test-plan §API e2e, T28): connect a channel by code, draft, publish through the
 * `posts.send` worker and the fake Bot API, the at-most-once invariants, the limits, and the
 * deactivation return; the integrity queries find nothing afterwards.
 */
describe('posts flows (postgres + pg-boss + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let boss: Jobs;
  let nextUpdate = 1;
  let nextMessage = 1;
  const workspaces: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
    await app.ready();
    boss = await startJobs(database.url);
  }, 120_000);
  afterAll(async () => {
    await boss?.stop();
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
  async function person(ws: string, role: 'owner' | 'operator'): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: `${role} person` });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const membership = await insertMembership(deps.db, ws, { accountId: account.id, role });
    return { accountId: account.id, cookies: { session: session.token }, ...{ membership } };
  }

  async function workspace(name = 'Acme Flowers') {
    const ws = await insertWorkspace(deps.db, name);
    workspaces.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, {
      workspaceId: ws,
      lastCheckedAt: new Date(),
    });
    fake.bot(token).script({
      chatMembers: {
        [String(CHANNEL_ID)]: { status: 'administrator', can_post_messages: true },
      },
    });
    return {
      ws,
      token,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, 'owner'),
      owner2: await person(ws, 'owner'),
      operator: await person(ws, 'operator'),
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const api = (ws: string, tail: string) => `/api/workspaces/${ws}/posts${tail}`;
  const call = (who: Person, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      cookies: who.cookies,
      ...(method === 'POST' && { payload: payload ?? {} }),
    });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  /** The owner connects the channel with a code posted in it. */
  async function connectChannel(w: W, chatId = CHANNEL_ID) {
    const res = await call(w.owner, 'POST', api(w.ws, '/destinations/connect-codes'));
    expect(res.statusCode, res.body).toBe(201);
    const created = DestinationCodeCreated.parse(res.json());
    const delivered = await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: Math.floor(Date.now() / 1000),
        chatId,
        chatType: 'channel',
        text: created.code,
      }),
    );
    expect(delivered.statusCode).toBe(200);
    let destinationId = '';
    await vi.waitFor(async () => {
      const list = DestinationList.parse(
        (await call(w.owner, 'GET', api(w.ws, '/destinations'))).json(),
      );
      expect(list.items.length).toBe(1);
      destinationId = list.items[0]!.id;
    });
    return { code: created.code, destinationId };
  }

  async function draft(w: W, destinationId: string, text = 'Spring sale starts today') {
    const res = await call(w.operator, 'POST', api(w.ws, ''), {
      text,
      destination_id: destinationId,
    });
    expect(res.statusCode, res.body).toBe(201);
    return Post.parse(res.json());
  }

  /** Two days ahead, 09:00 local, inside the 2 minute .. 90 day window. */
  const tomorrow = () =>
    `${new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}T09:00`;
  const stateOf = async (w: W, id: string) =>
    Post.parse((await call(w.owner, 'GET', api(w.ws, `/${id}`))).json());
  const sends = (w: W) => fake.calls(w.token).filter((c) => c.method === 'sendMessage');

  it('connects a channel by code, publishes a draft once, and shows who published it (AC-01, AC-07)', async () => {
    const w = await workspace();
    const { destinationId, code } = await connectChannel(w);
    const list = DestinationList.parse(
      (await call(w.owner, 'GET', api(w.ws, '/destinations'))).json(),
    );
    expect(list.items[0]).toMatchObject({ kind: 'channel', title: 'Test Group' });
    expect(list.items[0]!.availability).toBe('available');

    // The code no longer works: a second post of it connects nothing new.
    await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: Math.floor(Date.now() / 1000),
        chatId: CHANNEL_ID - 1,
        chatType: 'channel',
        text: code,
      }),
    );
    expect(
      DestinationList.parse((await call(w.owner, 'GET', api(w.ws, '/destinations'))).json()).items,
    ).toHaveLength(1);

    const d = await draft(w, destinationId);
    const res = await call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), {
      expected_version: d.version,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(PostScheduled.parse(res.json()).outcome).toBe('queued');

    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('published'), {
      timeout: 20_000,
    });
    const published = await stateOf(w, d.id);
    expect(published.published_at).not.toBeNull();
    expect(published.schedule?.scheduled_by.account_id).toBe(w.owner.accountId);
    expect(sends(w)).toHaveLength(1);
    expect(sends(w)[0]!.params).toMatchObject({
      chat_id: String(CHANNEL_ID),
      text: 'Spring sale starts today',
    });

    const copy = await call(w.operator, 'POST', api(w.ws, `/${d.id}/duplicate`));
    expect(copy.statusCode).toBe(201);
    expect(Post.parse(copy.json()).state).toBe('draft');
  });

  it('a double click and two owners confirming publish at most once (AC-08)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    const d = await draft(w, destinationId);
    const body = { expected_version: d.version };
    const results = await Promise.all([
      call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), body),
      call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), body),
      call(w.owner2, 'POST', api(w.ws, `/${d.id}/publish`), body),
    ]);
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    const outcomes = results.map((r) => PostScheduled.parse(r.json()).outcome);
    expect(outcomes.filter((o) => o === 'queued')).toHaveLength(1);
    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('published'), {
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(sends(w)).toHaveLength(1);
  });

  it('a confirmation for a changed draft publishes nothing (AC-08)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    const d = await draft(w, destinationId);
    const saved = await call(w.operator, 'POST', api(w.ws, `/${d.id}/save`), {
      expected_version: d.version,
      text: 'Changed after the confirmation opened',
    });
    expect(saved.statusCode).toBe(200);
    const res = await call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), {
      expected_version: d.version,
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('POST_DRAFT_CHANGED');
    await new Promise((r) => setTimeout(r, 1000));
    expect(sends(w)).toHaveLength(0);
    expect((await stateOf(w, d.id)).state).toBe('draft');
  });

  it('a send Telegram never answers is marked not confirmed and not sent again (AC-08)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    fake.bot(w.token).script({
      chatMembers: { [String(CHANNEL_ID)]: { status: 'administrator', can_post_messages: true } },
      sendMessage: [sendAnswers.hang(120_000)],
    });
    const d = await draft(w, destinationId);
    const res = await call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), {
      expected_version: d.version,
    });
    expect(res.statusCode, res.body).toBe(200);
    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('not_confirmed'), {
      timeout: 40_000,
    });
    const after = await stateOf(w, d.id);
    expect(after.needs_attention).toBe(true);
    expect(sends(w)).toHaveLength(1);
  }, 60_000);

  it('the 31st send in 24 hours and the 101st scheduled post are refused (AC-16)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    const now = new Date();
    const seed = async (n: number, kind: 'sent' | 'scheduled') => {
      for (let i = 0; i < n; i++) {
        const base = {
          id: newId(),
          ws: w.ws,
          dest: destinationId,
          acc: w.owner.accountId,
          at: now,
        };
        if (kind === 'sent') {
          await sql`insert into posts (id, workspace_id, destination_id, text, silent, state, version,
            author_account_id, last_changed_by_account_id, last_changed_at, created_at, scheduled_for,
            scheduled_by_account_id, schedule_kind, sending_started_at, published_at, telegram_message_id,
            outcome_at, needs_attention)
            values (${base.id}, ${base.ws}, ${base.dest}, 'sent', false, 'published', 1, ${base.acc}, ${base.acc},
            ${now}, ${now}, ${now}, ${base.acc}, 'now', ${now}, ${now}, ${900000 + i}, ${now}, false)`.execute(
            deps.db,
          );
        } else {
          const later = new Date(now.getTime() + 10 * 86_400_000 + i * 60_000);
          await sql`insert into posts (id, workspace_id, destination_id, text, silent, state, version,
            author_account_id, last_changed_by_account_id, last_changed_at, created_at, scheduled_for,
            scheduled_by_account_id, schedule_kind, needs_attention)
            values (${base.id}, ${base.ws}, ${base.dest}, 'later', false, 'scheduled', 1, ${base.acc}, ${base.acc},
            ${now}, ${now}, ${later}, ${base.acc}, 'time', false)`.execute(deps.db);
        }
      }
    };
    await seed(100, 'scheduled');
    await call(w.owner, 'POST', api(w.ws, '/time-zone'), { time_zone: 'Europe/Kyiv' });
    const d1 = await draft(w, destinationId);
    const over = await call(w.owner, 'POST', api(w.ws, `/${d1.id}/schedule`), {
      expected_version: d1.version,
      local_time: tomorrow(),
      time_zone: 'Europe/Kyiv',
    });
    expect(over.statusCode).toBe(409);
    expect(errorOf(over).code).toBe('POST_SCHEDULED_LIMIT_REACHED');

    await seed(30, 'sent');
    const refused = await call(w.owner, 'POST', api(w.ws, `/${d1.id}/publish`), {
      expected_version: d1.version,
    });
    expect(refused.statusCode).toBe(409);
    const err = errorOf(refused);
    expect(err.code).toBe('POST_DAILY_LIMIT_REACHED');
    expect(JSON.stringify(err.details)).toContain('frees_at');
    expect(sends(w)).toHaveLength(0);
  });

  it('deactivating the scheduling owner returns their scheduled posts to drafts (AC-11)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    await call(w.owner, 'POST', api(w.ws, '/time-zone'), { time_zone: 'Europe/Kyiv' });
    const d = await draft(w, destinationId);
    const scheduled = await call(w.owner2, 'POST', api(w.ws, `/${d.id}/schedule`), {
      expected_version: d.version,
      local_time: tomorrow(),
      time_zone: 'Europe/Kyiv',
    });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    expect((await stateOf(w, d.id)).state).toBe('scheduled');

    const memberships = await deps.db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('account_id', '=', w.owner2.accountId)
      .executeTakeFirstOrThrow();
    const res = await call(
      w.owner,
      'POST',
      `/api/workspaces/${w.ws}/memberships/${memberships.id}/deactivate`,
    );
    expect(res.statusCode, res.body).toBeLessThan(300);
    const back = await stateOf(w, d.id);
    expect(back.state).toBe('draft');
    expect(back.draft_notice).toBe('owner_deactivated');
    expect(sends(w)).toHaveLength(0);
  });

  /** A scheduled post written directly (the API refuses past moments) with its `posts.send` job. */
  async function seedDue(
    w: W,
    destinationId: string,
    scheduledFor: Date,
    text: string,
    startAfter: Date = new Date(),
  ) {
    const id = newId();
    const acc = w.owner.accountId;
    await sql`insert into posts (id, workspace_id, destination_id, text, silent, state, version,
      author_account_id, last_changed_by_account_id, last_changed_at, created_at, scheduled_for,
      scheduled_by_account_id, schedule_kind, needs_attention)
      values (${id}, ${w.ws}, ${destinationId}, ${text}, false, 'scheduled', 1, ${acc}, ${acc},
      now(), now(), ${scheduledFor}, ${acc}, 'time', false)`.execute(deps.db);
    await boss.send(
      POST_SEND_QUEUE,
      { post_id: id, workspace_id: w.ws, moment: scheduledFor.toISOString() },
      { startAfter },
    );
    return id;
  }
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  it('after an outage posts past 15 minutes are missed, those inside the window go out in order, paced (AC-12)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    // Enqueued in a scrambled order; scheduled-time order is: old, a, b, c.
    const c = await seedDue(w, destinationId, minutesAgo(3), 'third');
    const old = await seedDue(w, destinationId, minutesAgo(20), 'too old');
    const b = await seedDue(w, destinationId, minutesAgo(5), 'second');
    const a = await seedDue(w, destinationId, minutesAgo(8), 'first');

    await vi.waitFor(async () => expect(sends(w)).toHaveLength(3), { timeout: 40_000 });
    await vi.waitFor(
      async () => {
        for (const id of [a, b, c]) expect((await stateOf(w, id)).state).toBe('published');
      },
      { timeout: 20_000 },
    );
    const missed = await stateOf(w, old);
    expect(missed.state).toBe('missed');
    expect(missed.outcome_reason).toBe('service_down');
    expect(missed.needs_attention).toBe(true);
    expect(sends(w).map((s) => s.params.text)).toEqual(['first', 'second', 'third']);
    const times = fake.sendTimes(w.token);
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(2_900);
    }
    expect(await postIntegrity.startedLate(deps.db, w.ws)).toEqual([]);
    expect(await postIntegrity.twoSendsOfOnePost(deps.db, w.ws)).toEqual([]);
  }, 90_000);

  it('a post scheduled through the API is published when its time comes and not before (AC-09)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    await call(w.owner, 'POST', api(w.ws, '/time-zone'), { time_zone: 'Europe/Kyiv' });
    const d = await draft(w, destinationId, 'Good morning');
    const res = await call(w.owner, 'POST', api(w.ws, `/${d.id}/schedule`), {
      expected_version: d.version,
      local_time: tomorrow(),
      time_zone: 'Europe/Kyiv',
    });
    expect(res.statusCode, res.body).toBe(200);
    const waiting = await stateOf(w, d.id);
    expect(waiting.state).toBe('scheduled');
    await new Promise((r) => setTimeout(r, 2500));
    expect(sends(w)).toHaveLength(0);

    // Bring the moment (and its job) to 4 s from now: the same row and job the API wrote.
    const moment = new Date(Date.now() + 4_000);
    await sql`update posts set scheduled_for = ${moment} where id = ${d.id}`.execute(deps.db);
    await sql`update pgboss.job set start_after = ${moment},
      data = jsonb_set(data, '{moment}', to_jsonb(${moment.toISOString()}::text))
      where name = ${POST_SEND_QUEUE} and data->>'post_id' = ${d.id}`.execute(deps.db);
    await new Promise((r) => setTimeout(r, 1500));
    expect(sends(w)).toHaveLength(0);
    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('published'), {
      timeout: 30_000,
    });
    const done = await stateOf(w, d.id);
    // The DTO carries whole seconds.
    expect(new Date(done.published_at!).getTime()).toBeGreaterThanOrEqual(
      Math.floor(moment.getTime() / 1000) * 1000,
    );
    expect(new Date(done.published_at!).getTime() - moment.getTime()).toBeLessThan(60_000);
    expect(sends(w)).toHaveLength(1);
    expect(sends(w)[0]!.params).toMatchObject({ text: 'Good morning' });
  }, 60_000);

  it('deleting a published post through the API deletes it in Telegram and keeps its text (AC-15)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    const d = await draft(w, destinationId, 'Oops, wrong price');
    await call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), { expected_version: d.version });
    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('published'), {
      timeout: 20_000,
    });
    // Connecting the channel already removed the code message; count from here.
    const deleteCalls = () => fake.calls(w.token).filter((c) => c.method === 'deleteMessage');
    const before = deleteCalls().length;
    const refused = await call(w.operator, 'POST', api(w.ws, `/${d.id}/delete-from-telegram`));
    expect(refused.statusCode).toBe(403);
    expect(deleteCalls()).toHaveLength(before);

    const res = await call(w.owner, 'POST', api(w.ws, `/${d.id}/delete-from-telegram`));
    expect(res.statusCode, res.body).toBe(200);
    const deletes = deleteCalls().slice(before);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.params).toMatchObject({ chat_id: String(CHANNEL_ID) });
    const after = await stateOf(w, d.id);
    expect(after.state).toBe('deleted');
    expect(after.deleted_at).not.toBeNull();
    expect(after.deleted_by?.account_id).toBe(w.owner.accountId);
    expect(after.text).toBe('Oops, wrong price');

    // Past 48 hours the bot can no longer delete it.
    const old = await draft(w, destinationId, 'Old news');
    await call(w.owner, 'POST', api(w.ws, `/${old.id}/publish`), { expected_version: old.version });
    await vi.waitFor(async () => expect((await stateOf(w, old.id)).state).toBe('published'), {
      timeout: 20_000,
    });
    await sql`update posts set published_at = now() - interval '49 hours' where id = ${old.id}`.execute(
      deps.db,
    );
    const late = await call(w.owner, 'POST', api(w.ws, `/${old.id}/delete-from-telegram`));
    expect(late.statusCode).toBe(409);
    expect((await stateOf(w, old.id)).state).toBe('published');
    expect(deleteCalls()).toHaveLength(before + 1);
  }, 60_000);

  it('a scheduled post whose time comes at the daily limit fails with daily_limit and sends nothing (AC-16)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    await sql`insert into posts (id, workspace_id, destination_id, text, silent, state, version,
      author_account_id, last_changed_by_account_id, last_changed_at, created_at, scheduled_for,
      scheduled_by_account_id, schedule_kind, sending_started_at, published_at, telegram_message_id,
      outcome_at, needs_attention)
      select gen_random_uuid(), ${w.ws}, ${destinationId}, 'sent', false, 'published', 1,
        ${w.owner.accountId}, ${w.owner.accountId}, now(), now(), now(), ${w.owner.accountId}, 'now',
        now() - interval '1 hour', now() - interval '1 hour', 800000 + g, now(), false
      from generate_series(1, 30) g`.execute(deps.db);
    const id = await seedDue(w, destinationId, minutesAgo(1), 'one too many');
    await vi.waitFor(async () => expect((await stateOf(w, id)).state).toBe('failed'), {
      timeout: 20_000,
    });
    const failed = await stateOf(w, id);
    expect(failed.outcome_reason).toBe('daily_limit');
    expect(failed.needs_attention).toBe(true);
    expect(sends(w)).toHaveLength(0);
    expect(await postIntegrity.overDailyCap(deps.db, w.ws)).toEqual([]);
  }, 60_000);

  it('integrity queries find nothing after the suite (all ACs)', async () => {
    const w = await workspace();
    const { destinationId } = await connectChannel(w);
    const d = await draft(w, destinationId);
    await call(w.owner, 'POST', api(w.ws, `/${d.id}/publish`), { expected_version: d.version });
    await vi.waitFor(async () => expect((await stateOf(w, d.id)).state).toBe('published'), {
      timeout: 20_000,
    });
    expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
  });
});
