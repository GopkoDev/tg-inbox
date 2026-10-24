import { LaunchConfirmation } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { audienceFingerprint } from '../domain/audience.js';
import {
  fakeBotsApi,
  fakeBroadcastRepo,
  fakeBroadcastStore,
  fakeContactsApi,
  fakeGroupRepo,
  fakeAudienceTagRepo,
  type FakeContact,
} from './fakes.js';
import type { AudienceTagRow, BroadcastRecord } from './ports.js';
import { createLaunchPreview } from './preview.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const OWNER = newId();
const OPERATOR = newId();
const VIP = newId();
const STAFF = newId();
const BOT = 7001n;
const owner = { accountId: OWNER, role: 'owner' as const };

function setup() {
  const store = fakeBroadcastStore();
  const contacts = fakeContactsApi();
  contacts.tags.set(
    WS,
    new Map([
      [VIP, 'VIP'],
      [STAFF, 'Staff'],
    ]),
  );
  const bots = fakeBotsApi();
  bots.bots.set(WS, { state: 'connected', telegramBotId: BOT });
  const preview = createLaunchPreview({
    broadcasts: fakeBroadcastRepo(store),
    audienceTags: fakeAudienceTagRepo(store),
    groups: fakeGroupRepo(store),
    contacts,
    bots,
    clock: fixedClock(NOW),
  });

  const contact = (o: Partial<FakeContact> = {}): FakeContact => {
    const c: FakeContact = {
      id: newId(),
      firstName: 'Test User',
      tagIds: [],
      wroteTo: [BOT],
      ...o,
    };
    contacts.contacts.set(WS, [...(contacts.contacts.get(WS) ?? []), c]);
    return c;
  };

  const draft = (o: Partial<BroadcastRecord> = {}, tags: AudienceTagRow[] = []) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: WS,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      status: 'draft',
      version: 5,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: OPERATOR,
      lastChangedByAccountId: OPERATOR,
      lastChangedAt: NOW,
      createdAt: NOW,
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

  /** Launches already made by the workspace, at these times; the first one was stopped. */
  const launches = (times: Date[]) => {
    for (const [i, at] of times.entries()) {
      draft({
        status: i === 0 ? 'stopped' : 'sent',
        launchedAt: at,
        launchedByAccountId: OWNER,
      });
    }
  };

  return { store, contacts, bots, preview, contact, draft, launches };
}

/** AC-06: VIP on 40 (2 blocked), Staff on 3 (two also VIP): "any of" VIP, Staff left out → 36 of 38. */
function acme(h: ReturnType<typeof setup>) {
  const reachable: string[] = [];
  for (let i = 0; i < 38; i += 1) {
    const c = h.contact({ tagIds: [VIP], ...(i < 2 && { blocked: new Map([[BOT, NOW]]) }) });
    if (i >= 2) reachable.push(c.id);
  }
  h.contact({ tagIds: [VIP, STAFF] });
  h.contact({ tagIds: [VIP, STAFF] });
  h.contact({ tagIds: [STAFF] });
  const d = h.draft({}, [
    { tagId: VIP, name: 'VIP', kind: 'include' },
    { tagId: STAFF, name: 'Staff', kind: 'exclude' },
  ]);
  return { d, reachable };
}

const minutesBefore = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('getLaunchConfirmation — the confirmation (AC-06)', () => {
  it('the trimmed text, the version, the breakdown 38 / 2 / 0 / 36 and the fingerprint of the sorted reachable ids', async () => {
    const h = setup();
    const { d, reachable } = acme(h);
    const got = await h.preview.getLaunchConfirmation(WS, owner, d.id);
    expect(LaunchConfirmation.parse(got)).toEqual(got);
    expect(got).toEqual({
      broadcast_id: d.id,
      version: 5,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      breakdown: { audience_size: 38, blocked_count: 2, never_wrote_count: 0, recipient_count: 36 },
      fingerprint: audienceFingerprint(reachable),
    });
  });

  it('a contact who wrote only to an older bot is counted as never wrote and left out (AC-10)', async () => {
    const h = setup();
    const ok = h.contact({ tagIds: [VIP] });
    h.contact({ tagIds: [VIP], wroteTo: [1234n] });
    const d = h.draft({}, [{ tagId: VIP, name: 'VIP', kind: 'include' }]);
    const got = await h.preview.getLaunchConfirmation(WS, owner, d.id);
    expect(got.breakdown).toEqual({
      audience_size: 2,
      blocked_count: 0,
      never_wrote_count: 1,
      recipient_count: 1,
    });
    expect(got.fingerprint).toBe(audienceFingerprint([ok.id]));
  });

  it('a group audience is evaluated over its contacts', async () => {
    const h = setup();
    const a = h.contact();
    const b = h.contact();
    h.contact();
    const d = h.draft({ audienceKind: 'group', tagMode: null });
    for (const c of [a, b]) {
      h.store.group.push({
        workspaceId: WS,
        broadcastId: d.id,
        contactId: c.id,
        addedByAccountId: OPERATOR,
        addedAt: NOW,
      });
    }
    const got = await h.preview.getLaunchConfirmation(WS, owner, d.id);
    expect(got.breakdown.recipient_count).toBe(2);
    expect(got.fingerprint).toBe(audienceFingerprint([a.id, b.id]));
  });

  it('launches 9 in the last 24 h still pass; one older than 24 h does not count', async () => {
    const h = setup();
    const { d } = acme(h);
    h.launches([
      ...Array.from({ length: 9 }, (_, i) => minutesBefore(10 + i)),
      minutesBefore(24 * 60 + 1),
    ]);
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).resolves.toMatchObject({
      broadcast_id: d.id,
    });
  });
});

