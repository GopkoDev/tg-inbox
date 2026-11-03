import { BroadcastGroupPage } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import {
  fakeBotsApi,
  fakeBroadcastRepo,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeContactsApi,
  fakeDraftView,
  fakeGroupRepo,
  fakeWorkspacesApi,
  type FakeContact,
} from './fakes.js';
import { createBroadcastGroup } from './group.js';
import type { BroadcastRecord } from './ports.js';

const T0 = new Date('2026-10-23T09:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const OPERATOR = newId();
const TEAMMATE = newId();
const WHOLESALE = newId();
const BOT = 7001n;

function setup() {
  const store = fakeBroadcastStore();
  const clock = fixedClock(T0);
  const contacts = fakeContactsApi();
  contacts.tags.set(WS, new Map([[WHOLESALE, 'Wholesale']]));
  const workspaces = fakeWorkspacesApi();
  workspaces.names.set(`${WS}:${OPERATOR}`, 'Olha Operator');
  workspaces.names.set(`${WS}:${TEAMMATE}`, 'Taras Teammate');
  const bots = fakeBotsApi();
  bots.bots.set(WS, { state: 'connected', telegramBotId: BOT });
  const broadcasts = fakeBroadcastRepo(store);
  const groups = fakeGroupRepo(store);
  const group = createBroadcastGroup({
    transaction: fakeBroadcastTransaction(store),
    broadcasts,
    groups,
    contacts,
    bots,
    workspaces,
    signals: fakeBroadcastSignals(store),
    views: fakeDraftView(store),
    clock,
  });

  const contact = (o: Partial<FakeContact> = {}, ws = WS): FakeContact => {
    const c: FakeContact = { id: newId(), firstName: 'Test User', tagIds: [], ...o };
    contacts.contacts.set(ws, [...(contacts.contacts.get(ws) ?? []), c]);
    return c;
  };

  const draft = (o: Partial<BroadcastRecord> = {}) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Wholesale catch-up',
      text: 'Hello',
      status: 'draft',
      version: 4,
      audienceKind: 'group',
      tagMode: null,
      authorAccountId: OPERATOR,
      lastChangedByAccountId: OPERATOR,
      lastChangedAt: new Date('2026-10-22T09:00:00Z'),
      createdAt: new Date('2026-10-22T09:00:00Z'),
      launchedAt: null,
      launchedByAccountId: null,
      launchTelegramBotId: null,
      audienceSize: null,
      blockedCount: null,
      neverWroteCount: null,
      recipientCount: null,
      stoppedAt: null,
      stoppedByAccountId: null,
      endedAt: null,
      endReason: null,
      ...o,
    };
    store.broadcasts.push(row);
    return row;
  };

  const fill = (broadcastId: string, ids: string[], addedAt = T0) => {
    for (const contactId of ids) {
      store.group.push({
        workspaceId: WS,
        broadcastId,
        contactId,
        addedByAccountId: TEAMMATE,
        addedAt,
      });
    }
  };

  const sizeOf = (broadcastId: string) =>
    store.group.filter((g) => g.broadcastId === broadcastId).length;

  return { store, clock, contacts, bots, group, contact, draft, fill, sizeOf };
}

