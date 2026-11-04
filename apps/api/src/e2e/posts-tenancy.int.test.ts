import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DestinationCodeCreated, DestinationList, ErrorEnvelope, Post } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, truncateAll } from './helpers.js';

const CHANNEL_ID = -1009876543210;
const SECRET_TEXT = 'Confidential spring price list 4711';

/**
 * Posts tenancy and secrecy (AC-04, T28): every operation naming another workspace's post,
 * destination or connect code answers a bare 404 and writes nothing; no post text, code or chat
 * id reaches a log line; the integrity queries find nothing.
 */
describe('posts tenancy and secrecy (postgres + pg-boss + fake Bot API)', () => {
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
    logLines.length = 0;
  });

  type Person = { accountId: string; cookies: { session: string } };
  async function person(ws: string, role: 'owner' | 'operator'): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: `${role} person` });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, role });
    return { accountId: account.id, cookies: { session: session.token } };
  }
  async function workspace(name: string, chatMember = false) {
    const ws = await insertWorkspace(deps.db, name);
    const { bot, token, webhookSecret } = await insertBot(deps.db, {
      workspaceId: ws,
      lastCheckedAt: new Date(),
    });
    fake.bot(token).script({
      ...(chatMember && {
        chatMembers: {
          [String(CHANNEL_ID)]: { status: 'administrator', can_post_messages: true },
        },
      }),
    });
    return {
      ws,
      token,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, 'owner'),
      operator: await person(ws, 'operator'),
    };
  }

  const api = (ws: string, tail: string) => `/api/workspaces/${ws}/posts${tail}`;
  const call = (who: Person, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      cookies: who.cookies,
      ...(method === 'POST' && { payload: payload ?? {} }),
    });

  async function world() {
    const a = await workspace('Acme Flowers', true);
    const b = await workspace('Bolt Bikes');
    const code = DestinationCodeCreated.parse(
      (await call(a.owner, 'POST', api(a.ws, '/destinations/connect-codes'))).json(),
    );
    const delivered = await signedDelivery(
      app,
      a.hook,
      telegramUpdate({
        updateId: 1,
        messageId: 1,
        date: Math.floor(Date.now() / 1000),
        chatId: CHANNEL_ID,
        chatType: 'channel',
        text: code.code,
      }),
    );
    expect(delivered.statusCode).toBe(200);
    let destinationId = '';
    await vi.waitFor(async () => {
      const list = DestinationList.parse(
        (await call(a.owner, 'GET', api(a.ws, '/destinations'))).json(),
      );
      expect(list.items.length).toBe(1);
      destinationId = list.items[0]!.id;
    });
    const created = await call(a.operator, 'POST', api(a.ws, ''), {
      text: SECRET_TEXT,
      destination_id: destinationId,
    });
    const post = Post.parse(created.json());
    return { a, b, destinationId, post, code };
  }

  it('another workspace addressing a post, destination or code by id gets 404 and changes nothing (AC-04)', async () => {
    const { a, b, destinationId, post, code } = await world();
    const bolt = b.owner;
    const reach = (tail: string) => api(a.ws, tail);
    const attempts: Array<['GET' | 'POST', string, object?]> = [
      ['GET', reach(`/${post.id}`)],
      ['GET', reach(`/${post.id}/publish-confirmation`)],
      ['POST', reach(`/${post.id}/save`), { expected_version: post.version, text: 'Hijack' }],
      ['POST', reach(`/${post.id}/publish`), { expected_version: post.version }],
      [
        'POST',
        reach(`/${post.id}/schedule`),
        {
          expected_version: post.version,
          local_time: '2099-01-01T09:00',
          time_zone: 'Europe/Kyiv',
        },
      ],
      ['POST', reach(`/${post.id}/delete`)],
      ['POST', reach(`/${post.id}/duplicate`)],
      ['POST', reach(`/${destinationId}/remove`.replace('/', '/destinations/'))],
      ['GET', reach(`/destinations/connect-codes/${code.id}`)],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await call(bolt, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(ErrorEnvelope.parse(res.json()).error.code, url).toBe('NOT_FOUND');
    }
    // Through its own workspace's address the foreign ids are unknown, too.
    for (const [method, tail, payload] of [
      ['GET', `/${post.id}`],
      ['POST', `/${post.id}/save`, { expected_version: post.version, text: 'Hijack' }],
      ['POST', `/${post.id}/publish`, { expected_version: post.version }],
      ['POST', `/destinations/${destinationId}/remove`],
      ['GET', `/destinations/connect-codes/${code.id}`],
    ] as Array<['GET' | 'POST', string, object?]>) {
      const res = await call(bolt, method, api(b.ws, tail), payload);
      expect(res.statusCode, tail).toBe(404);
    }
    // Bolt cannot point its own draft at Acme's destination.
    const own = await call(b.operator, 'POST', api(b.ws, ''), {
      text: 'Ours',
      destination_id: destinationId,
    });
    expect(own.statusCode).toBeGreaterThanOrEqual(400);
    expect(own.statusCode).toBeLessThan(500);

    const after = Post.parse((await call(a.owner, 'GET', api(a.ws, `/${post.id}`))).json());
    expect(after.state).toBe('draft');
    expect(after.text).toBe(SECRET_TEXT);
    expect(after.version).toBe(post.version);
    expect(
      DestinationList.parse((await call(b.owner, 'GET', api(b.ws, '/destinations'))).json()).items,
    ).toEqual([]);
    expect(fake.calls(b.token).filter((c) => c.method === 'sendMessage')).toEqual([]);
  });

  it('no post text, code or chat id reaches a log line (AC-04)', async () => {
    const { a, post, code } = await world();
    await call(a.owner, 'POST', api(a.ws, `/${post.id}/publish`), {
      expected_version: post.version,
    });
    await vi.waitFor(async () =>
      expect(Post.parse((await call(a.owner, 'GET', api(a.ws, `/${post.id}`))).json()).state).toBe(
        'published',
      ),
    );
    const logged = logLines.join('\n');
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).not.toContain(code.code);
    expect(logged).not.toContain(String(CHANNEL_ID));
    expect(logged).not.toContain(a.token);
  });

  it('the posts.send job payload holds ids and the moment only (AC-04)', async () => {
    const { a, post } = await world();
    await call(a.owner, 'POST', api(a.ws, `/${post.id}/publish`), {
      expected_version: post.version,
    });
    const { sql } = await import('kysely');
    const jobs = await sql<{ data: Record<string, unknown> }>`
      select data from pgboss.job where name = 'posts.send'`.execute(deps.db);
    expect(jobs.rows.length).toBeGreaterThan(0);
    for (const row of jobs.rows) {
      expect(Object.keys(row.data).sort()).toEqual(['moment', 'post_id', 'workspace_id']);
    }
    expect(await integrityViolations(deps.db, [a.ws])).toEqual([]);
  });
});
