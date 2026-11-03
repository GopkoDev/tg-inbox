import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { FailureReason, RecipientState } from '../domain/recipient.js';
import { createDuplicate } from './duplicate.js';
import {
  fakeAudienceTagRepo,
  fakeBroadcastRepo,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeDraftView,
  fakeGroupRepo,
  fakeRecipientRepo,
} from './fakes.js';
import type { BroadcastRecord } from './ports.js';

const T0 = new Date('2026-10-20T09:00:00Z');
const NOW = new Date('2026-10-23T09:00:00Z');
const WS = newId();
const OWNER = newId();
const OPERATOR = newId();
const VIP = newId();
const STAFF = newId();

function setup() {
  const store = fakeBroadcastStore();
  const duplicate = createDuplicate({
    transaction: fakeBroadcastTransaction(store),
    broadcasts: fakeBroadcastRepo(store),
    audienceTags: fakeAudienceTagRepo(store),
    groups: fakeGroupRepo(store),
    recipients: fakeRecipientRepo(store),
    signals: fakeBroadcastSignals(store),
    views: fakeDraftView(store),
    clock: fixedClock(NOW),
  });

  const source = (o: Partial<BroadcastRecord> = {}) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      status: 'draft',
      version: 7,
      audienceKind: 'tags',
      tagMode: 'all',
      authorAccountId: OWNER,
      lastChangedByAccountId: OWNER,
      lastChangedAt: T0,
      createdAt: T0,
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

  const launched = (
    recipients: Array<{ state: RecipientState; reason?: FailureReason }>,
    o: Partial<BroadcastRecord> = {},
  ) => {
    const row = source({
      status: 'sent',
      audienceKind: 'group',
      tagMode: null,
      launchedAt: T0,
      launchedByAccountId: OWNER,
      launchTelegramBotId: 1n,
      audienceSize: recipients.length,
      blockedCount: 0,
      neverWroteCount: 0,
      recipientCount: recipients.length,
      endedAt: T0,
      endReason: 'completed',
      ...o,
    });
    const contactIds = recipients.map((r, i) => {
      const contactId = newId();
      store.recipients.push({
        workspaceId: row.workspaceId,
        id: newId(),
        broadcastId: row.id,
        contactId,
        position: i + 1,
        telegramUserId: BigInt(i + 1),
        state: r.state,
        failureReason: r.state === 'failed' ? (r.reason ?? 'telegram_error') : null,
        claimedAt: null,
        outcomeAt: r.state === 'waiting' || r.state === 'sending' ? null : T0,
        telegramMessageId: null,
      });
      return contactId;
    });
    return { row, contactIds };
  };

  const copyOf = (id: string) => store.broadcasts.find((b) => b.id === id)!;
  const groupOf = (id: string) =>
    store.group
      .filter((g) => g.broadcastId === id)
      .map((g) => g.contactId)
      .sort();

  return { store, duplicate, source, launched, copyOf, groupOf };
}

/** AC-13: 33 delivered, 1 blocked, 2 failed "the bot stopped working". */
const ac13: Array<{ state: RecipientState; reason?: FailureReason }> = [
  ...Array.from({ length: 33 }, () => ({ state: 'delivered' as const })),
  { state: 'blocked' },
  { state: 'failed', reason: 'bot_stopped' },
  { state: 'failed', reason: 'bot_stopped' },
];

