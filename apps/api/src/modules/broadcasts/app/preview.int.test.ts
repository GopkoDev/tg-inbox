import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
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
} from '../../../test/fixtures/broadcasts.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { audienceFingerprint } from '../domain/audience.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createLaunchPreview, type LaunchPreview } from './preview.js';

const NOW = new Date('2026-10-23T12:00:00Z');
let nextTelegramUserId = 6_000_000_000;

describe('launch confirmation (Postgres; AC-05, AC-06, AC-09, AC-10)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let preview: LaunchPreview;
  let groups: ReturnType<typeof createGroupRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), { clock: fixedClock(NOW) });
    const { db } = deps;
    const audiences = createContactAudiences({
      audiences: createAudienceQuery(db),
      tags: createTagRepo(db),
    });
    groups = createGroupRepo(db);
    preview = createLaunchPreview({
      broadcasts: createBroadcastRepo(db),
      audienceTags: createAudienceTagRepo(db),
      groups,
      contacts: audiences,
      bots: createLaunchReadiness({ bots: createBotRepo(db, createTokenCipher(testBotKey)) }),
      clock: deps.clock,
    });
  }, 120_000);

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  async function workspace() {
    const { db } = deps;
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const { bot } = await insertBot(db, { workspaceId });
    return { workspaceId, ownerAccountId: owner.accountId, bot };
  }

  const ownerOf = (w: { ownerAccountId: string }) => ({
    accountId: w.ownerAccountId,
    role: 'owner' as const,
  });

  it('AC-06: "any of" VIP with Staff left out confirms 36 of 38 with the fingerprint of the sorted reachable ids', async () => {
    const { db } = deps;
    const w = await workspace();
    const tag = (name: string) =>
      insertTag(db, { workspaceId: w.workspaceId, createdByAccountId: w.ownerAccountId, name });
    const vip = await tag('VIP');
    const staff = await tag('Staff');
    const reachable: string[] = [];
    const contact = async (tagIds: string[], blocked = false) => {
      const id = await insertContact(db, { workspaceId: w.workspaceId });
      await insertReach(db, {
        workspaceId: w.workspaceId,
        contactId: id,
        telegramBotId: w.bot.telegramBotId,
        wroteAt: new Date('2026-10-01'),
        ...(blocked && { blockedAt: new Date('2026-10-20') }),
      });
      for (const tagId of tagIds) {
        await insertContactTag(db, {
          workspaceId: w.workspaceId,
          contactId: id,
          tagId,
          addedByAccountId: w.ownerAccountId,
          history: false,
        });
      }
      return id;
    };
    for (let i = 0; i < 38; i += 1) {
      const id = await contact([vip], i < 2);
      if (i >= 2) reachable.push(id);
    }
    await contact([vip, staff]);
    await contact([vip, staff]);
    await contact([staff]);
    const id = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [{ tagId: vip }, { tagId: staff, kind: 'exclude' }],
      },
    });
    expect(await preview.getLaunchConfirmation(w.workspaceId, ownerOf(w), id)).toEqual({
      broadcast_id: id,
      version: 1,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      breakdown: { audience_size: 38, blocked_count: 2, never_wrote_count: 0, recipient_count: 36 },
      fingerprint: audienceFingerprint(reachable),
    });
  });

  it('AC-09: 10 launches in 24 h, one of them stopped → 429 with next_launch_at = the 10th newest + 24 h', async () => {
    const { db } = deps;
    const w = await workspace();
    const contactId = await insertContact(db, {
      workspaceId: w.workspaceId,
      reachForBot: w.bot.telegramBotId,
    });
    const times = Array.from(
      { length: 10 },
      (_, i) => new Date(NOW.getTime() - (30 + i * 60) * 60_000),
    );
    for (const [i, launchedAt] of times.entries()) {
      const b = await insertBroadcast(db, {
        workspaceId: w.workspaceId,
        authorAccountId: w.ownerAccountId,
      });
      await launchBroadcastFixture(db, {
        broadcast: b,
        launchedByAccountId: w.ownerAccountId,
        telegramBotId: w.bot.telegramBotId,
        recipients: [{ contactId, state: i === 0 ? 'stopped' : 'delivered' }],
        launchedAt,
      });
      await endBroadcastFixture(db, {
        broadcast: b,
        status: i === 0 ? 'stopped' : 'sent',
        ...(i === 0 && { stoppedByAccountId: w.ownerAccountId }),
        endedAt: launchedAt,
      });
    }
    const id = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
      audience: { kind: 'tags', mode: 'any' },
    });
    const next = new Date(times[9]!.getTime() + 24 * 3_600_000);
    await expect(
      preview.getLaunchConfirmation(w.workspaceId, ownerOf(w), id),
    ).rejects.toMatchObject({
      code: 'BROADCAST_LAUNCH_LIMIT_REACHED',
      details: { next_launch_at: next.toISOString() },
    });
  });

  it('AC-05: a group of 10 001 is too large', async () => {
    const w = await workspace();
    const ids: string[] = [];
    for (let start = 0; start < 10_001; start += 2000) {
      const rows = Array.from({ length: Math.min(2000, 10_001 - start) }, () => ({
        id: newId(),
        workspace_id: w.workspaceId,
        telegram_user_id: String(nextTelegramUserId++),
        first_name: 'Bulk',
        last_name: null,
        username: null,
        language_code: 'en',
        profile_seen_at: NOW,
        created_at: NOW,
      }));
      await deps.db.insertInto('contacts').values(rows).execute();
      ids.push(...rows.map((r) => r.id));
    }
    const id = await insertBroadcast(deps.db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
      audience: { kind: 'group' },
    });
    await groups.addMany(w.workspaceId, id, ids, w.ownerAccountId, NOW);
    await expect(
      preview.getLaunchConfirmation(w.workspaceId, ownerOf(w), id),
    ).rejects.toMatchObject({
      code: 'BROADCAST_AUDIENCE_TOO_LARGE',
      details: { audience_size: 10_001, can_add: 0 },
    });
  }, 60_000);

  it('AC-09 / AC-10: everyone blocked or written only to an older bot → no reachable contact', async () => {
    const { db } = deps;
    const w = await workspace();
    const blocked = await insertContact(db, { workspaceId: w.workspaceId });
    await insertReach(db, {
      workspaceId: w.workspaceId,
      contactId: blocked,
      telegramBotId: w.bot.telegramBotId,
      wroteAt: new Date('2026-10-01'),
      blockedAt: new Date('2026-10-02'),
    });
    await insertContact(db, { workspaceId: w.workspaceId, reachForBot: 424242n });
    const id = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
      audience: { kind: 'tags', mode: 'any' },
    });
    await expect(
      preview.getLaunchConfirmation(w.workspaceId, ownerOf(w), id),
    ).rejects.toMatchObject({
      code: 'BROADCAST_NO_REACHABLE_CONTACT',
      details: {
        breakdown: { audience_size: 2, blocked_count: 1, never_wrote_count: 1, recipient_count: 0 },
      },
    });
    // A bot that needs its token refuses before the audience is looked at.
    await db.updateTable('bots').set({ state: 'needs_token' }).where('id', '=', w.bot.id).execute();
    await expect(
      preview.getLaunchConfirmation(w.workspaceId, ownerOf(w), id),
    ).rejects.toMatchObject({
      code: 'BROADCAST_NEEDS_WORKING_BOT',
      details: { bot_state: 'needs_token' },
    });
  });
});
