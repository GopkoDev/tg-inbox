import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DestinationCodeCreated,
  DestinationList,
  ErrorEnvelope,
  Post,
  PostAttention,
  PostList,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertSession } from '../../../test/fixtures/auth.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

describe('posts routes through buildApp (postgres; AC-03, AC-04, AC-05, AC-06, AC-18)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url));
    db = createDb(database.url);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; cookies: { session: string } };
  const signIn = async (accountId: string): Promise<Who> => {
    const session = await insertSession(db, accountId, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    return { accountId, cookies: { session: session.token } };
  };

  async function world() {
    const a = await insertWorkspace(db, 'Acme Flowers');
    const b = await insertWorkspace(db, 'Bolt Bikes');
    const owner = await signIn((await insertMembership(db, a, { role: 'owner' })).accountId);
    const operator = await signIn((await insertMembership(db, a, { role: 'operator' })).accountId);
    const other = await signIn((await insertMembership(db, a, { role: 'operator' })).accountId);
    const stranger = await signIn((await insertMembership(db, b, { role: 'owner' })).accountId);
    return { a, b, owner, operator, other, stranger };
  }

  const base = (ws: string) => `/api/workspaces/${ws}/posts`;
  const get = (who: Who | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const post = (who: Who | null, url: string, payload?: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload: payload ?? {} });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  it('signed-out 401, never-a-member 404 on every kind of route (AC-04)', async () => {
    const { a, stranger } = await world();
    expect((await get(null, base(a))).statusCode).toBe(401);
    const res = await get(stranger, base(a));
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
    expect((await get(stranger, `${base(a)}/destinations`)).statusCode).toBe(404);
    expect((await post(stranger, base(a), { text: 'x' })).statusCode).toBe(404);
  });

  it('reads: destinations, posts and attention answer their contract shape (AC-05)', async () => {
    const { a, operator } = await world();
    const dest = await get(operator, `${base(a)}/destinations`);
    expect(dest.statusCode).toBe(200);
    DestinationList.parse(dest.json());
    const list = await get(operator, base(a));
    expect(list.statusCode).toBe(200);
    expect(PostList.parse(list.json()).items).toEqual([]);
    const attention = await get(operator, `${base(a)}/attention`);
    expect(attention.statusCode).toBe(200);
    expect(PostAttention.parse(attention.json()).count).toBe(0);
  });

  it('an operator creates, reads, saves and duplicates a draft; a stale save is refused (AC-05, AC-06)', async () => {
    const { a, operator, other } = await world();
    const created = await post(operator, base(a), { text: 'Spring sale', silent: true });
    expect(created.statusCode).toBe(201);
    const draft = Post.parse(created.json());
    expect(draft.state).toBe('draft');
    expect(draft.silent).toBe(true);

    const read = await get(other, `${base(a)}/${draft.id}`);
    expect(read.statusCode).toBe(200);
    expect(Post.parse(read.json()).text).toBe('Spring sale');

    const saved = await post(other, `${base(a)}/${draft.id}/save`, {
      expected_version: draft.version,
      text: 'Spring sale!',
    });
    expect(saved.statusCode).toBe(200);

    const stale = await post(operator, `${base(a)}/${draft.id}/save`, {
      expected_version: draft.version,
      text: 'Overwrite',
    });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe('POST_DRAFT_CHANGED');

    const copy = await post(operator, `${base(a)}/${draft.id}/duplicate`);
    expect(copy.statusCode).toBe(201);
    expect(Post.parse(copy.json()).id).not.toBe(draft.id);
  });

  it('owner-only operations refuse an operator with OWNER_ONLY (AC-03)', async () => {
    const { a, operator } = await world();
    const draft = Post.parse((await post(operator, base(a), { text: 'Hi' })).json());
    const attempts: Array<[string, object]> = [
      [`${base(a)}/destinations/connect-codes`, {}],
      [`${base(a)}/destinations/${draft.id}/remove`, {}],
      [`${base(a)}/time-zone`, { time_zone: 'Europe/Kyiv' }],
      [`${base(a)}/${draft.id}/publish`, { expected_version: draft.version }],
      [
        `${base(a)}/${draft.id}/schedule`,
        {
          expected_version: draft.version,
          local_time: '2099-01-01T09:00',
          time_zone: 'Europe/Kyiv',
        },
      ],
      [`${base(a)}/${draft.id}/delete-from-telegram`, {}],
    ];
    for (const [url, payload] of attempts) {
      const res = await post(operator, url, payload);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('OWNER_ONLY');
    }
    const confirmation = await get(operator, `${base(a)}/${draft.id}/publish-confirmation`);
    expect(confirmation.statusCode).toBe(403);
    expect(errorOf(confirmation).code).toBe('OWNER_ONLY');
  });

  it('the owner creates a connect code and polls it (AC-03)', async () => {
    const { a, owner } = await world();
    await insertBot(db, { workspaceId: a });
    const created = await post(owner, `${base(a)}/destinations/connect-codes`);
    expect(created.statusCode).toBe(201);
    const code = DestinationCodeCreated.parse(created.json());
    const status = await get(owner, `${base(a)}/destinations/connect-codes/${code.id}`);
    expect(status.statusCode).toBe(200);
  });

  it('only the author or an owner deletes a draft (AC-18)', async () => {
    const { a, operator, other, owner } = await world();
    const draft = Post.parse((await post(operator, base(a), { text: 'Mine' })).json());
    const refused = await post(other, `${base(a)}/${draft.id}/delete`, {
      expected_version: draft.version,
    });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe('FORBIDDEN');
    const deleted = await post(owner, `${base(a)}/${draft.id}/delete`, {
      expected_version: draft.version,
    });
    expect(deleted.statusCode).toBe(200);
    expect((await get(owner, `${base(a)}/${draft.id}`)).statusCode).toBe(404);
  });

  it('a post of another workspace is 404 by its address (AC-04)', async () => {
    const { a, operator, stranger, b } = await world();
    const draft = Post.parse((await post(operator, base(a), { text: 'Mine' })).json());
    const res = await get(stranger, `${base(b)}/${draft.id}`);
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
  });
});
