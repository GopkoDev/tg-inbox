import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
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
  insertGroupContact,
  launchBroadcastFixture,
  type FixtureRecipient,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createRecipientRepo } from '../infra/recipient-repo.js';
import { createBroadcastSignals } from '../infra/signals.js';
import { createDuplicate, type Duplicate } from './duplicate.js';
import { createBroadcastReads } from './reads.js';

const NOW = new Date('2026-10-23T09:00:00Z');

describe('duplicate (Postgres; AC-07, AC-13)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let duplicate: Duplicate;
  let groups: ReturnType<typeof createGroupRepo>;
  let broadcasts: ReturnType<typeof createBroadcastRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), { clock: fixedClock(NOW) });
    const { db } = deps;
    broadcasts = createBroadcastRepo(db);
    groups = createGroupRepo(db);
    const audienceTags = createAudienceTagRepo(db);
    const recipients = createRecipientRepo(db);
    const audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    const reads = createBroadcastReads({
      broadcasts,
      audienceTags,
      groups,
      recipients,
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
    duplicate = createDuplicate({
      transaction: (fn) => db.transaction().execute(fn),
      broadcasts,
      audienceTags,
      groups,
      recipients,
      signals: createBroadcastSignals(),
      views: reads,
      clock: deps.clock,
    });
  }, 120_000);

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  /**
   * AC-13: "Spring prices" sent to 36 — 33 delivered, 1 blocked (marked blocked for the bot),
   * 2 failed "the bot stopped working" — plus extra recipients in the given states.
   */
  async function ac13(
    extra: Array<FixtureRecipient['state']> = [],
    status: 'sent' | 'sending' = 'sent',
  ) {
    const { db } = deps;
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const operator = await insertMembership(db, workspaceId, { role: 'operator' });
    const { bot } = await insertBot(db, { workspaceId });
    const contacts: Array<{
      contactId: string;
      state: FixtureRecipient['state'];
      failureReason?: 'bot_stopped';
    }> = [];
    const states: Array<FixtureRecipient['state']> = [
      ...Array<FixtureRecipient['state']>(33).fill('delivered'),
      'blocked',
      'failed',
      'failed',
      ...extra,
    ];
    for (const state of states) {
      const contactId = await insertContact(db, { workspaceId, reachForBot: bot.telegramBotId });
      if (state === 'blocked') {
        await db
          .updateTable('contact_bot_reach')
          .set({ blocked_at: NOW, changed_at: NOW })
          .where('contact_id', '=', contactId)
          .execute();
      }
      contacts.push({
        contactId,
        state,
        ...(state === 'failed' && { failureReason: 'bot_stopped' as const }),
      });
    }
    const id = await insertBroadcast(db, {
      workspaceId,
      authorAccountId: owner.accountId,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      audience: { kind: 'group' },
    });
    await launchBroadcastFixture(db, {
      broadcast: id,
      launchedByAccountId: owner.accountId,
      telegramBotId: bot.telegramBotId,
      recipients: contacts,
    });
    if (status === 'sent') await endBroadcastFixture(db, { broadcast: id, status: 'sent' });
    const pick = (s: FixtureRecipient['state']) =>
      contacts.filter((c) => c.state === s).map((c) => c.contactId);
    return {
      workspaceId,
      ownerAccountId: owner.accountId,
      operatorAccountId: operator.accountId,
      bot,
      id,
      pick,
    };
  }

  it('"all recipients": a group of all 36, the blocked one counted unreachable; the operator authors it', async () => {
    const s = await ac13();
    const before = await broadcasts.find(s.workspaceId, s.id);
    const copy = await duplicate.duplicateBroadcast(s.workspaceId, s.operatorAccountId, s.id, {
      audience: 'all_recipients',
    });
    expect(copy).toMatchObject({
      status: 'draft',
      version: 1,
      name: 'Copy of Spring prices',
      text: 'New prices from Monday.',
      author: { account_id: s.operatorAccountId },
      audience: { kind: 'group', size: 36 },
      breakdown: {
        audience_size: 36,
        reach: { blocked_count: 1, never_wrote_count: 0, reachable_count: 35 },
      },
    });
    expect(await broadcasts.find(s.workspaceId, s.id)).toEqual(before);
  });

  it('"only recipients it did not reach": the 2 "bot stopped" failures, plus stopped, plus not confirmed only when asked', async () => {
    const plain = await ac13();
    const two = await duplicate.duplicateBroadcast(
      plain.workspaceId,
      plain.operatorAccountId,
      plain.id,
      {
        audience: 'not_reached',
      },
    );
    expect((await groups.ids(plain.workspaceId, two.id)).sort()).toEqual(
      plain.pick('failed').sort(),
    );

    const s = await ac13(['stopped', 'not_confirmed']);
    const without = await duplicate.duplicateBroadcast(s.workspaceId, s.ownerAccountId, s.id, {
      audience: 'not_reached',
    });
    expect((await groups.ids(s.workspaceId, without.id)).sort()).toEqual(
      [...s.pick('failed'), ...s.pick('stopped')].sort(),
    );
    const withNc = await duplicate.duplicateBroadcast(s.workspaceId, s.ownerAccountId, s.id, {
      audience: 'not_reached',
      include_not_confirmed: true,
    });
    expect((await groups.ids(s.workspaceId, withNc.id)).sort()).toEqual(
      [...s.pick('failed'), ...s.pick('stopped'), ...s.pick('not_confirmed')].sort(),
    );
  });

  it('"did not reach" while it still sends is not ended', async () => {
    const s = await ac13([], 'sending');
    await expect(
      duplicate.duplicateBroadcast(s.workspaceId, s.operatorAccountId, s.id, {
        audience: 'not_reached',
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_NOT_ENDED' });
  });

  it('a draft copy keeps its text and 14-contact group; a launched tag audience keeps its frozen tags; no bot or a needs-token bot is fine', async () => {
    const s = await ac13();
    const { db } = deps;
    const draft = await insertBroadcast(db, {
      workspaceId: s.workspaceId,
      authorAccountId: s.ownerAccountId,
      text: 'Draft text',
      audience: { kind: 'group' },
    });
    for (const contactId of s.pick('delivered').slice(0, 14)) {
      await insertGroupContact(db, {
        workspaceId: s.workspaceId,
        broadcastId: draft,
        contactId,
        addedByAccountId: s.ownerAccountId,
      });
    }
    await db.updateTable('bots').set({ state: 'needs_token' }).where('id', '=', s.bot.id).execute();
    const copy = await duplicate.duplicateBroadcast(s.workspaceId, s.operatorAccountId, draft, {
      audience: 'same',
    });
    expect(copy).toMatchObject({ text: 'Draft text', audience: { kind: 'group', size: 14 } });

    const vip = await insertTag(db, {
      workspaceId: s.workspaceId,
      createdByAccountId: s.ownerAccountId,
      name: 'VIP',
    });
    const tagged = await insertBroadcast(db, {
      workspaceId: s.workspaceId,
      authorAccountId: s.ownerAccountId,
      audience: { kind: 'tags', mode: 'all', tags: [{ tagId: vip, tagName: 'VIP at launch' }] },
    });
    const reached = await insertContact(db, { workspaceId: s.workspaceId });
    await launchBroadcastFixture(db, {
      broadcast: tagged,
      launchedByAccountId: s.ownerAccountId,
      telegramBotId: s.bot.telegramBotId,
      recipients: [{ contactId: reached, state: 'delivered' }],
    });
    await db.deleteFrom('bots').where('id', '=', s.bot.id).execute();
    const sameTags = await duplicate.duplicateBroadcast(
      s.workspaceId,
      s.operatorAccountId,
      tagged,
      { audience: 'same_tags' },
    );
    // The copy shows the tag under its current name, evaluated again (the frozen row is copied).
    expect(sameTags).toMatchObject({
      audience: { kind: 'tags', mode: 'all', tags: [{ tag_id: vip, name: 'VIP' }] },
      breakdown: { reach: null },
    });
    const rows = await db
      .selectFrom('broadcast_audience_tags')
      .select('tag_name')
      .where('broadcast_id', '=', sameTags.id)
      .execute();
    expect(rows).toEqual([{ tag_name: 'VIP at launch' }]);
  });

  it('a broadcast of another workspace is not found', async () => {
    const s = await ac13();
    const other = await ac13();
    await expect(
      duplicate.duplicateBroadcast(s.workspaceId, s.operatorAccountId, other.id, {
        audience: 'all_recipients',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
