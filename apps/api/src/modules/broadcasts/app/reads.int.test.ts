import { Broadcast, BroadcastList, BroadcastRecipientPage } from '@tg/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { createLaunchReadiness } from '../../bots/app/launch-readiness.js';
import { createBotRepo } from '../../bots/infra/bot-repo.js';
import { createTokenCipher } from '../../bots/infra/token-cipher.js';
import { createContactAudiences } from '../../contacts/app/audiences.js';
import { createAudienceQuery } from '../../contacts/infra/audience-query.js';
import { createTagRepo } from '../../contacts/infra/tag-repo.js';
import { insertBot, testBotKey } from '../../../test/fixtures/bots.js';
import {
  endBroadcastFixture,
  insertBroadcast,
  launchBroadcastFixture,
  twoWorkspacesWithBroadcasts,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createRecipientRepo } from '../infra/recipient-repo.js';
import { createBroadcastReads, type BroadcastReads } from './reads.js';

describe('broadcast reads (Postgres; AC-01, AC-08, AC-11, AC-16)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let reads: BroadcastReads;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url));
    const { db } = deps;
    const tagRepo = createTagRepo(db);
    const audiences = createContactAudiences({ audiences: createAudienceQuery(db), tags: tagRepo });
    reads = createBroadcastReads({
      broadcasts: createBroadcastRepo(db),
      audienceTags: createAudienceTagRepo(db),
      groups: createGroupRepo(db),
      recipients: createRecipientRepo(db),
      contacts: {
        resolveTags: async (workspaceId, ids) =>
          (await deps.tagAdmin.listTags(workspaceId)).items
            .filter((t) => ids.includes(t.id))
            .map((t) => ({ id: t.id, name: t.name })),
        audienceBreakdown: audiences.audienceBreakdown,
        contactCards: audiences.contactCards,
      },
      bots: createLaunchReadiness({ bots: createBotRepo(db, createTokenCipher(testBotKey)) }),
      workspaces: { displayNames: deps.workspaceAccess.displayNames },
    });
  }, 120_000);

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  /** "Acme Flowers": VIP on 40 (2 blocked), Kyiv on 120, Staff on 3 (two also VIP); all wrote. */
  async function acmeFlowers() {
    const { db } = deps;
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const operator = await insertMembership(db, workspaceId, { role: 'operator' });
    const { bot } = await insertBot(db, { workspaceId });
    const tag = (name: string) =>
      insertTag(db, { workspaceId, createdByAccountId: owner.accountId, name });
    const vip = await tag('VIP');
    const kyiv = await tag('Kyiv');
    const staff = await tag('Staff');
    const wholesale = await tag('Wholesale');
    const contact = async (tagIds: string[], blocked = false) => {
      const id = await insertContact(db, { workspaceId, firstWroteAt: new Date('2026-10-01') });
      await insertReach(db, {
        workspaceId,
        contactId: id,
        telegramBotId: bot.telegramBotId,
        wroteAt: new Date('2026-10-01'),
        ...(blocked && { blockedAt: new Date('2026-10-20') }),
      });
      for (const tagId of tagIds) {
        await insertContactTag(db, {
          workspaceId,
          contactId: id,
          tagId,
          addedByAccountId: operator.accountId,
          history: false,
        });
      }
      return id;
    };
    for (let i = 0; i < 38; i += 1) await contact([vip], i < 2);
    await contact([vip, staff]);
    await contact([vip, staff]);
    await contact([staff]);
    for (let i = 0; i < 120; i += 1) await contact([kyiv]);
    return {
      workspaceId,
      ownerAccountId: owner.accountId,
      operatorAccountId: operator.accountId,
      bot,
      vip,
      staff,
      wholesale,
    };
  }

  it('AC-01: "any of" VIP with Staff left out matches 38, 2 blocked, 0 never wrote, 36 reachable', async () => {
    const w = await acmeFlowers();
    const id = await insertBroadcast(deps.db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.operatorAccountId,
      name: 'Spring prices',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [{ tagId: w.vip }, { tagId: w.staff, kind: 'exclude' }, { tagId: w.wholesale }],
      },
    });
    // A renamed tag keeps working under its new name; a deleted one is dropped by its stored name.
    await deps.db
      .updateTable('tags')
      .set({ name: 'VIP clients', name_key: 'vip clients' })
      .where('id', '=', w.vip)
      .execute();
    await deps.db.deleteFrom('tags').where('id', '=', w.wholesale).execute();

    const got = await reads.getBroadcast(w.workspaceId, id);
    expect(Broadcast.parse(got)).toEqual(got);
    expect(got).toMatchObject({
      status: 'draft',
      name: 'Spring prices',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [
          { tag_id: w.vip, name: 'VIP clients', kind: 'include' },
          { tag_id: w.staff, name: 'Staff', kind: 'exclude' },
        ],
        dropped_tags: [{ tag_id: w.wholesale, name: 'Wholesale', kind: 'include' }],
      },
      breakdown: {
        audience_size: 38,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
      },
    });

    const list = await reads.listBroadcasts(w.workspaceId);
    expect(BroadcastList.parse(list)).toEqual(list);
    expect(list.items).toEqual([
      expect.objectContaining({ id, status: 'draft', audience_kind: 'tags', audience_size: 38 }),
    ]);

    // With the bot row gone only the size is shown.
    await deps.db.deleteFrom('bots').where('id', '=', w.bot.id).execute();
    const noBot = await reads.getBroadcast(w.workspaceId, id);
    expect(noBot.status === 'draft' && noBot.breakdown).toEqual({ audience_size: 38, reach: null });
  });

  it('a launched broadcast: totals sum to recipient_count, the frozen breakdown, a deactivated launcher still named', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(deps.db);
    const { db } = deps;
    const extra = await insertContact(db, { workspaceId: a.workspaceId });
    const extra2 = await insertContact(db, { workspaceId: a.workspaceId });
    const id = await insertBroadcast(db, {
      workspaceId: a.workspaceId,
      authorAccountId: a.operatorAccountId,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      audience: { kind: 'tags', mode: 'all', tags: [{ tagId: a.tagId, tagName: 'VIP at launch' }] },
    });
    await launchBroadcastFixture(db, {
      broadcast: id,
      launchedByAccountId: a.ownerAccountId,
      telegramBotId: a.telegramBotId,
      breakdown: { blocked: 1, neverWrote: 2 },
      recipients: [
        { contactId: a.taggedContactId, state: 'delivered' },
        { contactId: a.otherContactId, state: 'failed', failureReason: 'telegram_error' },
        { contactId: extra, state: 'blocked' },
        { contactId: extra2, state: 'stopped' },
      ],
    });
    await endBroadcastFixture(db, {
      broadcast: id,
      status: 'stopped',
      stoppedByAccountId: a.ownerAccountId,
    });
    await db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date('2026-10-12') })
      .where('workspace_id', '=', a.workspaceId)
      .where('account_id', '=', a.ownerAccountId)
      .execute();

    const got = await reads.getBroadcast(a.workspaceId, id);
    expect(Broadcast.parse(got)).toEqual(got);
    if (got.status === 'draft') throw new Error('expected a launched broadcast');
    expect(got).toMatchObject({
      status: 'stopped',
      audience: { kind: 'tags', mode: 'all', tags: [{ tag_id: a.tagId, name: 'VIP at launch' }] },
      launched_by: { account_id: a.ownerAccountId, display_name: 'Test' },
      stopped_by: { account_id: a.ownerAccountId },
      launch_breakdown: {
        audience_size: 7,
        blocked_count: 1,
        never_wrote_count: 2,
        recipient_count: 4,
      },
      not_reached_count: 2,
    });
    expect(Object.values(got.totals).reduce((x, y) => x + y, 0)).toBe(
      got.launch_breakdown.recipient_count,
    );

    expect(await reads.itemDetails(a.workspaceId, [id])).toEqual([
      {
        broadcast_id: id,
        broadcast_name: 'Spring prices',
        text: 'New prices from Monday.',
        launched_by: { account_id: a.ownerAccountId, display_name: 'Test' },
      },
    ]);

    const page = await reads.listRecipients(a.workspaceId, id, {});
    expect(BroadcastRecipientPage.parse(page)).toEqual(page);
    expect(page.items.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(page.items.every((r) => r.contact.first_name === 'Test User')).toBe(true);
    const failed = await reads.listRecipients(a.workspaceId, id, { state: 'failed' });
    expect(failed.items).toEqual([
      expect.objectContaining({ state: 'failed', failure_reason: 'telegram_error' }),
    ]);
  });

  it('AC-08: a broadcast of another workspace is not found and lends nothing to the thread', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(deps.db);
    await expect(reads.getBroadcast(a.workspaceId, b.draftId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(reads.getBroadcast(a.workspaceId, b.launchedId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(reads.listRecipients(a.workspaceId, b.launchedId, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await reads.itemDetails(a.workspaceId, [b.launchedId])).toEqual([]);
    expect((await reads.listBroadcasts(a.workspaceId)).items.map((i) => i.id).sort()).toEqual(
      [a.draftId, a.launchedId].sort(),
    );
    // A draft's recipients are an empty page.
    expect((await reads.listRecipients(a.workspaceId, a.draftId, {})).items).toEqual([]);
  });
});
