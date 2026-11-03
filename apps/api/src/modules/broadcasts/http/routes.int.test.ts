import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Broadcast,
  BroadcastDeleted,
  BroadcastDraft,
  BroadcastGroupChange,
  BroadcastGroupMatching,
  BroadcastGroupMatchingAdded,
  BroadcastGroupMembership,
  BroadcastGroupPage,
  BroadcastLaunched,
  BroadcastList,
  BroadcastRecipientPage,
  BroadcastStopped,
  ErrorEnvelope,
  LaunchConfirmation,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { createBotRepo } from '../../bots/infra/bot-repo.js';
import { createTokenCipher } from '../../bots/infra/token-cipher.js';
import {
  insertBroadcast,
  insertGroupContact,
  launchBroadcastFixture,
  twoWorkspacesWithBroadcasts,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

describe('broadcasts routes through buildApp (postgres; AC-07, AC-08)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  const lines: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot, LOG_LEVEL: 'info' },
      { logStream },
    );
    db = createDb(database.url);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    lines.length = 0;
  });

  type Who = { accountId: string; cookies: { session: string } };
  const signIn = async (accountId: string): Promise<Who> => {
    const session = await insertSession(db, accountId, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    return { accountId, cookies: { session: session.token } };
  };

  /** Two workspaces (bot, VIP, two contacts, a draft "any of VIP" by the operator, a sending group broadcast). */
  async function world() {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    // The fixture's bots answer through the fake Bot API under their stored (decrypted) tokens.
    const tokens: Record<string, string> = {};
    for (const w of [a, b]) {
      const found = await createBotRepo(db, createTokenCipher(testBotKey)).findForCheck(
        w.workspaceId,
        w.botId,
      );
      tokens[w.workspaceId] = found!.token!;
      fake.bot(found!.token!).script({});
    }
    // Both contacts of A wrote to A's bot: reachable.
    for (const contactId of a.contactIds) {
      await insertReach(db, {
        workspaceId: a.workspaceId,
        contactId,
        telegramBotId: a.telegramBotId,
        wroteAt: new Date(Date.now() - 86_400_000),
      });
    }
    return {
      a,
      b,
      tokens,
      owner: await signIn(a.ownerAccountId),
      operator: await signIn(a.operatorAccountId),
    };
  }

  const base = (ws: string) => `/api/workspaces/${ws}/broadcasts`;
  const get = (who: Who | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const post = (who: Who | null, url: string, payload?: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, ...(payload && { payload }) });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const statusOf = async (id: string) =>
    (
      await db
        .selectFrom('broadcasts')
        .select(['status', 'version'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  describe('every operation answers its contract shape', () => {
    it('list, create, read, save the fields and the tag audience, duplicate and delete', async () => {
      const { a, operator } = await world();
      const w = base(a.workspaceId);

      const list = await get(operator, w);
      expect(list.statusCode).toBe(200);
      expect(
        BroadcastList.parse(list.json())
          .items.map((i) => i.id)
          .sort(),
      ).toEqual([a.draftId, a.launchedId].sort());

      const created = await post(operator, w, { name: 'Spring prices', text: 'New prices.' });
      expect(created.statusCode).toBe(201);
      const draft = BroadcastDraft.parse(created.json());
      expect(draft).toMatchObject({ name: 'Spring prices', version: 1, status: 'draft' });

      const read = await get(operator, `${w}/${draft.id}`);
      expect(read.statusCode).toBe(200);
      expect(Broadcast.parse(read.json()).id).toBe(draft.id);

      const saved = await post(operator, `${w}/${draft.id}/save`, {
        expected_version: 1,
        name: 'Spring prices 2',
      });
      expect(saved.statusCode).toBe(200);
      expect(BroadcastDraft.parse(saved.json())).toMatchObject({
        name: 'Spring prices 2',
        version: 2,
      });

      const audience = await post(operator, `${w}/${draft.id}/audience`, {
        expected_version: 2,
        kind: 'tags',
        mode: 'any',
        tag_ids: [a.tagId],
        exclude_tag_ids: [],
      });
      expect(audience.statusCode).toBe(200);
      const withTags = BroadcastDraft.parse(audience.json());
      expect(withTags.audience).toMatchObject({ kind: 'tags', mode: 'any' });
      // The breakdown is evaluated for the workspace's bot through the real contacts module.
      expect(withTags.breakdown).toEqual({
        audience_size: 1,
        reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 1 },
      });

      const copy = await post(operator, `${w}/${draft.id}/duplicate`, {
        audience: 'same',
        include_not_confirmed: false,
      });
      expect(copy.statusCode).toBe(201);
      expect(BroadcastDraft.parse(copy.json()).name).toBe('Copy of Spring prices 2');

      const deleted = await post(operator, `${w}/${draft.id}/delete`);
      expect(deleted.statusCode).toBe(200);
      expect(BroadcastDeleted.parse(deleted.json())).toEqual({
        workspace_id: a.workspaceId,
        broadcast_id: draft.id,
      });
      expect((await get(operator, `${w}/${draft.id}`)).statusCode).toBe(404);
    });

    it('the hand-picked group: switch, add, membership, matching, add matching, page, remove', async () => {
      const { a, operator } = await world();
      const w = base(a.workspaceId);
      const draft = BroadcastDraft.parse(
        (await post(operator, w, { name: 'Wholesale catch-up', text: 'Hi' })).json(),
      );
      const g = `${w}/${draft.id}`;
      const switched = BroadcastDraft.parse(
        (await post(operator, `${g}/audience`, { expected_version: 1, kind: 'group' })).json(),
      );
      expect(switched.audience).toEqual({ kind: 'group', size: 0 });

      const [first, second] = a.contactIds as [string, string];
      const added = await post(operator, `${g}/group/contacts`, { contact_id: first });
      expect(added.statusCode).toBe(200);
      expect(BroadcastGroupChange.parse(added.json())).toEqual({
        broadcast_id: draft.id,
        outcome: 'added',
        group_size: 1,
      });
      const again = BroadcastGroupChange.parse(
        (await post(operator, `${g}/group/contacts`, { contact_id: first })).json(),
      );
      expect(again.outcome).toBe('unchanged');

      const membership = await get(
        operator,
        `${g}/group/membership?contact=${first}&contact=${second}`,
      );
      expect(membership.statusCode).toBe(200);
      expect(BroadcastGroupMembership.parse(membership.json()).contact_ids).toEqual([first]);

      const matching = await get(operator, `${g}/group/matching`);
      expect(matching.statusCode).toBe(200);
      expect(BroadcastGroupMatching.parse(matching.json())).toMatchObject({
        matching_count: 2,
        already_in_group_count: 1,
        to_add_count: 1,
      });

      const all = await post(operator, `${g}/group/add-matching`, {
        mode: 'any',
        tag_ids: [],
        expected_count: 1,
      });
      expect(all.statusCode).toBe(200);
      expect(BroadcastGroupMatchingAdded.parse(all.json())).toMatchObject({
        added_count: 1,
        group_size: 2,
      });

      const page = await get(operator, `${g}/group`);
      expect(page.statusCode).toBe(200);
      expect(BroadcastGroupPage.parse(page.json()).size).toBe(2);

      const removed = await post(operator, `${g}/group/contacts/${second}/remove`);
      expect(removed.statusCode).toBe(200);
      expect(BroadcastGroupChange.parse(removed.json())).toMatchObject({
        outcome: 'removed',
        group_size: 1,
      });
    });

    it('an owner reads the confirmation, launches, and the chain sends it to the end; the report reads', async () => {
      const { a, owner, tokens } = await world();
      const w = base(a.workspaceId);
      const confirmation = await get(owner, `${w}/${a.draftId}/launch-confirmation`);
      expect(confirmation.statusCode).toBe(200);
      const c = LaunchConfirmation.parse(confirmation.json());
      expect(c.breakdown).toMatchObject({ recipient_count: 1 });

      const launched = await post(owner, `${w}/${a.draftId}/launch`, {
        expected_version: c.version,
        fingerprint: c.fingerprint,
      });
      expect(launched.statusCode).toBe(200);
      expect(BroadcastLaunched.parse(launched.json()).outcome).toBe('launched');

      // The queued link runs on this app's workers and delivers through the fake Bot API.
      await vi.waitFor(async () => expect(await statusOf(a.draftId)).toBe('sent'), {
        timeout: 15_000,
        interval: 250,
      });
      const sends = fake
        .calls(tokens[a.workspaceId])
        .filter((call) => call.method === 'sendMessage');
      // The chain serves every sending broadcast of the workspace: this launch's one recipient and
      // the fixture's sending broadcast with its two waiting recipients — each sent exactly once.
      expect(sends).toHaveLength(3);
      for (const send of sends) expect(send.params.text).toBe('Hello');
      await vi.waitFor(async () => expect(await statusOf(a.launchedId)).toBe('sent'), {
        timeout: 15_000,
        interval: 250,
      });

      const report = await get(owner, `${w}/${a.draftId}/recipients`);
      expect(report.statusCode).toBe(200);
      expect(BroadcastRecipientPage.parse(report.json()).items.map((r) => r.state)).toEqual([
        'delivered',
      ]);
      const delivered = await get(owner, `${w}/${a.draftId}/recipients?state=delivered`);
      expect(BroadcastRecipientPage.parse(delivered.json()).items).toHaveLength(1);
    }, 30_000);

    it('an owner stops a sending broadcast', async () => {
      const { a, owner } = await world();
      const res = await post(owner, `${base(a.workspaceId)}/${a.launchedId}/stop`);
      expect(res.statusCode).toBe(200);
      expect(BroadcastStopped.parse(res.json()).outcome).toBe('stopped');
      expect(await statusOf(a.launchedId)).toBe('stopped');
    });
  });

  describe('roles (AC-07)', () => {
    it('an operator gets 403 OWNER_ONLY on the launch confirmation, the launch and the stop; nothing changes', async () => {
      const { a, operator } = await world();
      const w = base(a.workspaceId);
      const attempts = [
        await get(operator, `${w}/${a.draftId}/launch-confirmation`),
        await post(operator, `${w}/${a.draftId}/launch`, {
          expected_version: 1,
          fingerprint: '0'.repeat(64),
        }),
        await post(operator, `${w}/${a.launchedId}/stop`),
      ];
      for (const res of attempts) {
        expect(res.statusCode).toBe(403);
        expect(errorOf(res).code).toBe('OWNER_ONLY');
      }
      expect(await statusOf(a.draftId)).toBe('draft');
      expect(await statusOf(a.launchedId)).toBe('sending');
      const links = await sql<{ n: number }>`
        select count(*)::int as n from pgboss.job
        where name = 'broadcasts.send' and data->>'workspace_id' = ${a.workspaceId}`.execute(db);
      expect(links.rows[0]!.n).toBe(0);
    });

    it("an operator cannot delete a teammate's draft (403 FORBIDDEN) but deletes their own", async () => {
      const { a, owner, operator } = await world();
      const w = base(a.workspaceId);
      const ownersDraft = BroadcastDraft.parse(
        (await post(owner, w, { name: 'Owner draft' })).json(),
      );
      const refused = await post(operator, `${w}/${ownersDraft.id}/delete`);
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).code).toBe('FORBIDDEN');
      expect(await statusOf(ownersDraft.id)).toBe('draft');
      expect((await post(operator, `${w}/${a.draftId}/delete`)).statusCode).toBe(200);
    });
  });

  describe('refusals through the real modules', () => {
    it('name, text, stale version, not a draft, gone tag, group changed and validation', async () => {
      const { a, operator } = await world();
      const w = base(a.workspaceId);
      const blank = await post(operator, w, { name: '   ' });
      expect(blank.statusCode).toBe(400);
      expect(errorOf(blank).code).toBe('BROADCAST_NAME_INVALID');

      const emptyText = await post(operator, `${w}/${a.draftId}/save`, {
        expected_version: 1,
        text: '  ',
      });
      expect(emptyText.statusCode).toBe(400);
      expect(errorOf(emptyText).code).toBe('BROADCAST_TEXT_INVALID');

      const stale = await post(operator, `${w}/${a.draftId}/save`, {
        expected_version: 7,
        name: 'Late',
      });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toMatchObject({ code: 'BROADCAST_DRAFT_CHANGED' });
      expect(BroadcastDraft.parse((errorOf(stale).details as { draft: unknown }).draft).id).toBe(
        a.draftId,
      );

      const launchedSave = await post(operator, `${w}/${a.launchedId}/save`, {
        expected_version: 1,
        name: 'Late',
      });
      expect(launchedSave.statusCode).toBe(409);
      expect(errorOf(launchedSave).code).toBe('BROADCAST_NOT_A_DRAFT');

      const goneTag = await post(operator, `${w}/${a.draftId}/audience`, {
        expected_version: 1,
        kind: 'tags',
        mode: 'any',
        tag_ids: [newId()],
        exclude_tag_ids: [],
      });
      expect(goneTag.statusCode).toBe(404);
      expect(errorOf(goneTag).code).toBe('TAG_NOT_FOUND');

      const group = BroadcastDraft.parse(
        (await post(operator, w, { name: 'Group', text: 'Hi' })).json(),
      );
      await post(operator, `${w}/${group.id}/audience`, { expected_version: 1, kind: 'group' });
      await post(operator, `${w}/${group.id}/group/contacts`, { contact_id: a.contactIds[0] });
      const switched = await post(operator, `${w}/${group.id}/audience`, {
        expected_version: 2,
        kind: 'tags',
        mode: 'any',
        tag_ids: [],
        exclude_tag_ids: [],
        expected_group_size: 0,
      });
      expect(switched.statusCode).toBe(409);
      expect(errorOf(switched)).toMatchObject({
        code: 'BROADCAST_GROUP_CHANGED',
        details: { group_size: 1 },
      });

      for (const res of [
        await post(operator, `${w}/${a.draftId}/save`, { expected_version: 'x' }),
        await get(operator, `${w}/${a.launchedId}/group/membership`),
        await get(
          operator,
          `${w}/${a.launchedId}/group/membership?${Array.from({ length: 51 }, () => `contact=${newId()}`).join('&')}`,
        ),
        await get(operator, `${w}/${a.launchedId}/recipients?state=lost`),
        await get(operator, `${w}/not-a-uuid`),
      ]) {
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_ERROR');
      }
    });

    it('duplicating "did not reach" of a broadcast still sending is 409 BROADCAST_NOT_ENDED', async () => {
      const { a, operator } = await world();
      const res = await post(operator, `${base(a.workspaceId)}/${a.launchedId}/duplicate`, {
        audience: 'not_reached',
        include_not_confirmed: false,
      });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe('BROADCAST_NOT_ENDED');
    });

    it('launch refusals: no working bot, no reachable contact, the daily cap with Retry-After, a changed audience', async () => {
      // No bot at all.
      const lone = await insertWorkspace(db, 'Lone Shop');
      const loneOwner = await insertMembership(db, lone, { role: 'owner' });
      const loneWho = await signIn(loneOwner.accountId);
      const loneDraft = await insertBroadcast(db, {
        workspaceId: lone,
        authorAccountId: loneOwner.accountId,
      });
      const noBot = await get(loneWho, `${base(lone)}/${loneDraft}/launch-confirmation`);
      expect(noBot.statusCode).toBe(409);
      expect(errorOf(noBot)).toMatchObject({
        code: 'BROADCAST_NEEDS_WORKING_BOT',
        details: { bot_state: 'not_connected' },
      });
      // A bot, but nobody wrote to it.
      await insertBot(db, { workspaceId: lone });
      await insertContact(db, { workspaceId: lone });
      const nobody = await get(loneWho, `${base(lone)}/${loneDraft}/launch-confirmation`);
      expect(nobody.statusCode).toBe(409);
      expect(errorOf(nobody).code).toBe('BROADCAST_NO_REACHABLE_CONTACT');

      const { a, owner } = await world();
      const w = base(a.workspaceId);
      const c = LaunchConfirmation.parse(
        (await get(owner, `${w}/${a.draftId}/launch-confirmation`)).json(),
      );
      const changed = await post(owner, `${w}/${a.draftId}/launch`, {
        expected_version: c.version,
        fingerprint: 'f'.repeat(64),
      });
      expect(changed.statusCode).toBe(409);
      expect(errorOf(changed).code).toBe('BROADCAST_AUDIENCE_CHANGED');
      expect(await statusOf(a.draftId)).toBe('draft');

      // Nine more launches in the last 24 h (the fixture's sending broadcast is the tenth).
      for (let i = 0; i < 9; i += 1) {
        const id = await insertBroadcast(db, {
          workspaceId: a.workspaceId,
          authorAccountId: a.ownerAccountId,
        });
        await launchBroadcastFixture(db, {
          broadcast: id,
          launchedByAccountId: a.ownerAccountId,
          telegramBotId: a.telegramBotId,
          recipients: [{ contactId: a.contactIds[1]!, state: 'delivered' }],
          launchedAt: new Date(Date.now() - 3_600_000),
        });
      }
      await db
        .updateTable('broadcasts')
        .set({ launched_at: new Date(Date.now() - 2 * 3_600_000) })
        .where('id', '=', a.launchedId)
        .execute();
      const capped = await get(owner, `${w}/${a.draftId}/launch-confirmation`);
      expect(capped.statusCode).toBe(429);
      expect(errorOf(capped).code).toBe('BROADCAST_LAUNCH_LIMIT_REACHED');
      expect(Number(capped.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('tenancy and the guard (AC-08)', () => {
    it("another workspace's broadcast or contact id is 404 with no hint, and nothing is written", async () => {
      const { a, b, operator } = await world();
      const w = base(a.workspaceId);
      for (const res of [
        await get(operator, `${w}/${b.draftId}`),
        await post(operator, `${w}/${b.draftId}/save`, { expected_version: 1, name: 'X' }),
        await get(operator, `${w}/${b.launchedId}/recipients`),
        await post(operator, `${w}/${b.launchedId}/duplicate`, {
          audience: 'all_recipients',
          include_not_confirmed: false,
        }),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('NOT_FOUND');
        expect(JSON.stringify(res.json())).not.toContain(b.workspaceId);
      }
      const group = BroadcastDraft.parse(
        (await post(operator, w, { name: 'Group', text: 'Hi' })).json(),
      );
      await post(operator, `${w}/${group.id}/audience`, { expected_version: 1, kind: 'group' });
      const foreign = await post(operator, `${w}/${group.id}/group/contacts`, {
        contact_id: b.contactIds[0],
      });
      expect(foreign.statusCode).toBe(404);
      expect(errorOf(foreign).code).toBe('NOT_FOUND');
      const rows = await db
        .selectFrom('broadcast_group_contacts')
        .select('contact_id')
        .where('broadcast_id', '=', group.id)
        .execute();
      expect(rows).toEqual([]);
    });

    it('every route: 401 signed out, 404 for an account of another workspace, 403 ACCESS_REMOVED when deactivated', async () => {
      const { a, b } = await world();
      const outsider = await signIn(b.ownerAccountId);
      const removedAccount = await insertAccount(db);
      await insertMembership(db, a.workspaceId, {
        accountId: removedAccount.id,
        role: 'owner',
        state: 'deactivated',
      });
      const removed = await signIn(removedAccount.id);
      const w = base(a.workspaceId);
      const d = `${w}/${a.draftId}`;
      const l = `${w}/${a.launchedId}`;
      const contact = a.contactIds[0]!;
      const routes: [string, string, object?][] = [
        ['GET', w],
        ['POST', w, { name: 'X' }],
        ['GET', d],
        ['POST', `${d}/save`, { expected_version: 1, name: 'X' }],
        ['POST', `${d}/audience`, { expected_version: 1, kind: 'group' }],
        ['GET', `${l}/group`],
        ['GET', `${l}/group/membership?contact=${contact}`],
        ['POST', `${d}/group/contacts`, { contact_id: contact }],
        ['POST', `${d}/group/contacts/${contact}/remove`],
        ['GET', `${d}/group/matching`],
        ['POST', `${d}/group/add-matching`, { mode: 'any', tag_ids: [], expected_count: 1 }],
        ['POST', `${d}/delete`],
        ['POST', `${d}/duplicate`, { audience: 'same', include_not_confirmed: false }],
        ['GET', `${d}/launch-confirmation`],
        ['POST', `${d}/launch`, { expected_version: 1, fingerprint: '0'.repeat(64) }],
        ['POST', `${l}/stop`],
        ['GET', `${l}/recipients`],
      ];
      expect(routes).toHaveLength(17);
      for (const [method, url, payload] of routes) {
        const send = (who: Who | null) =>
          app.inject({
            method: method as 'GET',
            url,
            cookies: who?.cookies,
            ...(payload && { payload }),
          });
        const signedOut = await send(null);
        expect(signedOut.statusCode, url).toBe(401);
        expect(errorOf(signedOut).code).toBe('UNAUTHENTICATED');
        const other = await send(outsider);
        expect(other.statusCode, url).toBe(404);
        expect(errorOf(other).code).toBe('NOT_FOUND');
        const gone = await send(removed);
        expect(gone.statusCode, url).toBe(403);
        expect(errorOf(gone).code).toBe('ACCESS_REMOVED');
      }
      expect(await statusOf(a.draftId)).toBe('draft');
      expect(await statusOf(a.launchedId)).toBe('sending');
    });
  });

  it("the group picker's search text is masked in the request log", async () => {
    const { a, operator } = await world();
    const contactId = await insertContact(db, { workspaceId: a.workspaceId, firstName: 'Olena' });
    await insertConversation(db, { workspaceId: a.workspaceId, contactId });
    const res = await get(
      operator,
      `${base(a.workspaceId)}/${a.draftId}/group/matching?q=Olena&mode=any`,
    );
    expect(res.statusCode).toBe(200);
    const requestLines = lines.filter((l) => l.includes('/group/matching'));
    expect(requestLines.length).toBeGreaterThan(0);
    for (const line of requestLines) {
      expect(line).toContain('q=[redacted]');
      expect(line).not.toContain('Olena');
    }
  });

  it('boots with the three broadcasts queues', async () => {
    const queues = await sql<{ name: string }>`
      select name from pgboss.queue where name like 'broadcasts.%' order by name`.execute(db);
    expect(queues.rows.map((q) => q.name)).toEqual([
      'broadcasts.measure-blocked-share',
      'broadcasts.send',
      'broadcasts.send-dlq',
    ]);
  });

  it('a group of another workspace never takes this workspace’s contact (both directions)', async () => {
    const { a, b } = await world();
    const bOwner = await signIn(b.ownerAccountId);
    const bDraft = BroadcastDraft.parse(
      (await post(bOwner, base(b.workspaceId), { name: 'B group', text: 'Hi' })).json(),
    );
    await post(bOwner, `${base(b.workspaceId)}/${bDraft.id}/audience`, {
      expected_version: 1,
      kind: 'group',
    });
    const res = await post(bOwner, `${base(b.workspaceId)}/${bDraft.id}/group/contacts`, {
      contact_id: a.contactIds[0],
    });
    expect(res.statusCode).toBe(404);
    // A's launched group broadcast keeps only A's contacts.
    await insertGroupContact(db, {
      workspaceId: b.workspaceId,
      broadcastId: bDraft.id,
      contactId: b.contactIds[0]!,
      addedByAccountId: b.ownerAccountId,
    });
    const page = BroadcastGroupPage.parse(
      (await get(bOwner, `${base(b.workspaceId)}/${bDraft.id}/group`)).json(),
    );
    expect(page.items.map((i) => i.contact.id)).toEqual([b.contactIds[0]]);
  });
});
