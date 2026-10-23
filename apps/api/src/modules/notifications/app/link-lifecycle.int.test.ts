import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeps, type Deps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import {
  startRealtimeListener,
  type RealtimeListener,
  type RealtimeSignal,
} from '../../../platform/realtime.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { fakeBotToken, insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertConnectLink, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('link removal on deactivation and on a different bot (Postgres)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let listener: RealtimeListener;
  let got: RealtimeSignal[] = [];
  let nextUser = 61_000_000n;
  let nextBot = 610_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    deps = buildDeps(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot },
      { clock: fixedClock(NOW) },
    );
    listener = await startRealtimeListener(
      database.url,
      pino({ level: 'silent' }, new Writable({ write: (_c, _e, cb) => cb() })),
    );
    listener.onSignal((s) => got.push(s));
  });
  afterAll(async () => {
    await listener?.stop();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    fake.reset();
    got = [];
  });

  const db = () => deps.db;
  const linkOf = (id: string) =>
    db().selectFrom('telegram_links').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const linkSignals = async (workspaceId: string) => {
    await wait(300);
    return got
      .filter((s) => s.type === 'telegram_link.changed' && s.workspace_id === workspaceId)
      .map((s) => (s as { account_id: string }).account_id);
  };

  describe('deactivation', () => {
    async function member() {
      const workspaceId = await insertWorkspace(db(), 'Acme Flowers');
      const { id: membershipId, accountId } = await insertMembership(db(), workspaceId);
      return { workspaceId, membershipId, accountId };
    }

    it('removes the live link as deactivated, clears the id and name, replaces unused connect links, unassigns first (AC-10)', async () => {
      const m = await member();
      const link = await insertTelegramLink(db(), {
        workspaceId: m.workspaceId,
        accountId: m.accountId,
        telegramUserId: nextUser++,
        displayName: 'Zelda Quartz',
      });
      const unused = await insertConnectLink(db(), {
        workspaceId: m.workspaceId,
        accountId: m.accountId,
      });
      const used = await insertConnectLink(db(), {
        workspaceId: m.workspaceId,
        accountId: m.accountId,
        usedAt: NOW,
      });
      const conversationId = await insertConversation(db(), {
        workspaceId: m.workspaceId,
        contactId: await insertContact(db(), {
          workspaceId: m.workspaceId,
          telegramUserId: nextUser++,
        }),
        assigneeAccountId: m.accountId,
      });

      await deps.team.deactivateMembership(m.workspaceId, m.membershipId);

      expect(await linkOf(link.id)).toMatchObject({
        removed_reason: 'deactivated',
        telegram_user_id: null,
        display_name: null,
      });
      expect((await linkOf(link.id)).removed_at).not.toBeNull();
      const connectRows = await db()
        .selectFrom('connect_links')
        .select(['id', 'replaced_at'])
        .where('workspace_id', '=', m.workspaceId)
        .execute();
      expect(connectRows.find((r) => r.id === unused.id)!.replaced_at).not.toBeNull();
      expect(connectRows.find((r) => r.id === used.id)!.replaced_at).toBeNull();
      const conversation = await db()
        .selectFrom('conversations')
        .select('assignee_account_id')
        .where('id', '=', conversationId)
        .executeTakeFirstOrThrow();
      expect(conversation.assignee_account_id).toBeNull();
      expect(await linkSignals(m.workspaceId)).toEqual([m.accountId]);
    });

    it("keeps the same account's link in another workspace and a teammate's link here", async () => {
      const m = await member();
      const other = await insertWorkspace(db(), 'Other');
      await insertMembership(db(), other, { accountId: m.accountId });
      const here = await insertTelegramLink(db(), {
        workspaceId: m.workspaceId,
        accountId: m.accountId,
        telegramUserId: nextUser++,
      });
      const elsewhere = await insertTelegramLink(db(), {
        workspaceId: other,
        accountId: m.accountId,
        telegramUserId: nextUser++,
      });
      const mate = await insertMembership(db(), m.workspaceId);
      const mateLink = await insertTelegramLink(db(), {
        workspaceId: m.workspaceId,
        accountId: mate.accountId,
        telegramUserId: nextUser++,
      });
      await deps.team.deactivateMembership(m.workspaceId, m.membershipId);
      expect((await linkOf(here.id)).removed_at).not.toBeNull();
      expect((await linkOf(elsewhere.id)).removed_at).toBeNull();
      expect((await linkOf(mateLink.id)).removed_at).toBeNull();
    });

    it('reactivation restores nothing', async () => {
      const m = await member();
      const link = await insertTelegramLink(db(), {
        workspaceId: m.workspaceId,
        accountId: m.accountId,
        telegramUserId: nextUser++,
      });
      await deps.team.deactivateMembership(m.workspaceId, m.membershipId);
      await deps.team.reactivateMembership(m.workspaceId, m.membershipId);
      expect((await linkOf(link.id)).removed_reason).toBe('deactivated');
      const live = await db()
        .selectFrom('telegram_links')
        .select('id')
        .where('workspace_id', '=', m.workspaceId)
        .where('removed_at', 'is', null)
        .execute();
      expect(live).toEqual([]);
    });

    it('a member with no link: no error, no signal', async () => {
      const m = await member();
      await deps.team.deactivateMembership(m.workspaceId, m.membershipId);
      expect(await linkSignals(m.workspaceId)).toEqual([]);
    });
  });

  describe('a bot connected through pasteToken', () => {
    async function workspaceWithLinks(o: { botState?: 'connected' | null } = {}) {
      const workspaceId = await insertWorkspace(db(), 'Acme Flowers');
      const oldBot = nextBot++;
      const newBot = nextBot++;
      const inserted =
        o.botState === 'connected'
          ? await insertBot(db(), { workspaceId, telegramBotId: oldBot, state: 'connected' })
          : null;
      const a = await insertMembership(db(), workspaceId);
      const b = await insertMembership(db(), workspaceId);
      const linkA = await insertTelegramLink(db(), {
        workspaceId,
        accountId: a.accountId,
        telegramBotId: oldBot,
        telegramUserId: nextUser++,
      });
      const linkB = await insertTelegramLink(db(), {
        workspaceId,
        accountId: b.accountId,
        telegramBotId: oldBot,
        telegramUserId: nextUser++,
      });
      return { workspaceId, oldBot, newBot, inserted, a, b, linkA, linkB };
    }

    it('a different bot removes every live link of another bot id as bot_replaced, one signal per account, no answer', async () => {
      const w = await workspaceWithLinks();
      const token = fakeBotToken(w.newBot);
      fake.bot(token).script({});
      await deps.bots.paste.pasteToken(w.workspaceId, token, false);
      for (const link of [w.linkA, w.linkB]) {
        expect(await linkOf(link.id)).toMatchObject({
          removed_reason: 'bot_replaced',
          telegram_user_id: null,
          display_name: null,
        });
      }
      expect((await linkSignals(w.workspaceId)).sort()).toEqual(
        [w.a.accountId, w.b.accountId].sort(),
      );
    });

    it('a token rotation keeps every link', async () => {
      const w = await workspaceWithLinks({ botState: 'connected' });
      const token = fakeBotToken(w.oldBot);
      fake.bot(token).script({ webhookUrl: '' });
      await deps.bots.paste.pasteToken(w.workspaceId, token, false);
      expect((await linkOf(w.linkA.id)).removed_at).toBeNull();
      expect((await linkOf(w.linkB.id)).removed_at).toBeNull();
      expect(await linkSignals(w.workspaceId)).toEqual([]);
    });

    it('a refused connect (takeover not confirmed) removes nothing', async () => {
      const w = await workspaceWithLinks();
      const token = fakeBotToken(w.newBot);
      fake.bot(token).script({ webhookUrl: 'https://other-service.example.test/hook' });
      await expect(deps.bots.paste.pasteToken(w.workspaceId, token, false)).rejects.toThrow();
      expect((await linkOf(w.linkA.id)).removed_at).toBeNull();
      expect(await linkSignals(w.workspaceId)).toEqual([]);
    });

    it("does not touch another workspace's links", async () => {
      const w = await workspaceWithLinks();
      const other = await workspaceWithLinks();
      const token = fakeBotToken(w.newBot);
      fake.bot(token).script({});
      await deps.bots.paste.pasteToken(w.workspaceId, token, false);
      expect((await linkOf(other.linkA.id)).removed_at).toBeNull();
    });
  });
});
