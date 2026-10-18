import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorEnvelope } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const MB = 1024 * 1024;
const expectedByte = (i: number) => (i * 31 + 7) & 0xff;

describe('inbox media route (postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    app = await buildApp({ ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await fake.reset();
  });

  type Who = { cookies: { session: string } };
  const member = async (
    workspaceId: string,
    state: 'active' | 'deactivated' = 'active',
  ): Promise<Who> => {
    const account = await insertAccount(db, {});
    const session = await insertSession(db, account.id, { createdAt: new Date() });
    await insertMembership(db, workspaceId, { accountId: account.id, state });
    return { cookies: { session: session.token } };
  };

  /** A workspace with a bot (scripted on the fake) and a conversation. */
  const seed = async (botState: 'connected' | 'needs_token' | 'disconnected' = 'connected') => {
    const ws = await insertWorkspace(db, `Acme ${newId()}`);
    const { token } = await insertBot(db, { workspaceId: ws, state: botState });
    fake.bot(token).script({});
    const me = await member(ws);
    const contact = await insertContact(db, { workspaceId: ws, firstName: 'Alice' });
    const conv = await insertConversation(db, { workspaceId: ws, contactId: contact });
    let n = 0n;
    const add = (kind: string, telegramMessage: Record<string, unknown>) =>
      insertMessage(db, {
        workspaceId: ws,
        conversationId: conv,
        telegramMessageId: ++n,
        kind,
        telegramMessage,
      });
    const url = (messageId: string, conversationId = conv, workspaceId = ws) =>
      `/api/workspaces/${workspaceId}/inbox/conversations/${conversationId}/messages/${messageId}/media`;
    const script = (
      files: Record<string, { path: string; size: number } | 'too_big' | 'not_found'>,
    ) => fake.bot(token).script({ files });
    return { ws, token, me, conv, add, url, script };
  };
  const get = (who: Who | null, url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies, headers });

  it('an automatic (background) media fetch does not extend the idle session; a foreground one does (W10)', async () => {
    const s = await seed();
    s.script({ p1: { path: 'photos/a.jpg', size: 1000 } });
    const msg = await s.add('photo', {
      photo: [{ file_id: 'p1', file_unique_id: 'u1', width: 1, height: 1, file_size: 1000 }],
    });
    const account = await insertAccount(db, {});
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const session = await insertSession(db, account.id, { createdAt: tenMinutesAgo });
    await insertMembership(db, s.ws, { accountId: account.id });
    const who = { cookies: { session: session.token } };
    const lastSeen = async () =>
      (
        await db
          .selectFrom('sessions')
          .select('last_seen_at')
          .where('id', '=', session.row.id)
          .executeTakeFirstOrThrow()
      ).last_seen_at.getTime();

    const background = await get(who, s.url(msg), { 'x-background-request': '1' });
    expect(background.statusCode).toBe(200);
    expect(await lastSeen()).toBe(tenMinutesAgo.getTime());
    expect((await get(who, s.url(msg))).statusCode).toBe(200);
    expect(await lastSeen()).toBeGreaterThan(tenMinutesAgo.getTime());
  });

  it('streams a photo inline as image/jpeg with the forced safe headers (AC-04)', async () => {
    const s = await seed();
    s.script({ p1: { path: 'photos/a.jpg', size: 1000 } });
    const id = await s.add('photo', {
      photo: [{ file_id: 'p1', file_size: 1000, width: 9, height: 9 }],
    });
    const res = await get(s.me, s.url(id));
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'content-disposition': 'inline',
      'content-length': '1000',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, no-store',
    });
    const bytes = res.rawPayload;
    expect(bytes.length).toBe(1000);
    expect(bytes[10]).toBe(expectedByte(10));
  });

  it('serves a document as an attachment with an RFC 5987 name, whatever type Telegram declared', async () => {
    const s = await seed();
    s.script({ d1: { path: 'documents/x', size: 50 } });
    const name = `we"ird <script>é.html`;
    const id = await s.add('document', {
      document: { file_id: 'd1', file_size: 50, file_name: name, mime_type: 'text/html' },
    });
    const res = await get(s.me, s.url(id));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''we%22ird%20%3Cscript%3E%C3%A9.html",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('picks audio and video types from the kind and keeps them inline', async () => {
    const s = await seed();
    s.script({ v1: { path: 'voice/a', size: 10 }, vid: { path: 'video/a', size: 10 } });
    const voice = await s.add('voice', {
      voice: { file_id: 'v1', file_size: 10, mime_type: 'audio/ogg' },
    });
    const video = await s.add('video', {
      video: { file_id: 'vid', file_size: 10, mime_type: 'text/html', file_name: 'c.mp4' },
    });
    const a = await get(s.me, s.url(voice));
    expect(a.headers['content-type']).toBe('audio/ogg');
    expect(a.headers['content-disposition']).toBe('inline');
    const b = await get(s.me, s.url(video));
    expect(b.headers['content-type']).toBe('video/mp4');
    expect(b.headers['content-disposition']).toBe('inline');
  });

  it('forwards a range as 206 with Content-Range', async () => {
    const s = await seed();
    s.script({ v1: { path: 'voice/a', size: 1000 } });
    const id = await s.add('voice', { voice: { file_id: 'v1', file_size: 1000 } });
    const res = await get(s.me, s.url(id), { range: 'bytes=100-199' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 100-199/1000');
    expect(res.headers['content-length']).toBe('100');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(res.rawPayload.length).toBe(100);
    expect(res.rawPayload[0]).toBe(expectedByte(100));
  });

  it('answers 416 with an empty body when the range cannot be satisfied', async () => {
    const s = await seed();
    s.script({ v1: { path: 'voice/a', size: 1000 } });
    const id = await s.add('voice', { voice: { file_id: 'v1', file_size: 1000 } });
    const res = await get(s.me, s.url(id), { range: 'bytes=5000-6000' });
    expect(res.statusCode).toBe(416);
    expect(res.body).toBe('');
  });

  it('rejects a malformed or oversized Range with 400', async () => {
    const s = await seed();
    s.script({ v1: { path: 'voice/a', size: 10 } });
    const id = await s.add('voice', { voice: { file_id: 'v1', file_size: 10 } });
    expect((await get(s.me, s.url(id), { range: 'items=1-2' })).statusCode).toBe(400);
    expect(
      (await get(s.me, s.url(id), { range: 'bytes=' + '1'.repeat(100) + '-' })).statusCode,
    ).toBe(400);
  });

  it.each([
    ['disconnected', 'bot_not_connected'],
    ['needs_token', 'bot_not_working'],
  ] as const)('a %s bot answers 409 %s (AC-05)', async (state, reason) => {
    const s = await seed(state);
    const id = await s.add('photo', { photo: [{ file_id: 'p1', file_size: 10 }] });
    const res = await get(s.me, s.url(id));
    expect(res.statusCode).toBe(409);
    expect(ErrorEnvelope.parse(res.json()).error).toMatchObject({
      code: 'MEDIA_UNAVAILABLE',
      details: { reason },
    });
  });

  it('answers 409 file_too_large from the captured size and from Telegram', async () => {
    const s = await seed();
    s.script({ big: 'too_big' });
    const captured = await s.add('document', {
      document: { file_id: 'x', file_size: 21 * MB, file_name: 'a.bin' },
    });
    const refused = await s.add('document', { document: { file_id: 'big', file_name: 'b.bin' } });
    for (const id of [captured, refused]) {
      const res = await get(s.me, s.url(id));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details).toEqual({ reason: 'file_too_large' });
    }
  });

  it('answers 409 file_gone when Telegram no longer has the file', async () => {
    const s = await seed();
    s.script({ gone: 'not_found' });
    const id = await s.add('photo', { photo: [{ file_id: 'gone', file_size: 10 }] });
    const res = await get(s.me, s.url(id));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toEqual({ reason: 'file_gone' });
  });

  it('answers 503 TELEGRAM_UNAVAILABLE when the Bot API does not respond', async () => {
    const down = await buildApp({
      ...testConfig(database.url),
      TELEGRAM_API_ROOT: 'http://127.0.0.1:9',
    });
    try {
      const s = await seed();
      const id = await s.add('photo', { photo: [{ file_id: 'p1', file_size: 10 }] });
      const res = await down.inject({ method: 'GET', url: s.url(id), cookies: s.me.cookies });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('TELEGRAM_UNAVAILABLE');
    } finally {
      await down.close();
    }
  });

  it('answers 404 for a kind with no file and for an unknown message', async () => {
    const s = await seed();
    const text = await s.add('text', { text: 'hi' });
    for (const id of [text, newId()]) {
      const res = await get(s.me, s.url(id));
      expect(res.statusCode).toBe(404);
      expect(ErrorEnvelope.parse(res.json()).error.code).toBe('NOT_FOUND');
    }
  });

  it("answers 404 for another workspace's message, identical to an unknown one", async () => {
    const a = await seed();
    const b = await seed();
    a.script({ p1: { path: 'photos/a.jpg', size: 10 } });
    const mine = await a.add('photo', { photo: [{ file_id: 'p1', file_size: 10 }] });
    const theirs = await b.add('photo', { photo: [{ file_id: 'p2', file_size: 10 }] });
    const foreign = await get(a.me, b.url(theirs, b.conv, a.ws)); // b's message through a's workspace
    const unknown = await get(a.me, a.url(newId()));
    const wrongConversation = await get(a.me, a.url(mine, newId()));
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(unknown.json());
    expect(wrongConversation.statusCode).toBe(404);
    // an account of another workspace gets no hint that the workspace exists
    const outsider = await get(b.me, a.url(mine));
    expect(outsider.statusCode).toBe(404);
  });

  it('refuses a deactivated member (403) and a signed-out caller (401) (AC-08)', async () => {
    const s = await seed();
    s.script({ p1: { path: 'photos/a.jpg', size: 10 } });
    const id = await s.add('photo', { photo: [{ file_id: 'p1', file_size: 10 }] });
    const gone = await member(s.ws, 'deactivated');
    const denied = await get(gone, s.url(id));
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ACCESS_REMOVED');
    expect((await get(null, s.url(id))).statusCode).toBe(401);
    expect(fake.calls(s.token).filter((c) => c.method === 'getFile')).toHaveLength(0);
  });

  it('never leaks the token or a Telegram address in headers or bodies', async () => {
    const s = await seed();
    s.script({ p1: { path: 'photos/a.jpg', size: 100 } });
    const ok = await s.add('photo', { photo: [{ file_id: 'p1', file_size: 100 }] });
    const big = await s.add('photo', { photo: [{ file_id: 'p9', file_size: 30 * MB }] });
    for (const id of [ok, big, newId()]) {
      const res = await get(s.me, s.url(id));
      const seen = JSON.stringify(res.headers) + res.body;
      expect(seen).not.toContain(s.token);
      expect(seen).not.toContain(fake.apiRoot);
      expect(seen).not.toMatch(/\/file\/bot|\/bot\d/);
      expect(seen).not.toContain('p1');
    }
  });

  it('opens a 5 MB file in under 3 s (spec §6)', async () => {
    const s = await seed();
    s.script({ f5: { path: 'documents/five', size: 5 * MB } });
    const id = await s.add('document', {
      document: { file_id: 'f5', file_size: 5 * MB, file_name: 'five.bin' },
    });
    const started = performance.now();
    const res = await get(s.me, s.url(id));
    expect(res.rawPayload.length).toBe(5 * MB);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
