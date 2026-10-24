import { Writable } from 'node:stream';
import type { Transaction } from 'kysely';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import type { DB } from '../../../platform/db.types.gen.js';
import {
  startRealtimeListener,
  type RealtimeListener,
  type RealtimeSignal,
} from '../../../platform/realtime.js';
import { createLaunchReadiness } from '../../bots/app/launch-readiness.js';
import { createBotRepo } from '../../bots/infra/bot-repo.js';
import { createTokenCipher } from '../../bots/infra/token-cipher.js';
import { createContactAudiences } from '../../contacts/app/audiences.js';
import { createAudienceQuery } from '../../contacts/infra/audience-query.js';
import { createTagRepo } from '../../contacts/infra/tag-repo.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import { insertBroadcast, launchBroadcastFixture } from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { audienceFingerprint } from '../domain/audience.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createRecipientRepo } from '../infra/recipient-repo.js';
import { createBroadcastSignals } from '../infra/signals.js';
import { createLaunchBroadcast, type LaunchBroadcast } from './launch.js';
import { createLaunchPreview, type LaunchPreview } from './preview.js';
import { createBroadcastReads } from './reads.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('launch transaction (Postgres; AC-06, AC-08, AC-09)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let listener: RealtimeListener;
  let got: RealtimeSignal[] = [];
  let preview: LaunchPreview;
  let launch: LaunchBroadcast;
  /** `broadcasts.send` links enqueued by launch transactions. */
  let links: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), { clock: fixedClock(NOW) });
    listener = await startRealtimeListener(
      database.url,
      pino({ level: 'silent' }, new Writable({ write: (_c, _e, cb) => cb() })),
    );
    listener.onSignal((s) => got.push(s));
    const { db } = deps;
    const broadcasts = createBroadcastRepo(db);
    const audienceTags = createAudienceTagRepo(db);
    const groups = createGroupRepo(db);
    const recipients = createRecipientRepo(db);
    const audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    const resolveTags = async (workspaceId: string, ids: readonly string[]) =>
      (await deps.tagAdmin.listTags(workspaceId)).items
        .filter((t) => ids.includes(t.id))
        .map((t) => ({ id: t.id, name: t.name }));
    const bots = createLaunchReadiness({ bots: createBotRepo(db, createTokenCipher(testBotKey)) });
    preview = createLaunchPreview({
      broadcasts,
      audienceTags,
      groups,
      contacts: audiences,
      bots,
      clock: deps.clock,
    });
    const reads = createBroadcastReads({
      broadcasts,
      audienceTags,
      groups,
      recipients,
      contacts: {
        resolveTags,
        audienceBreakdown: audiences.audienceBreakdown,
        contactCards: audiences.contactCards,
      },
      bots,
      workspaces: { displayNames: deps.workspaceAccess.displayNames },
    });
    launch = createLaunchBroadcast({
      transaction: (fn) => db.transaction().execute(fn),
      broadcasts,
      audienceTags,
      recipients,
      contacts: { resolveTags },
      workspaces: {
        lockActiveMembers: (tx, workspaceId, accountIds) =>
          deps.workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
      },
      preview,
      signals: createBroadcastSignals(),
      jobs: {
        // The pg-boss queue is wired by T24; this records each enqueue made in the transaction.
        async enqueueSendLink(_tx, workspaceId) {
          links.push(workspaceId);
        },
      },
      views: { broadcastView: reads.getBroadcast },
      drafts: reads,
      clock: deps.clock,
    });
  }, 120_000);

  afterAll(async () => {
    await listener?.stop();
    await deps?.destroy();
    await database?.stop();
  });

  beforeEach(() => {
    got = [];
    links = [];
  });

  const launched = (...args: Parameters<LaunchBroadcast['launchBroadcast']>) =>
    launch.launchBroadcast(...args);

  async function statusSignals(workspaceId: string) {
    await wait(300);
    return got.filter(
      (s) =>
        s.type === 'broadcast.changed' &&
        s.workspace_id === workspaceId &&
        (s as { change: string }).change === 'status',
    );
  }

  /** "Acme Flowers": an owner, a connected bot, VIP and Staff tags, `n` reachable VIP contacts. */
  async function acme(n: number) {
    const { db } = deps;
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const ownerM = await insertMembership(db, workspaceId, { role: 'owner' });
    const { bot } = await insertBot(db, { workspaceId });
    const tag = (name: string) =>
      insertTag(db, { workspaceId, createdByAccountId: ownerM.accountId, name });
    const vip = await tag('VIP');
    const staff = await tag('Staff');
    const contact = async (tagIds: string[], reach = true) => {
      const id = await insertContact(db, {
        workspaceId,
        ...(reach && { reachForBot: bot.telegramBotId }),
      });
      for (const tagId of tagIds) {
        await insertContactTag(db, {
          workspaceId,
          contactId: id,
          tagId,
          addedByAccountId: ownerM.accountId,
          history: false,
        });
      }
      return id;
    };
    const reachable: string[] = [];
    for (let i = 0; i < n; i += 1) reachable.push(await contact([vip]));
    await contact([vip], false);
    await contact([vip, staff]);
    const owner = { accountId: ownerM.accountId, role: 'owner' as const };
    const draft = (name = 'Spring prices') =>
      insertBroadcast(db, {
        workspaceId,
        authorAccountId: ownerM.accountId,
        name,
        text: 'New prices from Monday.',
        audience: {
          kind: 'tags',
          mode: 'any',
          tags: [{ tagId: vip }, { tagId: staff, kind: 'exclude' }],
        },
      });
    return {
      workspaceId,
      owner,
      ownerM,
      bot,
      vip,
      staff,
      contact,
      reachable: reachable.sort(),
      draft,
    };
  }

  async function confirmation(w: Awaited<ReturnType<typeof acme>>, id: string) {
    const c = await preview.getLaunchConfirmation(w.workspaceId, w.owner, id);
    return { expected_version: c.version, fingerprint: c.fingerprint };
  }

  async function recipientsOf(workspaceId: string, id: string) {
    return deps.db
      .selectFrom('broadcast_recipients')
      .select(['contact_id', 'position', 'state', 'telegram_user_id'])
      .where('workspace_id', '=', workspaceId)
      .where('broadcast_id', '=', id)
      .orderBy('position')
      .execute();
  }

  async function rowOf(workspaceId: string, id: string) {
    return deps.db
      .selectFrom('broadcasts')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  it('AC-06: a launch at the confirmed version and fingerprint freezes exactly the confirmed recipients, the text, tag names, bot and breakdown, queues one link and signals status once', async () => {
    const { db } = deps;
    const w = await acme(5);
    const id = await w.draft();
    const input = await confirmation(w, id);
    expect(input.fingerprint).toBe(audienceFingerprint(w.reachable));
    // A rename after the confirmation keeps the set: the launch freezes the new name.
    await db
      .updateTable('tags')
      .set({ name: 'VIP clients', name_key: 'vip clients' })
      .where('id', '=', w.vip)
      .execute();

    const result = await launched(w.workspaceId, w.owner, id, input);

    expect(result.outcome).toBe('launched');
    expect(result.broadcast).toMatchObject({
      id,
      status: 'sending',
      launched_by: { account_id: w.ownerM.accountId },
      launched_at: NOW.toISOString(),
      launch_breakdown: {
        audience_size: 6,
        blocked_count: 0,
        never_wrote_count: 1,
        recipient_count: 5,
      },
    });
    const contacts = await db
      .selectFrom('contacts')
      .select(['id', 'telegram_user_id'])
      .where('workspace_id', '=', w.workspaceId)
      .execute();
    const userIdOf = new Map(contacts.map((c) => [c.id, c.telegram_user_id]));
    expect(await recipientsOf(w.workspaceId, id)).toEqual(
      w.reachable.map((contactId, i) => ({
        contact_id: contactId,
        position: i + 1,
        state: 'waiting',
        telegram_user_id: userIdOf.get(contactId),
      })),
    );
    expect(await rowOf(w.workspaceId, id)).toMatchObject({
      status: 'sending',
      text: 'New prices from Monday.',
      launched_at: NOW,
      launched_by_account_id: w.ownerM.accountId,
      launch_telegram_bot_id: String(w.bot.telegramBotId),
      audience_size: 6,
      blocked_count: 0,
      never_wrote_count: 1,
      recipient_count: 5,
    });
    expect(
      await db
        .selectFrom('broadcast_audience_tags')
        .select(['tag_id', 'tag_name', 'kind'])
        .where('broadcast_id', '=', id)
        .orderBy('kind')
        .execute(),
    ).toEqual([
      { tag_id: w.staff, tag_name: 'Staff', kind: 'exclude' },
      { tag_id: w.vip, tag_name: 'VIP clients', kind: 'include' },
    ]);
    expect(links).toEqual([w.workspaceId]);
    expect(await statusSignals(w.workspaceId)).toEqual([
      {
        type: 'broadcast.changed',
        v: 1,
        workspace_id: w.workspaceId,
        broadcast_id: id,
        change: 'status',
      },
    ]);

    // AC-09: retags and new customers after the launch never change the recipient list.
    await w.contact([w.vip]);
    expect(await recipientsOf(w.workspaceId, id)).toHaveLength(5);
  });

  it('AC-06: two concurrent launches of one draft launch once — the other answers already_launched, one link', async () => {
    const w = await acme(3);
    const id = await w.draft();
    const input = await confirmation(w, id);
    const results = await Promise.all([
      launched(w.workspaceId, w.owner, id, input),
      launched(w.workspaceId, w.owner, id, input),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['already_launched', 'launched']);
    expect(results.every((r) => r.broadcast.status === 'sending')).toBe(true);
    expect(await recipientsOf(w.workspaceId, id)).toHaveLength(3);
    expect(links).toEqual([w.workspaceId]);
    expect(await statusSignals(w.workspaceId)).toHaveLength(1);
  });

  it('AC-09: two drafts racing for the 10th slot — the launch lock lets one through, the other is refused', async () => {
    const { db } = deps;
    const w = await acme(2);
    for (let i = 0; i < 9; i += 1) {
      const done = await w.draft(`Earlier ${i}`);
      await launchBroadcastFixture(db, {
        broadcast: done,
        launchedByAccountId: w.ownerM.accountId,
        telegramBotId: w.bot.telegramBotId,
        recipients: [{ contactId: w.reachable[0]! }],
        launchedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000),
      });
    }
    const first = await w.draft('First');
    const second = await w.draft('Second');
    const inputs = [await confirmation(w, first), await confirmation(w, second)];
    const settled = await Promise.allSettled([
      launched(w.workspaceId, w.owner, first, inputs[0]!),
      launched(w.workspaceId, w.owner, second, inputs[1]!),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const refused = settled.filter((s) => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'BROADCAST_LAUNCH_LIMIT_REACHED',
      statusCode: 429,
    });
    expect(links).toEqual([w.workspaceId]);
    const statuses = [await rowOf(w.workspaceId, first), await rowOf(w.workspaceId, second)]
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual(['draft', 'sending']);
  });

  it('AC-06: a retag between the confirmation and the launch with the same count is refused with the current confirmation', async () => {
    const { db } = deps;
    const w = await acme(3);
    const id = await w.draft();
    const input = await confirmation(w, id);
    // One VIP leaves the audience, another contact joins it: still 3 reachable.
    await db
      .deleteFrom('contact_tags')
      .where('workspace_id', '=', w.workspaceId)
      .where('contact_id', '=', w.reachable[0]!)
      .execute();
    const joined = await w.contact([w.vip]);
    const err = await launched(w.workspaceId, w.owner, id, input).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'BROADCAST_AUDIENCE_CHANGED',
      statusCode: 409,
      details: {
        confirmation: {
          broadcast_id: id,
          version: input.expected_version,
          breakdown: { recipient_count: 3 },
          fingerprint: audienceFingerprint([...w.reachable.slice(1), joined]),
        },
      },
    });
    expect((await rowOf(w.workspaceId, id)).status).toBe('draft');
    expect(await recipientsOf(w.workspaceId, id)).toEqual([]);
    expect(links).toEqual([]);
    expect(await statusSignals(w.workspaceId)).toEqual([]);
  });

  it('AC-06: a text saved since the confirmation is refused as BROADCAST_DRAFT_CHANGED with the current draft', async () => {
    const { db } = deps;
    const w = await acme(2);
    const id = await w.draft();
    const input = await confirmation(w, id);
    await db
      .updateTable('broadcasts')
      .set((eb) => ({ text: 'Prices change on Tuesday.', version: eb('version', '+', 1) }))
      .where('id', '=', id)
      .execute();
    const err = await launched(w.workspaceId, w.owner, id, input).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      statusCode: 409,
      details: { draft: { id, version: 2, text: 'Prices change on Tuesday.', status: 'draft' } },
    });
    expect((await rowOf(w.workspaceId, id)).status).toBe('draft');
    expect(links).toEqual([]);
  });

  it('AC-08: an owner deactivated in a racing transaction launches nothing', async () => {
    const { db } = deps;
    const w = await acme(2);
    const id = await w.draft();
    const input = await confirmation(w, id);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const deactivation = db.transaction().execute(async (tx) => {
      await tx
        .updateTable('memberships')
        .set({ state: 'deactivated', deactivated_at: NOW })
        .where('id', '=', w.ownerM.id)
        .execute();
      locked();
      await held;
    });
    await isLocked;
    const attempt = launched(w.workspaceId, w.owner, id, input).catch((e: unknown) => e);
    await wait(200);
    release();
    await deactivation;
    expect(await attempt).toMatchObject({ code: 'ACCESS_REMOVED', statusCode: 403 });
    expect((await rowOf(w.workspaceId, id)).status).toBe('draft');
    expect(await recipientsOf(w.workspaceId, id)).toEqual([]);
    expect(links).toEqual([]);
  });

  it('AC-08: a broadcast of another workspace is not found and nothing is launched', async () => {
    const a = await acme(2);
    const b = await acme(2);
    const id = await a.draft();
    const input = await confirmation(a, id);
    await expect(launched(b.workspaceId, b.owner, id, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await rowOf(a.workspaceId, id)).status).toBe('draft');
  });
});
