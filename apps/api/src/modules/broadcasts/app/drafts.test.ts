import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { createDrafts } from './drafts.js';
import {
  fakeAudienceTagRepo,
  fakeBroadcastRepo,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeContactsApi,
  fakeDraftView,
  fakeGroupRepo,
  fakeWorkspacesApi,
} from './fakes.js';

const T0 = new Date('2026-10-23T09:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const OPERATOR = newId();
const TEAMMATE = newId();
const OWNER = newId();
const VIP = newId();
const STAFF = newId();

function setup() {
  const store = fakeBroadcastStore();
  const clock = fixedClock(T0);
  const contacts = fakeContactsApi();
  contacts.tags.set(
    WS,
    new Map([
      [VIP, 'VIP'],
      [STAFF, 'Staff'],
    ]),
  );
  const workspaces = fakeWorkspacesApi();
  for (const a of [OPERATOR, TEAMMATE, OWNER]) workspaces.active.add(`${WS}:${a}`);
  const broadcasts = fakeBroadcastRepo(store);
  const groups = fakeGroupRepo(store);
  const drafts = createDrafts({
    transaction: fakeBroadcastTransaction(store),
    broadcasts,
    audienceTags: fakeAudienceTagRepo(store),
    groups,
    contacts,
    workspaces,
    signals: fakeBroadcastSignals(store),
    views: fakeDraftView(store),
    clock,
  });
  const create = (name = 'Spring prices', text?: string, actor = OPERATOR) =>
    drafts.createDraft(WS, actor, { name, ...(text !== undefined && { text }) });
  return { store, clock, contacts, workspaces, broadcasts, groups, drafts, create };
}

describe('createDraft (AC-01, AC-02, AC-10)', () => {
  it('starts a draft at version 1, tags "any" with no tag, the member as author and last changer', async () => {
    const h = setup();
    const draft = await h.create('  Spring   prices ', '  New prices from Monday.\n');
    expect(draft).toMatchObject({
      workspace_id: WS,
      status: 'draft',
      version: 1,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      author: { account_id: OPERATOR },
      last_changed_by: { account_id: OPERATOR },
      created_at: T0.toISOString(),
      audience: { kind: 'tags', mode: 'any', tags: [] },
    });
    expect(h.store.signals).toEqual([`draft:${WS}:${draft.id}`]);
  });

  it('starts with no text when none is given; needs no bot', async () => {
    const h = setup();
    expect((await h.create('Spring prices')).text).toBe('');
  });

  it.each([
    ['an empty name', '   '],
    ['an 81-character name', 'x'.repeat(81)],
  ])('refuses %s: BROADCAST_NAME_INVALID, nothing written', async (_n, name) => {
    const h = setup();
    await expect(h.create(name)).rejects.toMatchObject({
      code: 'BROADCAST_NAME_INVALID',
      statusCode: 400,
      details: { field: 'name', max_length: 80 },
    });
    expect(h.store.broadcasts).toEqual([]);
    expect(h.store.signals).toEqual([]);
  });

  it.each([
    ['only spaces', '   ', 0],
    ['4097 UTF-16 units', '😀'.repeat(2048) + 'x', 4097],
  ])('refuses a text of %s: BROADCAST_TEXT_INVALID', async (_n, text, length) => {
    const h = setup();
    await expect(h.create('Spring prices', text)).rejects.toMatchObject({
      code: 'BROADCAST_TEXT_INVALID',
      details: { field: 'text', max_length: 4096, length },
    });
    expect(h.store.broadcasts).toEqual([]);
  });
});

describe('saveFields (AC-02, AC-03, AC-09)', () => {
  it('writes at the shown version, raises the version and the last change, publishes draft', async () => {
    const h = setup();
    const d = await h.create();
    h.clock.advance(60_000);
    const saved = await h.drafts.saveFields(WS, TEAMMATE, d.id, {
      expected_version: 1,
      text: ' Prices go up. ',
    });
    expect(saved).toMatchObject({
      version: 2,
      text: 'Prices go up.',
      name: 'Spring prices',
      last_changed_by: { account_id: TEAMMATE },
      last_changed_at: new Date(T0.getTime() + 60_000).toISOString(),
    });
    expect(h.store.signals).toEqual([`draft:${WS}:${d.id}`, `draft:${WS}:${d.id}`]);
  });

  it("a save at an older version is BROADCAST_DRAFT_CHANGED with the teammate's draft; nothing written", async () => {
    const h = setup();
    const d = await h.create();
    await h.drafts.saveFields(WS, TEAMMATE, d.id, { expected_version: 1, text: 'Theirs' });
    await expect(
      h.drafts.saveFields(WS, OPERATOR, d.id, { expected_version: 1, text: 'Mine' }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      statusCode: 409,
      details: { draft: { id: d.id, version: 2, text: 'Theirs' } },
    });
    expect(h.store.broadcasts[0]!.text).toBe('Theirs');
    expect(h.store.signals).toHaveLength(2);
  });

  it('a group add between two saves keeps the version, so the second save is not stale', async () => {
    const h = setup();
    const d = await h.create();
    await h.drafts.saveAudience(WS, OPERATOR, d.id, { expected_version: 1, kind: 'group' });
    await h.groups.add(WS, d.id, newId(), TEAMMATE, T0);
    const saved = await h.drafts.saveFields(WS, OPERATOR, d.id, {
      expected_version: 2,
      name: 'Wholesale',
    });
    expect(saved.version).toBe(3);
  });

  it('an invalid name or text keeps the last valid content', async () => {
    const h = setup();
    const d = await h.create('Spring prices', 'Hello');
    await expect(
      h.drafts.saveFields(WS, OPERATOR, d.id, { expected_version: 1, name: '' }),
    ).rejects.toMatchObject({ code: 'BROADCAST_NAME_INVALID' });
    await expect(
      h.drafts.saveFields(WS, OPERATOR, d.id, { expected_version: 1, text: ' \n ' }),
    ).rejects.toMatchObject({ code: 'BROADCAST_TEXT_INVALID' });
    expect(h.store.broadcasts[0]).toMatchObject({
      name: 'Spring prices',
      text: 'Hello',
      version: 1,
    });
  });

  it('a launched broadcast is BROADCAST_NOT_A_DRAFT', async () => {
    const h = setup();
    const d = await h.create();
    h.store.broadcasts[0]!.status = 'sending';
    await expect(
      h.drafts.saveFields(WS, OPERATOR, d.id, { expected_version: 1, text: 'x' }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_NOT_A_DRAFT',
      details: { broadcast_id: d.id, status: 'sending' },
    });
  });

  it('an unknown or foreign id is not found, taking the broadcast row lock', async () => {
    const h = setup();
    const d = await h.create();
    await expect(
      h.drafts.saveFields(OTHER_WS, OPERATOR, d.id, { expected_version: 1, text: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(h.broadcasts.locks).toEqual([`broadcast:${d.id}`]);
  });
});

describe('saveAudience (AC-01, AC-03, AC-05)', () => {
  it('saves a tag audience with names at that moment, raising the version', async () => {
    const h = setup();
    const d = await h.create();
    const saved = await h.drafts.saveAudience(WS, OPERATOR, d.id, {
      expected_version: 1,
      kind: 'tags',
      mode: 'any',
      tag_ids: [VIP],
      exclude_tag_ids: [STAFF],
    });
    expect(saved.version).toBe(2);
    expect(saved.audience).toEqual({
      kind: 'tags',
      mode: 'any',
      tags: [
        { tag_id: VIP, name: 'VIP', kind: 'include' },
        { tag_id: STAFF, name: 'Staff', kind: 'exclude' },
      ],
      dropped_tags: [],
    });
    expect(h.store.signals).toHaveLength(2);
  });

  it('a tag that is not (or no longer) of the workspace is TAG_NOT_FOUND naming it; nothing saved', async () => {
    const h = setup();
    const d = await h.create();
    const gone = newId();
    await expect(
      h.drafts.saveAudience(WS, OPERATOR, d.id, {
        expected_version: 1,
        kind: 'tags',
        mode: 'all',
        tag_ids: [VIP, gone],
        exclude_tag_ids: [],
      }),
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND', details: { tag_id: gone } });
    expect(h.store.broadcasts[0]!.version).toBe(1);
    expect(h.store.tags).toEqual([]);
  });

  it('refuses a tag both chosen and left out, and "no tags" with tags (VALIDATION_ERROR)', async () => {
    const h = setup();
    const d = await h.create();
    await expect(
      h.drafts.saveAudience(WS, OPERATOR, d.id, {
        expected_version: 1,
        kind: 'tags',
        mode: 'any',
        tag_ids: [VIP],
        exclude_tag_ids: [VIP],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'exclude_tag_ids' } });
    await expect(
      h.drafts.saveAudience(WS, OPERATOR, d.id, {
        expected_version: 1,
        kind: 'tags',
        mode: 'none',
        tag_ids: [VIP],
        exclude_tag_ids: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'tag_ids' } });
  });

  it('switches to a group: tag rows dropped, version raised; again as a group it is unchanged', async () => {
    const h = setup();
    const d = await h.create();
    await h.drafts.saveAudience(WS, OPERATOR, d.id, {
      expected_version: 1,
      kind: 'tags',
      mode: 'any',
      tag_ids: [VIP],
      exclude_tag_ids: [],
    });
    const group = await h.drafts.saveAudience(WS, OPERATOR, d.id, {
      expected_version: 2,
      kind: 'group',
    });
    expect(group).toMatchObject({ version: 3, audience: { kind: 'group', size: 0 } });
    expect(h.store.tags).toEqual([]);
    expect(h.store.broadcasts[0]!.tagMode).toBeNull();
    const signals = h.store.signals.length;
    const again = await h.drafts.saveAudience(WS, OPERATOR, d.id, {
      expected_version: 3,
      kind: 'group',
    });
    expect(again.version).toBe(3);
    expect(h.store.signals).toHaveLength(signals);
  });

  it('a switch from a non-empty group carries its confirmed size; a different size is BROADCAST_GROUP_CHANGED', async () => {
    const h = setup();
    const d = await h.create();
    await h.drafts.saveAudience(WS, OPERATOR, d.id, { expected_version: 1, kind: 'group' });
    await h.groups.add(WS, d.id, newId(), OPERATOR, T0);
    await h.groups.add(WS, d.id, newId(), TEAMMATE, T0);
    const toTags = (expected_group_size?: number) =>
      h.drafts.saveAudience(WS, OPERATOR, d.id, {
        expected_version: 2,
        kind: 'tags',
        mode: 'any',
        tag_ids: [],
        exclude_tag_ids: [],
        ...(expected_group_size !== undefined && { expected_group_size }),
      });
    await expect(toTags(1)).rejects.toMatchObject({
      code: 'BROADCAST_GROUP_CHANGED',
      details: { group_size: 2 },
    });
    await expect(toTags()).rejects.toMatchObject({ code: 'BROADCAST_GROUP_CHANGED' });
    expect(h.store.group).toHaveLength(2);
    const saved = await toTags(2);
    expect(saved).toMatchObject({ version: 3, audience: { kind: 'tags', mode: 'any' } });
    expect(h.store.group).toEqual([]);
  });

  it('a stale audience save is BROADCAST_DRAFT_CHANGED', async () => {
    const h = setup();
    const d = await h.create();
    await h.drafts.saveFields(WS, TEAMMATE, d.id, { expected_version: 1, name: 'Theirs' });
    await expect(
      h.drafts.saveAudience(WS, OPERATOR, d.id, { expected_version: 1, kind: 'group' }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      details: { draft: { version: 2 } },
    });
  });
});

describe('deleteDraft (AC-07, AC-08, AC-09)', () => {
  it('the author deletes their draft with its tag and group rows; publishes deleted', async () => {
    const h = setup();
    const d = await h.create();
    await h.groups.add(WS, d.id, newId(), OPERATOR, T0);
    expect(await h.drafts.deleteDraft(WS, { accountId: OPERATOR, role: 'operator' }, d.id)).toEqual(
      { workspace_id: WS, broadcast_id: d.id },
    );
    expect(h.store.broadcasts).toEqual([]);
    expect(h.store.group).toEqual([]);
    expect(h.store.signals.at(-1)).toBe(`deleted:${WS}:${d.id}`);
  });

  it("an owner deletes a teammate's draft, locking the membership before the broadcast row", async () => {
    const h = setup();
    const d = await h.create();
    const order: string[] = [];
    h.workspaces.locks.push = (...x: string[]) => order.push(...x);
    h.broadcasts.locks.push = (...x: string[]) => order.push(...x);
    await h.drafts.deleteDraft(WS, { accountId: OWNER, role: 'owner' }, d.id);
    expect(order).toEqual([`members:${OWNER}`, `broadcast:${d.id}`]);
    expect(h.store.broadcasts).toEqual([]);
  });

  it("an operator deleting a teammate's draft is FORBIDDEN; nothing deleted", async () => {
    const h = setup();
    const d = await h.create();
    await expect(
      h.drafts.deleteDraft(WS, { accountId: TEAMMATE, role: 'operator' }, d.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(h.store.broadcasts).toHaveLength(1);
    expect(h.store.signals).toHaveLength(1);
  });

  it('AC-08: a member deactivated mid-request is ACCESS_REMOVED (openapi deleteBroadcast 403)', async () => {
    const h = setup();
    const d = await h.create();
    h.workspaces.active.delete(`${WS}:${OWNER}`);
    await expect(
      h.drafts.deleteDraft(WS, { accountId: OWNER, role: 'owner' }, d.id),
    ).rejects.toMatchObject({ code: 'ACCESS_REMOVED' });
    expect(h.store.broadcasts).toHaveLength(1);
  });

  it('a launched broadcast is BROADCAST_NOT_A_DRAFT; a foreign id is not found', async () => {
    const h = setup();
    const d = await h.create();
    h.store.broadcasts[0]!.status = 'sent';
    await expect(
      h.drafts.deleteDraft(WS, { accountId: OWNER, role: 'owner' }, d.id),
    ).rejects.toMatchObject({ code: 'BROADCAST_NOT_A_DRAFT' });
    // An active member of another workspace asking for this id there: not found.
    h.workspaces.active.add(`${OTHER_WS}:${OWNER}`);
    await expect(
      h.drafts.deleteDraft(OTHER_WS, { accountId: OWNER, role: 'owner' }, d.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
