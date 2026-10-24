import { Writable } from 'node:stream';
import type { BroadcastDraft } from '@tg/shared';
import type { Transaction } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import type { DB } from '../../../platform/db.types.gen.js';
import {
  startRealtimeListener,
  type RealtimeListener,
  type RealtimeSignal,
} from '../../../platform/realtime.js';
import { insertGroupContact } from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { insertMembership } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createAudienceTagRepo } from '../infra/audience-tag-repo.js';
import { createBroadcastRepo } from '../infra/broadcast-repo.js';
import { createGroupRepo } from '../infra/group-repo.js';
import { createBroadcastSignals } from '../infra/signals.js';
import { createDrafts } from './drafts.js';
import type { DraftView } from './ports.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('draft use cases (Postgres; AC-01, AC-03, AC-07, AC-09)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let listener: RealtimeListener;
  let got: RealtimeSignal[] = [];
  let drafts: ReturnType<typeof createDrafts>;
  let groups: ReturnType<typeof createGroupRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), {
      clock: fixedClock(new Date('2026-10-23T09:00:00Z')),
    });
    listener = await startRealtimeListener(
      database.url,
      pino({ level: 'silent' }, new Writable({ write: (_c, _e, cb) => cb() })),
    );
    listener.onSignal((s) => got.push(s));
    const { db } = deps;
    const broadcasts = createBroadcastRepo(db);
    const audienceTags = createAudienceTagRepo(db);
    groups = createGroupRepo(db);
    // A stand-in for the reads' draft view (T17): the stored row and its audience.
    const views: DraftView = {
      async draftView(workspaceId, id) {
        const b = (await broadcasts.find(workspaceId, id))!;
        const tags = await audienceTags.list(workspaceId, id);
        return {
          id: b.id,
          version: b.version,
          name: b.name,
          text: b.text,
          audience:
            b.audienceKind === 'group'
              ? { kind: 'group', size: await groups.count(workspaceId, id) }
              : {
                  kind: 'tags',
                  mode: b.tagMode!,
                  tags: tags.map((t) => ({ tag_id: t.tagId, name: t.name, kind: t.kind })),
                  dropped_tags: [],
                },
        } as BroadcastDraft;
      },
    };
    drafts = createDrafts({
      transaction: (fn) => db.transaction().execute(fn),
      broadcasts,
      audienceTags,
      groups,
      contacts: {
        resolveTags: async (workspaceId, ids) =>
          (await deps.tagAdmin.listTags(workspaceId)).items
            .filter((t) => ids.includes(t.id))
            .map((t) => ({ id: t.id, name: t.name })),
      },
      workspaces: {
        lockActiveMembers: (tx, workspaceId, accountIds) =>
          deps.workspaceAccess.lockActiveMembers(tx as Transaction<DB>, workspaceId, accountIds),
      },
      signals: createBroadcastSignals(),
      views,
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
  });

  async function changesOf(workspaceId: string) {
    await wait(300);
    return got
      .filter((s) => s.type === 'broadcast.changed' && s.workspace_id === workspaceId)
      .map((s) => (s as { change: string }).change);
  }

  it("two members at one version: the second gets BROADCAST_DRAFT_CHANGED with the first's text", async () => {
    const { a } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, {
      name: 'Spring prices',
    });
    await drafts.saveFields(a.workspaceId, a.ownerAccountId, d.id, {
      expected_version: 1,
      text: 'Theirs',
    });
    await expect(
      drafts.saveFields(a.workspaceId, a.operatorAccountId, d.id, {
        expected_version: 1,
        text: 'Mine',
      }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      details: { draft: { id: d.id, version: 2, text: 'Theirs' } },
    });
    expect(await changesOf(a.workspaceId)).toEqual(['draft', 'draft']);
  });

  it('two concurrent saves at one version: one writes, the other is refused as changed', async () => {
    const { a } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, { name: 'Race' });
    const save = (text: string) =>
      drafts.saveFields(a.workspaceId, a.operatorAccountId, d.id, { expected_version: 1, text });
    const results = await Promise.allSettled([save('one'), save('two')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'BROADCAST_DRAFT_CHANGED' },
    });
  });

  it("a group add between two saves keeps the version, so the teammate's save is not stale", async () => {
    const { a } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, { name: 'Group' });
    await drafts.saveAudience(a.workspaceId, a.operatorAccountId, d.id, {
      expected_version: 1,
      kind: 'group',
    });
    await groups.add(a.workspaceId, d.id, a.taggedContactId, a.ownerAccountId, deps.clock.now());
    const saved = await drafts.saveFields(a.workspaceId, a.operatorAccountId, d.id, {
      expected_version: 2,
      name: 'Wholesale',
    });
    expect(saved.version).toBe(3);
  });

  it('saves a tag audience by id with names now; a foreign tag is TAG_NOT_FOUND', async () => {
    const { a, b } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, { name: 'Tags' });
    await expect(
      drafts.saveAudience(a.workspaceId, a.operatorAccountId, d.id, {
        expected_version: 1,
        kind: 'tags',
        mode: 'any',
        tag_ids: [b.tagId],
        exclude_tag_ids: [],
      }),
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND', details: { tag_id: b.tagId } });
    const saved = await drafts.saveAudience(a.workspaceId, a.operatorAccountId, d.id, {
      expected_version: 1,
      kind: 'tags',
      mode: 'all',
      tag_ids: [a.tagId],
      exclude_tag_ids: [],
    });
    expect(saved).toMatchObject({
      version: 2,
      audience: {
        kind: 'tags',
        mode: 'all',
        tags: [{ tag_id: a.tagId, name: 'VIP', kind: 'include' }],
      },
    });
  });

  it('a switch from a group carries its size, then drops the group rows', async () => {
    const { a } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, { name: 'Switch' });
    await drafts.saveAudience(a.workspaceId, a.operatorAccountId, d.id, {
      expected_version: 1,
      kind: 'group',
    });
    for (const contactId of [
      a.taggedContactId,
      await insertContact(deps.db, { workspaceId: a.workspaceId }),
    ]) {
      await insertGroupContact(deps.db, {
        workspaceId: a.workspaceId,
        broadcastId: d.id,
        contactId,
        addedByAccountId: a.operatorAccountId,
      });
    }
    const toTags = (expected_group_size: number) =>
      drafts.saveAudience(a.workspaceId, a.operatorAccountId, d.id, {
        expected_version: 2,
        kind: 'tags',
        mode: 'any',
        tag_ids: [],
        exclude_tag_ids: [],
        expected_group_size,
      });
    await expect(toTags(1)).rejects.toMatchObject({
      code: 'BROADCAST_GROUP_CHANGED',
      details: { group_size: 2 },
    });
    expect(await groups.count(a.workspaceId, d.id)).toBe(2);
    expect((await toTags(2)).audience).toMatchObject({ kind: 'tags', mode: 'any' });
    expect(await groups.count(a.workspaceId, d.id)).toBe(0);
  });

  it('delete: a deactivated owner and a non-author operator are refused; an active owner deletes', async () => {
    const { a } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(a.workspaceId, a.operatorAccountId, { name: 'Delete me' });
    const gone = await insertMembership(deps.db, a.workspaceId, {
      role: 'owner',
      state: 'deactivated',
    });
    const other = await insertMembership(deps.db, a.workspaceId, { role: 'operator' });
    await expect(
      drafts.deleteDraft(a.workspaceId, { accountId: gone.accountId, role: 'owner' }, d.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      drafts.deleteDraft(a.workspaceId, { accountId: other.accountId, role: 'operator' }, d.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    got = [];
    expect(
      await drafts.deleteDraft(a.workspaceId, { accountId: a.ownerAccountId, role: 'owner' }, d.id),
    ).toEqual({ workspace_id: a.workspaceId, broadcast_id: d.id });
    expect(await createBroadcastRepo(deps.db).find(a.workspaceId, d.id)).toBeNull();
    expect(await changesOf(a.workspaceId)).toEqual(['deleted']);
  });

  it('a broadcast of another workspace is not found', async () => {
    const { a, b } = await twoWorkspacesWithTags(deps.db);
    const d = await drafts.createDraft(b.workspaceId, b.operatorAccountId, { name: 'Theirs' });
    await expect(
      drafts.saveFields(a.workspaceId, a.operatorAccountId, d.id, {
        expected_version: 1,
        text: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      drafts.deleteDraft(a.workspaceId, { accountId: a.ownerAccountId, role: 'owner' }, d.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