describe('addContact (AC-03, AC-04, AC-05, AC-08)', () => {
  it('adds one contact: the version stays, the last change is the caller, one group signal', async () => {
    const h = setup();
    const d = h.draft();
    const olena = h.contact({ firstName: 'Olena' });
    h.clock.advance(60_000);
    const got = await h.group.addContact(WS, TEAMMATE, d.id, olena.id);
    expect(got).toEqual({ broadcast_id: d.id, outcome: 'added', group_size: 1 });
    const row = h.store.broadcasts.find((b) => b.id === d.id)!;
    expect(row.version).toBe(4);
    expect(row.lastChangedByAccountId).toBe(TEAMMATE);
    expect(row.lastChangedAt).toEqual(new Date(T0.getTime() + 60_000));
    expect(h.store.group).toEqual([
      expect.objectContaining({ contactId: olena.id, addedByAccountId: TEAMMATE }),
    ]);
    expect(h.store.signals).toEqual([`group:${WS}:${d.id}`]);
  });

  it('a contact already in the group is not added twice and says so, with no signal', async () => {
    const h = setup();
    const d = h.draft();
    const olena = h.contact();
    h.fill(d.id, [olena.id]);
    expect(await h.group.addContact(WS, OPERATOR, d.id, olena.id)).toEqual({
      broadcast_id: d.id,
      outcome: 'unchanged',
      group_size: 1,
    });
    expect(h.store.signals).toEqual([]);
  });

  it('a full group (10 000) refuses the add with can_add 0', async () => {
    const h = setup();
    const d = h.draft();
    h.fill(
      d.id,
      Array.from({ length: 10_000 }, () => newId()),
    );
    const olena = h.contact();
    await expect(h.group.addContact(WS, OPERATOR, d.id, olena.id)).rejects.toMatchObject({
      code: 'BROADCAST_AUDIENCE_TOO_LARGE',
      details: { limit: 10_000, audience_size: 10_000, can_add: 0 },
    });
    expect(h.sizeOf(d.id)).toBe(10_000);
  });

  it('a launched broadcast refuses as not a draft', async () => {
    const h = setup();
    const d = h.draft({ status: 'sending' });
    const olena = h.contact();
    await expect(h.group.addContact(WS, OPERATOR, d.id, olena.id)).rejects.toMatchObject({
      code: 'BROADCAST_NOT_A_DRAFT',
      details: { broadcast_id: d.id, status: 'sending' },
    });
  });

  it('a draft switched to a tag audience meanwhile refuses as changed, with the current draft', async () => {
    const h = setup();
    const d = h.draft({ audienceKind: 'tags', tagMode: 'any' });
    const olena = h.contact();
    await expect(h.group.addContact(WS, OPERATOR, d.id, olena.id)).rejects.toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      details: { draft: { id: d.id, version: 4, audience: { kind: 'tags' } } },
    });
    expect(h.store.group).toEqual([]);
  });

  it('a contact of another workspace, or a broadcast of another workspace, is not found', async () => {
    const h = setup();
    const d = h.draft();
    const foreign = h.contact({}, OTHER_WS);
    await expect(h.group.addContact(WS, OPERATOR, d.id, foreign.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const foreignDraft = h.draft({ workspaceId: OTHER_WS });
    const olena = h.contact();
    await expect(h.group.addContact(WS, OPERATOR, foreignDraft.id, olena.id)).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(h.store.group).toEqual([]);
  });
});

describe('removeContact (AC-03, AC-04)', () => {
  it('removes one row: version kept, last change set, one group signal', async () => {
    const h = setup();
    const d = h.draft();
    const a = h.contact();
    const b = h.contact();
    h.fill(d.id, [a.id, b.id]);
    expect(await h.group.removeContact(WS, OPERATOR, d.id, a.id)).toEqual({
      broadcast_id: d.id,
      outcome: 'removed',
      group_size: 1,
    });
    expect(h.store.broadcasts[0]!.version).toBe(4);
    expect(h.store.signals).toEqual([`group:${WS}:${d.id}`]);
  });

  it('an absent row (never added, a foreign contact, a tag audience) answers unchanged with no signal', async () => {
    const h = setup();
    const d = h.draft();
    const tags = h.draft({ audienceKind: 'tags', tagMode: 'any' });
    const foreign = h.contact({}, OTHER_WS);
    expect(await h.group.removeContact(WS, OPERATOR, d.id, foreign.id)).toEqual({
      broadcast_id: d.id,
      outcome: 'unchanged',
      group_size: 0,
    });
    expect(await h.group.removeContact(WS, OPERATOR, tags.id, newId())).toMatchObject({
      outcome: 'unchanged',
      group_size: 0,
    });
    expect(h.store.signals).toEqual([]);
  });

  it('a launched broadcast refuses as not a draft', async () => {
    const h = setup();
    const d = h.draft({ status: 'sent' });
    await expect(h.group.removeContact(WS, OPERATOR, d.id, newId())).rejects.toMatchObject({
      code: 'BROADCAST_NOT_A_DRAFT',
    });
  });
});

