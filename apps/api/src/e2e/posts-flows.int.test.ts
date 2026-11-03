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
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, truncateAll } from './helpers.js';

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
