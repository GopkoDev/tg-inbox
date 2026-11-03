import { Broadcast, BroadcastList, BroadcastRecipientPage, LaunchedBroadcast } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import type { RecipientState } from '../domain/recipient.js';
import {
  fakeAudienceTagRepo,
  fakeBotsApi,
  fakeBroadcastRepo,
  fakeBroadcastStore,
  fakeContactsApi,
  fakeGroupRepo,
  fakeRecipientRepo,
  fakeWorkspacesApi,
  type FakeContact,
} from './fakes.js';
import type { AudienceTagRow, BroadcastRecord } from './ports.js';
import { createBroadcastReads } from './reads.js';

const T0 = new Date('2026-10-23T09:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const WS = newId();
const OTHER_WS = newId();
const OPERATOR = newId();
const OWNER = newId();
const VIP = newId();
const KYIV = newId();
const STAFF = newId();
const GONE = newId();
const BOT = 7001n;

function setup() {
  const store = fakeBroadcastStore();
  const contacts = fakeContactsApi();
  contacts.tags.set(
    WS,
    new Map([
      [VIP, 'VIP clients'],
      [KYIV, 'Kyiv'],
      [STAFF, 'Staff'],
    ]),
  );
  const workspaces = fakeWorkspacesApi();
  workspaces.names.set(`${WS}:${OPERATOR}`, 'Olha Operator');
  workspaces.names.set(`${WS}:${OWNER}`, 'Bohdan Owner');
  workspaces.active.add(`${WS}:${OPERATOR}`);
  const bots = fakeBotsApi();
  bots.bots.set(WS, { state: 'connected', telegramBotId: BOT });
  const reads = createBroadcastReads({
    broadcasts: fakeBroadcastRepo(store),
    audienceTags: fakeAudienceTagRepo(store),
    groups: fakeGroupRepo(store),
    recipients: fakeRecipientRepo(store),
    contacts,
    bots,
    workspaces,
  });

  const contact = (o: Partial<FakeContact> = {}, ws = WS): FakeContact => {
    const c: FakeContact = {
      id: newId(),
      firstName: 'Test User',
      tagIds: [],
      wroteTo: [BOT],
      ...o,
    };
    contacts.contacts.set(ws, [...(contacts.contacts.get(ws) ?? []), c]);
    return c;
  };

  const draft = (o: Partial<BroadcastRecord> = {}, tags: AudienceTagRow[] = []) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      status: 'draft',
      version: 3,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: OPERATOR,
      lastChangedByAccountId: OPERATOR,
      lastChangedAt: at(0),
      createdAt: at(0),
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
    store.tags.push(
      ...tags.map((t) => ({ ...t, workspaceId: row.workspaceId, broadcastId: row.id })),
    );
    return row;
  };

  /** A launched broadcast with recipients 1…n in the given states (contacts created). */
  const launched = (
    states: Array<{ state: RecipientState; reason?: 'account_gone' | 'telegram_error' }>,
    o: Partial<BroadcastRecord> = {},
    tags: AudienceTagRow[] = [],
  ) => {
    const row = draft(
      {
        status: 'sending',
        launchedAt: at(5),
        launchedByAccountId: OWNER,
        launchTelegramBotId: BOT,
        audienceSize: states.length + 3,
        blockedCount: 2,
        neverWroteCount: 1,
        recipientCount: states.length,
        ...o,
      },
      tags,
    );
    states.forEach((st, i) => {
      const c = contact({ firstName: `Recipient ${i + 1}` });
      const done = st.state !== 'waiting' && st.state !== 'sending';
      store.recipients.push({
        workspaceId: row.workspaceId,
        id: newId(),
        broadcastId: row.id,
        contactId: c.id,
        position: i + 1,
        telegramUserId: BigInt(1000 + i),
        state: st.state,
        failureReason: st.state === 'failed' ? (st.reason ?? 'telegram_error') : null,
        claimedAt: st.state === 'sending' ? at(6) : null,
        outcomeAt: done ? at(7) : null,
        telegramMessageId: st.state === 'delivered' ? 1n : null,
      });
    });
    return row;
  };

  return { store, contacts, workspaces, bots, reads, contact, draft, launched };
}