describe('getLaunchConfirmation — refusals in order (AC-05, AC-07, AC-09, AC-10)', () => {
  it('an operator is refused as owner only, before anything else', async () => {
    const h = setup();
    await expect(
      h.preview.getLaunchConfirmation(WS, { accountId: OPERATOR, role: 'operator' }, newId()),
    ).rejects.toMatchObject({ code: 'OWNER_ONLY' });
  });

  it('a broadcast of another workspace is not found; a launched one is not a draft', async () => {
    const h = setup();
    const foreign = h.draft({ workspaceId: OTHER_WS });
    await expect(h.preview.getLaunchConfirmation(WS, owner, foreign.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const launched = h.draft({ status: 'sending', launchedAt: NOW });
    await expect(h.preview.getLaunchConfirmation(WS, owner, launched.id)).rejects.toMatchObject({
      code: 'BROADCAST_NOT_A_DRAFT',
      details: { broadcast_id: launched.id, status: 'sending' },
    });
  });

  it('an empty text is refused before the bot is looked at', async () => {
    const h = setup();
    h.bots.bots.delete(WS);
    const d = h.draft({ text: '' });
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).rejects.toMatchObject({
      code: 'BROADCAST_TEXT_INVALID',
      details: { length: 0 },
    });
  });

  it.each([
    ['no bot row', null, 'not_connected'],
    ['disconnected', 'disconnected', 'not_connected'],
    ['needs_token', 'needs_token', 'needs_token'],
    ['taken_over', 'taken_over', 'taken_over'],
  ] as const)('%s needs a working bot (bot_state %s)', async (_label, state, botState) => {
    const h = setup();
    const { d } = acme(h);
    if (state === null) h.bots.bots.delete(WS);
    else h.bots.bots.set(WS, { state, telegramBotId: BOT });
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).rejects.toMatchObject({
      code: 'BROADCAST_NEEDS_WORKING_BOT',
      details: { bot_state: botState },
    });
  });

  it('the 11th launch in 24 h (one of them stopped) is refused with next_launch_at = 10th newest + 24 h', async () => {
    const h = setup();
    const { d } = acme(h);
    const times = Array.from({ length: 10 }, (_, i) => minutesBefore(30 + i * 60));
    h.launches(times);
    const tenth = times[9]!;
    const next = new Date(tenth.getTime() + 24 * 3_600_000);
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).rejects.toMatchObject({
      code: 'BROADCAST_LAUNCH_LIMIT_REACHED',
      details: { limit: 10, window_hours: 24, next_launch_at: next.toISOString() },
      headers: { 'Retry-After': String((next.getTime() - NOW.getTime()) / 1000) },
    });
  });

  it('an audience over 10 000 is refused as too large, before the reachable check', async () => {
    const h = setup();
    for (let i = 0; i < 10_001; i += 1) h.contact({ tagIds: [VIP], wroteTo: [] });
    const d = h.draft({}, [{ tagId: VIP, name: 'VIP', kind: 'include' }]);
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).rejects.toMatchObject({
      code: 'BROADCAST_AUDIENCE_TOO_LARGE',
      details: { limit: 10_000, audience_size: 10_001, can_add: 0 },
    });
  });

  it('nobody reachable is refused with the breakdown', async () => {
    const h = setup();
    h.contact({ tagIds: [VIP], blocked: new Map([[BOT, NOW]]) });
    h.contact({ tagIds: [VIP], wroteTo: [] });
    const d = h.draft({}, [{ tagId: VIP, name: 'VIP', kind: 'include' }]);
    await expect(h.preview.getLaunchConfirmation(WS, owner, d.id)).rejects.toMatchObject({
      code: 'BROADCAST_NO_REACHABLE_CONTACT',
      details: {
        breakdown: { audience_size: 2, blocked_count: 1, never_wrote_count: 1, recipient_count: 0 },
      },
    });
  });
});