describe('countMatching and addMatching (AC-04, AC-05)', () => {
  /** "Wholesale" with "kyiv": 14 contacts, one of them already in the group. */
  function wholesaleKyiv(h: ReturnType<typeof setup>) {
    const d = h.draft();
    const matching = Array.from({ length: 14 }, (_, i) =>
      h.contact({ firstName: `Kyiv ${i}`, tagIds: [WHOLESALE] }),
    );
    h.contact({ firstName: 'Lviv', tagIds: [WHOLESALE] });
    h.contact({ firstName: 'Kyiv retail' });
    h.fill(d.id, [matching[0]!.id]);
    return { d, matching };
  }

  it('counts the matches, those already in the group and how many can still be added; writes nothing', async () => {
    const h = setup();
    const { d } = wholesaleKyiv(h);
    const missing = newId();
    expect(
      await h.group.countMatching(WS, d.id, {
        q: 'kyiv',
        mode: 'any',
        tagIds: [WHOLESALE, missing],
      }),
    ).toEqual({
      broadcast_id: d.id,
      matching_count: 14,
      already_in_group_count: 1,
      to_add_count: 13,
      can_add: 9_999,
      missing_tag_ids: [missing],
    });
    expect(h.store.signals).toEqual([]);
    expect(h.sizeOf(d.id)).toBe(1);
  });

  it('"no tags" with a tag is a validation error', async () => {
    const h = setup();
    const d = h.draft();
    await expect(
      h.group.countMatching(WS, d.id, { mode: 'none', tagIds: [WHOLESALE] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      h.group.addMatching(WS, OPERATOR, d.id, {
        mode: 'none',
        tag_ids: [WHOLESALE],
        expected_count: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('adds the 13 not already in the group: size 14, version kept, one signal', async () => {
    const h = setup();
    const { d } = wholesaleKyiv(h);
    expect(
      await h.group.addMatching(WS, OPERATOR, d.id, {
        q: 'kyiv',
        mode: 'any',
        tag_ids: [WHOLESALE],
        expected_count: 13,
      }),
    ).toEqual({ broadcast_id: d.id, expected_count: 13, added_count: 13, group_size: 14 });
    expect(h.store.broadcasts[0]!.version).toBe(4);
    expect(h.store.broadcasts[0]!.lastChangedByAccountId).toBe(OPERATOR);
    expect(h.store.signals).toEqual([`group:${WS}:${d.id}`]);
  });

  it('the matches changed between the count and the confirmation: the current ones are added', async () => {
    const h = setup();
    const { d } = wholesaleKyiv(h);
    h.contact({ firstName: 'Kyiv new', tagIds: [WHOLESALE] });
    expect(
      await h.group.addMatching(WS, OPERATOR, d.id, {
        q: 'kyiv',
        mode: 'any',
        tag_ids: [WHOLESALE],
        expected_count: 13,
      }),
    ).toMatchObject({ expected_count: 13, added_count: 14, group_size: 15 });
  });

  it('nothing to add answers 0 with no signal', async () => {
    const h = setup();
    const d = h.draft();
    expect(
      await h.group.addMatching(WS, OPERATOR, d.id, {
        q: 'nobody',
        mode: 'any',
        tag_ids: [],
        expected_count: 0,
      }),
    ).toMatchObject({ added_count: 0, group_size: 0 });
    expect(h.store.signals).toEqual([]);
  });

  it('9 990 in the group and 50 more matching: refused as a whole, 10 can still be added', async () => {
    const h = setup();
    const d = h.draft();
    h.fill(
      d.id,
      Array.from({ length: 9_990 }, () => newId()),
    );
    for (let i = 0; i < 50; i += 1) h.contact({ tagIds: [WHOLESALE] });
    await expect(
      h.group.addMatching(WS, OPERATOR, d.id, {
        mode: 'any',
        tag_ids: [WHOLESALE],
        expected_count: 50,
      }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_AUDIENCE_TOO_LARGE',
      details: { limit: 10_000, audience_size: 9_990, can_add: 10 },
    });
    expect(h.sizeOf(d.id)).toBe(9_990);
    expect(h.store.signals).toEqual([]);
  });

  it('refuses a launched broadcast and a draft switched to tags', async () => {
    const h = setup();
    const launched = h.draft({ status: 'sending' });
    const tags = h.draft({ audienceKind: 'tags', tagMode: 'any' });
    const body = { mode: 'any' as const, tag_ids: [], expected_count: 0 };
    await expect(h.group.addMatching(WS, OPERATOR, launched.id, body)).rejects.toMatchObject({
      code: 'BROADCAST_NOT_A_DRAFT',
    });
    await expect(h.group.addMatching(WS, OPERATOR, tags.id, body)).rejects.toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
    });
  });
});

describe('groupPage and membership (AC-04, AC-14)', () => {
  it('50 per page, newest added first, with tags, the blocked mark for the current bot, who added it and the size', async () => {
    const h = setup();
    const d = h.draft();
    const blockedAt = new Date('2026-10-20T11:00:00Z');
    const people = Array.from({ length: 60 }, (_, i) =>
      h.contact({
        firstName: `Person ${i}`,
        tagIds: i === 0 ? [WHOLESALE] : [],
        ...(i === 0 && { blocked: new Map([[BOT, blockedAt]]) }),
      }),
    );
    people.forEach((p, i) => h.fill(d.id, [p.id], new Date(T0.getTime() + i * 1000)));
    const first = await h.group.groupPage(WS, d.id);
    expect(BroadcastGroupPage.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      workspace_id: WS,
      broadcast_id: d.id,
      size: 60,
      has_prev: false,
      has_next: true,
    });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toEqual({
      contact: {
        id: people[59]!.id,
        first_name: 'Person 59',
        last_name: null,
        username: null,
        tags: [],
        blocked_since: null,
      },
      added_by: { account_id: TEAMMATE, display_name: 'Taras Teammate' },
      added_at: new Date(T0.getTime() + 59_000).toISOString(),
    });
    const second = await h.group.groupPage(WS, d.id, first.next_cursor!);
    expect(second.items.map((r) => r.contact.first_name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Person ${9 - i}`),
    );
    expect(second).toMatchObject({ has_prev: true, has_next: false, next_cursor: null });
    expect(second.items.at(-1)!.contact).toMatchObject({
      tags: [{ id: WHOLESALE, name: 'Wholesale' }],
      blocked_since: blockedAt.toISOString(),
    });
    await expect(h.group.groupPage(WS, d.id, 'garbage')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('a tag-audience draft answers an empty page of size 0; a foreign broadcast is not found', async () => {
    const h = setup();
    const tags = h.draft({ audienceKind: 'tags', tagMode: 'any' });
    expect(await h.group.groupPage(WS, tags.id)).toEqual({
      workspace_id: WS,
      broadcast_id: tags.id,
      size: 0,
      items: [],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    const foreign = h.draft({ workspaceId: OTHER_WS });
    await expect(h.group.groupPage(WS, foreign.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.group.membership(WS, foreign.id, [newId()])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('membership answers only the asked ids that are in the group', async () => {
    const h = setup();
    const d = h.draft();
    const inGroup = h.contact();
    const outside = h.contact();
    h.fill(d.id, [inGroup.id]);
    expect(await h.group.membership(WS, d.id, [inGroup.id, outside.id, newId()])).toEqual({
      broadcast_id: d.id,
      contact_ids: [inGroup.id],
    });
  });
});