/** AC-01: VIP on 40 (2 blocked), Kyiv on 120, Staff on 3 (two of them also VIP). */
function acmeFlowers(h: ReturnType<typeof setup>) {
  const blockedAt = at(-60);
  for (let i = 0; i < 38; i += 1) {
    h.contact({
      tagIds: [VIP],
      ...(i < 2 && { blocked: new Map([[BOT, blockedAt]]) }),
    });
  }
  h.contact({ tagIds: [VIP, STAFF] });
  h.contact({ tagIds: [VIP, STAFF] });
  h.contact({ tagIds: [STAFF] });
  for (let i = 0; i < 120; i += 1) h.contact({ tagIds: [KYIV] });
}

const vipNotStaff: AudienceTagRow[] = [
  { tagId: VIP, name: 'VIP', kind: 'include' },
  { tagId: STAFF, name: 'Staff', kind: 'exclude' },
];

describe('getBroadcast — a draft (AC-01, AC-10)', () => {
  it('"any of" VIP with Staff left out: 38 contacts, 2 blocked, 0 never wrote, 36 reachable', async () => {
    const h = setup();
    acmeFlowers(h);
    const d = h.draft({}, vipNotStaff);
    const got = await h.reads.getBroadcast(WS, d.id);
    expect(Broadcast.parse(got)).toEqual(got);
    expect(got).toMatchObject({
      id: d.id,
      workspace_id: WS,
      status: 'draft',
      version: 3,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      author: { account_id: OPERATOR, display_name: 'Olha Operator' },
      last_changed_by: { account_id: OPERATOR, display_name: 'Olha Operator' },
      last_changed_at: at(0).toISOString(),
      created_at: at(0).toISOString(),
      breakdown: {
        audience_size: 38,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
      },
    });
  });

  it('a renamed tag is shown and counted under its new name; a deleted one is dropped by its stored name', async () => {
    const h = setup();
    acmeFlowers(h);
    const d = h.draft({ tagMode: 'any' }, [
      { tagId: VIP, name: 'VIP', kind: 'include' },
      { tagId: GONE, name: 'Wholesale', kind: 'include' },
      { tagId: STAFF, name: 'Staff', kind: 'exclude' },
    ]);
    const got = await h.reads.getBroadcast(WS, d.id);
    expect(got.audience).toEqual({
      kind: 'tags',
      mode: 'any',
      tags: [
        { tag_id: VIP, name: 'VIP clients', kind: 'include' },
        { tag_id: STAFF, name: 'Staff', kind: 'exclude' },
      ],
      dropped_tags: [{ tag_id: GONE, name: 'Wholesale', kind: 'include' }],
    });
    expect(got.status === 'draft' && got.breakdown.audience_size).toBe(38);
  });

  it('with no bot row only the audience size is shown (reach: null)', async () => {
    const h = setup();
    acmeFlowers(h);
    h.bots.bots.delete(WS);
    const d = h.draft({}, vipNotStaff);
    const got = await h.reads.getBroadcast(WS, d.id);
    expect(got.status === 'draft' && got.breakdown).toEqual({ audience_size: 38, reach: null });
  });

  it.each(['needs_token', 'taken_over'] as const)(
    'a bot that is %s still has its Telegram bot id: the breakdown is computed against it',
    async (state) => {
      const h = setup();
      acmeFlowers(h);
      h.bots.bots.set(WS, { state, telegramBotId: BOT });
      const d = h.draft({}, vipNotStaff);
      const got = await h.reads.getBroadcast(WS, d.id);
      expect(got.status === 'draft' && got.breakdown.reach).toEqual({
        blocked_count: 2,
        never_wrote_count: 0,
        reachable_count: 36,
      });
    },
  );

  it('a contact that never wrote to the current bot is counted as never wrote', async () => {
    const h = setup();
    h.contact({ tagIds: [VIP], wroteTo: [9999n] });
    h.contact({ tagIds: [VIP] });
    const d = h.draft({}, [{ tagId: VIP, name: 'VIP', kind: 'include' }]);
    const got = await h.reads.getBroadcast(WS, d.id);
    expect(got.status === 'draft' && got.breakdown.reach).toEqual({
      blocked_count: 0,
      never_wrote_count: 1,
      reachable_count: 1,
    });
  });

  it('a group draft: its size and the breakdown of its contacts', async () => {
    const h = setup();
    const blocked = h.contact({ blocked: new Map([[BOT, at(-1)]]) });
    const ok = h.contact();
    h.contact(); // not in the group
    const d = h.draft({ audienceKind: 'group', tagMode: null });
    for (const c of [blocked, ok]) {
      h.store.group.push({
        workspaceId: WS,
        broadcastId: d.id,
        contactId: c.id,
        addedByAccountId: OPERATOR,
        addedAt: at(1),
      });
    }
    const got = await h.reads.getBroadcast(WS, d.id);
    expect(got).toMatchObject({
      audience: { kind: 'group', size: 2 },
      breakdown: {
        audience_size: 2,
        reach: { blocked_count: 1, never_wrote_count: 0, reachable_count: 1 },
      },
    });
  });

  it('draftView answers the same draft (the port the draft use cases read through)', async () => {
    const h = setup();
    acmeFlowers(h);
    const d = h.draft({}, vipNotStaff);
    expect(await h.reads.draftView(WS, d.id)).toEqual(await h.reads.getBroadcast(WS, d.id));
  });

  it('a broadcast id of another workspace, or an unknown one, is not found with no hint', async () => {
    const h = setup();
    const foreign = h.draft({ workspaceId: OTHER_WS });
    await expect(h.reads.getBroadcast(WS, foreign.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.reads.getBroadcast(WS, newId())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getBroadcast — a launched broadcast (AC-09, AC-11)', () => {
  it('the audience as defined at launch, who launched it, the frozen breakdown, totals and not reached', async () => {
    const h = setup();
    const b = h.launched(
      [
        { state: 'delivered' },
        { state: 'delivered' },
        { state: 'blocked' },
        { state: 'failed', reason: 'account_gone' },
        { state: 'failed', reason: 'telegram_error' },
        { state: 'not_confirmed' },
        { state: 'sending' },
        { state: 'waiting' },
      ],
      {},
      [
        { tagId: VIP, name: 'VIP', kind: 'include' },
        { tagId: GONE, name: 'Wholesale', kind: 'exclude' },
      ],
    );
    // Contacts changing after launch never recount a launched broadcast.
    h.contact({ tagIds: [VIP] });
    const got = await h.reads.getBroadcast(WS, b.id);
    expect(LaunchedBroadcast.parse(got)).toEqual(got);
    expect(got).toMatchObject({
      status: 'sending',
      text: 'New prices from Monday.',
      audience: {
        kind: 'tags',
        mode: 'any',
        tags: [
          { tag_id: VIP, name: 'VIP', kind: 'include' },
          { tag_id: GONE, name: 'Wholesale', kind: 'exclude' },
        ],
      },
      launched_by: { account_id: OWNER, display_name: 'Bohdan Owner' },
      launched_at: at(5).toISOString(),
      launch_breakdown: {
        audience_size: 11,
        blocked_count: 2,
        never_wrote_count: 1,
        recipient_count: 8,
      },
      stopped_by: null,
      stopped_at: null,
      ended_at: null,
      end_reason: null,
      totals: {
        waiting: 1,
        sending: 1,
        delivered: 2,
        blocked: 1,
        failed: 2,
        not_confirmed: 1,
        stopped: 0,
      },
      not_reached_count: 1,
    });
    expect(got).not.toHaveProperty('version');
    expect(got).not.toHaveProperty('breakdown');
  });

  it('a stopped group broadcast: who stopped it and when, not reached = fixable failures plus stopped', async () => {
    const h = setup();
    const b = h.launched(
      [{ state: 'delivered' }, { state: 'failed', reason: 'telegram_error' }, { state: 'stopped' }],
      {
        status: 'stopped',
        audienceKind: 'group',
        tagMode: null,
        stoppedAt: at(9),
        stoppedByAccountId: OWNER,
        endedAt: at(9),
        endReason: 'stopped',
      },
    );
    const got = await h.reads.getBroadcast(WS, b.id);
    expect(LaunchedBroadcast.parse(got)).toEqual(got);
    expect(got).toMatchObject({
      status: 'stopped',
      audience: { kind: 'group' },
      stopped_by: { account_id: OWNER, display_name: 'Bohdan Owner' },
      stopped_at: at(9).toISOString(),
      ended_at: at(9).toISOString(),
      end_reason: 'stopped',
      not_reached_count: 2,
    });
  });

  it('names a launching owner who was deactivated since', async () => {
    const h = setup();
    h.workspaces.active.delete(`${WS}:${OWNER}`);
    const b = h.launched([{ state: 'delivered' }]);
    const got = await h.reads.getBroadcast(WS, b.id);
    expect(got.status !== 'draft' && got.launched_by.display_name).toBe('Bohdan Owner');
  });
});

describe('listBroadcasts (AC-01)', () => {
  it('drafts and launched broadcasts together, most recently changed first, with their audience sizes', async () => {
    const h = setup();
    acmeFlowers(h);
    const tagDraft = h.draft({ name: 'Tags', lastChangedAt: at(3) }, vipNotStaff);
    const groupDraft = h.draft({
      name: 'Group',
      audienceKind: 'group',
      tagMode: null,
      lastChangedAt: at(1),
      lastChangedByAccountId: OWNER,
    });
    const c = h.contact();
    h.store.group.push({
      workspaceId: WS,
      broadcastId: groupDraft.id,
      contactId: c.id,
      addedByAccountId: OPERATOR,
      addedAt: at(1),
    });
    const sent = h.launched([{ state: 'delivered' }], {
      name: 'Sent',
      status: 'sent',
      lastChangedAt: at(2),
      endedAt: at(8),
      endReason: 'completed',
      audienceSize: 4,
    });
    h.draft({ workspaceId: OTHER_WS, name: 'Foreign', lastChangedAt: at(4) });

    const got = await h.reads.listBroadcasts(WS);
    expect(BroadcastList.parse(got)).toEqual(got);
    expect(got.workspace_id).toBe(WS);
    expect(got.items).toEqual([
      {
        id: tagDraft.id,
        name: 'Tags',
        status: 'draft',
        audience_kind: 'tags',
        audience_size: 38,
        author: { account_id: OPERATOR, display_name: 'Olha Operator' },
        last_changed_by: { account_id: OPERATOR, display_name: 'Olha Operator' },
        last_changed_at: at(3).toISOString(),
        launched_at: null,
        ended_at: null,
      },
      {
        id: sent.id,
        name: 'Sent',
        status: 'sent',
        audience_kind: 'tags',
        audience_size: 4,
        author: { account_id: OPERATOR, display_name: 'Olha Operator' },
        last_changed_by: { account_id: OPERATOR, display_name: 'Olha Operator' },
        last_changed_at: at(2).toISOString(),
        launched_at: at(5).toISOString(),
        ended_at: at(8).toISOString(),
      },
      expect.objectContaining({
        id: groupDraft.id,
        audience_kind: 'group',
        audience_size: 1,
        last_changed_by: { account_id: OWNER, display_name: 'Bohdan Owner' },
      }),
    ]);
  });

  it('an empty workspace lists nothing', async () => {
    const h = setup();
    expect(await h.reads.listBroadcasts(WS)).toEqual({ workspace_id: WS, items: [] });
  });
});

describe('listRecipients (AC-11)', () => {
  it('50 at a time in position order, with each outcome, reason and time', async () => {
    const h = setup();
    const states = Array.from({ length: 120 }, (_, i) =>
      i === 0
        ? { state: 'failed' as const, reason: 'account_gone' as const }
        : { state: (i % 2 ? 'delivered' : 'waiting') as RecipientState },
    );
    const b = h.launched(states);
    const first = await h.reads.listRecipients(WS, b.id, {});
    expect(BroadcastRecipientPage.parse(first)).toEqual(first);
    expect(first.items.map((r) => r.position)).toEqual(range(1, 50));
    expect(first).toMatchObject({
      workspace_id: WS,
      broadcast_id: b.id,
      state: null,
      has_prev: false,
      has_next: true,
    });
    expect(first.items[0]).toMatchObject({
      contact: { first_name: 'Recipient 1', last_name: null, username: null },
      state: 'failed',
      failure_reason: 'account_gone',
      outcome_at: at(7).toISOString(),
    });
    expect(first.items[2]).toMatchObject({
      state: 'waiting',
      failure_reason: null,
      outcome_at: null,
    });
    const second = await h.reads.listRecipients(WS, b.id, { after: first.next_cursor! });
    expect(second.items.map((r) => r.position)).toEqual(range(51, 100));
    expect(second.has_prev).toBe(true);
    const third = await h.reads.listRecipients(WS, b.id, { after: second.next_cursor! });
    expect(third.items.map((r) => r.position)).toEqual(range(101, 120));
    expect(third).toMatchObject({ has_next: false, next_cursor: null });
  });

  it('narrowed to one outcome, and a cursor issued for another outcome is refused', async () => {
    const h = setup();
    const b = h.launched(
      Array.from({ length: 60 }, (_, i) => ({
        state: (i % 3 === 0 ? 'delivered' : 'blocked') as RecipientState,
      })),
    );
    const delivered = await h.reads.listRecipients(WS, b.id, { state: 'delivered' });
    expect(delivered.state).toBe('delivered');
    expect(delivered.items).toHaveLength(20);
    expect(delivered.items.every((r) => r.state === 'delivered')).toBe(true);
    const blocked = await h.reads.listRecipients(WS, b.id, { state: 'blocked' });
    expect(blocked.items).toHaveLength(40);
    expect(blocked.has_next).toBe(false);
    const all = await h.reads.listRecipients(WS, b.id, {});
    await expect(
      h.reads.listRecipients(WS, b.id, { state: 'blocked', after: all.next_cursor! }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(h.reads.listRecipients(WS, b.id, { after: 'not-a-cursor' })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
  });

  it('a draft answers an empty page; a foreign broadcast is not found', async () => {
    const h = setup();
    const d = h.draft();
    expect(await h.reads.listRecipients(WS, d.id, {})).toEqual({
      workspace_id: WS,
      broadcast_id: d.id,
      state: null,
      items: [],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    const foreign = h.draft({ workspaceId: OTHER_WS });
    await expect(h.reads.listRecipients(WS, foreign.id, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('itemDetails (AC-16)', () => {
  it('the name, text and launching owner of each launched broadcast, a deactivated owner still named; others left out', async () => {
    const h = setup();
    h.workspaces.active.delete(`${WS}:${OWNER}`);
    const one = h.launched([{ state: 'delivered' }], { name: 'Spring prices' });
    const two = h.launched([{ state: 'delivered' }], { name: 'Autumn', text: 'Autumn text' });
    const draft = h.draft();
    const foreign = h.launched([{ state: 'delivered' }], { workspaceId: OTHER_WS });
    const got = await h.reads.itemDetails(WS, [one.id, two.id, one.id, draft.id, foreign.id]);
    expect(got).toEqual([
      {
        broadcast_id: one.id,
        broadcast_name: 'Spring prices',
        text: 'New prices from Monday.',
        launched_by: { account_id: OWNER, display_name: 'Bohdan Owner' },
      },
      {
        broadcast_id: two.id,
        broadcast_name: 'Autumn',
        text: 'Autumn text',
        launched_by: { account_id: OWNER, display_name: 'Bohdan Owner' },
      },
    ]);
    expect(await h.reads.itemDetails(WS, [])).toEqual([]);
  });
});

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