describe('duplicateBroadcast (AC-07, AC-13)', () => {
  it('a draft is copied with its text and tag audience: "Copy of …", the member as author, version 1', async () => {
    const h = setup();
    const src = h.source();
    h.store.tags.push(
      { workspaceId: WS, broadcastId: src.id, tagId: VIP, name: 'VIP', kind: 'include' },
      { workspaceId: WS, broadcastId: src.id, tagId: STAFF, name: 'Staff', kind: 'exclude' },
    );
    const copy = await h.duplicate.duplicateBroadcast(WS, OPERATOR, src.id, { audience: 'same' });
    expect(copy).toMatchObject({
      status: 'draft',
      version: 1,
      name: 'Copy of Spring prices',
      text: 'New prices from Monday.',
      author: { account_id: OPERATOR },
      last_changed_by: { account_id: OPERATOR },
      created_at: NOW.toISOString(),
      audience: {
        kind: 'tags',
        mode: 'all',
        tags: [
          { tag_id: VIP, name: 'VIP', kind: 'include' },
          { tag_id: STAFF, name: 'Staff', kind: 'exclude' },
        ],
      },
    });
    expect(copy.id).not.toBe(src.id);
    expect(h.store.signals).toEqual([`draft:${WS}:${copy.id}`]);
    // The source does not change.
    expect(h.copyOf(src.id)).toMatchObject({
      version: 7,
      authorAccountId: OWNER,
      lastChangedAt: T0,
    });
  });

  it('a draft group is copied whole, added by the member', async () => {
    const h = setup();
    const src = h.source({ audienceKind: 'group', tagMode: null });
    const ids = Array.from({ length: 14 }, () => newId());
    for (const contactId of ids) {
      h.store.group.push({
        workspaceId: WS,
        broadcastId: src.id,
        contactId,
        addedByAccountId: OWNER,
        addedAt: T0,
      });
    }
    const copy = await h.duplicate.duplicateBroadcast(WS, OPERATOR, src.id, { audience: 'same' });
    expect(copy.audience).toEqual({ kind: 'group', size: 14 });
    expect(h.groupOf(copy.id)).toEqual([...ids].sort());
    expect(h.store.group.filter((g) => g.broadcastId === copy.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addedByAccountId: OPERATOR, addedAt: NOW }),
      ]),
    );
  });

  it('"same tags" copies the tags a launched tag audience was launched with', async () => {
    const h = setup();
    const { row } = h.launched([{ state: 'delivered' }], { audienceKind: 'tags', tagMode: 'any' });
    h.store.tags.push({
      workspaceId: WS,
      broadcastId: row.id,
      tagId: VIP,
      name: 'VIP at launch',
      kind: 'include',
    });
    const copy = await h.duplicate.duplicateBroadcast(WS, OWNER, row.id, {
      audience: 'same_tags',
    });
    expect(copy.audience).toMatchObject({
      kind: 'tags',
      mode: 'any',
      tags: [{ tag_id: VIP, name: 'VIP at launch', kind: 'include' }],
    });
  });

  it('"all recipients" makes a group of every recipient, the blocked one included', async () => {
    const h = setup();
    const { row, contactIds } = h.launched(ac13);
    const copy = await h.duplicate.duplicateBroadcast(WS, OPERATOR, row.id, {
      audience: 'all_recipients',
    });
    expect(copy.audience).toEqual({ kind: 'group', size: 36 });
    expect(h.groupOf(copy.id)).toEqual([...contactIds].sort());
  });

  it('"only recipients it did not reach": the fixable failures plus stopped; not confirmed only when asked', async () => {
    const h = setup();
    const { row, contactIds } = h.launched(
      [
        ...ac13,
        { state: 'failed', reason: 'account_gone' },
        { state: 'failed', reason: 'chat_not_found' },
        { state: 'failed', reason: 'telegram_error' },
        { state: 'failed', reason: 'text_refused' },
        { state: 'stopped' },
        { state: 'not_confirmed' },
      ],
      { status: 'stopped', stoppedAt: T0, stoppedByAccountId: OWNER, endReason: 'stopped' },
    );
    const fixable = [34, 35, 38, 39, 40].map((i) => contactIds[i]!).sort();
    const without = await h.duplicate.duplicateBroadcast(WS, OPERATOR, row.id, {
      audience: 'not_reached',
    });
    expect(h.groupOf(without.id)).toEqual(fixable);
    const withNc = await h.duplicate.duplicateBroadcast(WS, OPERATOR, row.id, {
      audience: 'not_reached',
      include_not_confirmed: true,
    });
    expect(h.groupOf(withNc.id)).toEqual([...fixable, contactIds[41]!].sort());
  });

  it('AC-13 seed: "did not reach" gives exactly the 2 "bot stopped" failures', async () => {
    const h = setup();
    const { row, contactIds } = h.launched(ac13);
    const copy = await h.duplicate.duplicateBroadcast(WS, OPERATOR, row.id, {
      audience: 'not_reached',
    });
    expect(copy.audience).toEqual({ kind: 'group', size: 2 });
    expect(h.groupOf(copy.id)).toEqual([contactIds[34]!, contactIds[35]!].sort());
  });

  it('"did not reach" while the source still sends is refused as not ended', async () => {
    const h = setup();
    const { row } = h.launched(ac13, { status: 'sending', endedAt: null, endReason: null });
    await expect(
      h.duplicate.duplicateBroadcast(WS, OPERATOR, row.id, { audience: 'not_reached' }),
    ).rejects.toMatchObject({
      code: 'BROADCAST_NOT_ENDED',
      details: { broadcast_id: row.id, status: 'sending' },
    });
    expect(h.store.broadcasts).toHaveLength(1);
  });

  it.each([
    ['same', 'a launched broadcast', { status: 'sent' as const, launchedAt: T0 }],
    ['same_tags', 'a draft', {}],
    ['same_tags', 'a launched group', { status: 'sent' as const, audienceKind: 'group' as const }],
    ['all_recipients', 'a draft', {}],
    ['not_reached', 'a draft', {}],
  ] as const)('"%s" on %s is a validation error on audience', async (audience, _label, o) => {
    const h = setup();
    const src = h.source(o);
    await expect(
      h.duplicate.duplicateBroadcast(WS, OPERATOR, src.id, { audience }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'audience' } });
    expect(h.store.broadcasts).toHaveLength(1);
  });

  it('a name of 80 characters is cut to 80 with "Copy of "', async () => {
    const h = setup();
    const src = h.source({ name: 'x'.repeat(80) });
    const copy = await h.duplicate.duplicateBroadcast(WS, OPERATOR, src.id, { audience: 'same' });
    expect([...copy.name]).toHaveLength(80);
    expect(copy.name.startsWith('Copy of ')).toBe(true);
  });

  it('a broadcast of another workspace is not found', async () => {
    const h = setup();
    const src = h.source({ workspaceId: newId() });
    await expect(
      h.duplicate.duplicateBroadcast(WS, OPERATOR, src.id, { audience: 'same' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
