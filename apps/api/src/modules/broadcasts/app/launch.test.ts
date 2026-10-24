import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { audienceFingerprint } from '../domain/audience.js';
import {
  fakeAudienceTagRepo,
  fakeBotsApi,
  fakeBroadcastJobs,
  fakeBroadcastRepo,
  fakeBroadcastSignals,
  fakeBroadcastStore,
  fakeBroadcastTransaction,
  fakeContactsApi,
  fakeDraftView,
  fakeGroupRepo,
  fakeRecipientRepo,
  fakeWorkspacesApi,
  type FakeContact,
} from './fakes.js';
import { createLaunchBroadcast } from './launch.js';
import type { AudienceTagRow, BroadcastRecord, BroadcastView } from './ports.js';
import { createLaunchPreview } from './preview.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const WS = newId();
const OWNER = newId();
const OPERATOR = newId();
const VIP = newId();
const STAFF = newId();
const GONE = newId();
const BOT = 7001n;
const owner = { accountId: OWNER, role: 'owner' as const };

function setup() {
  const store = fakeBroadcastStore();
  const contacts = fakeContactsApi();
  contacts.tags.set(
    WS,
    new Map([
      [VIP, 'VIP clients'],
      [STAFF, 'Staff'],
    ]),
  );
  const bots = fakeBotsApi();
  bots.bots.set(WS, { state: 'connected', telegramBotId: BOT });
  const workspaces = fakeWorkspacesApi();
  workspaces.active.add(`${WS}:${OWNER}`);
  workspaces.active.add(`${WS}:${OPERATOR}`);
  const broadcasts = fakeBroadcastRepo(store);
  const audienceTags = fakeAudienceTagRepo(store);
  const groups = fakeGroupRepo(store);
  const clock = fixedClock(NOW);
  const jobs = fakeBroadcastJobs();
  const logs: { obj: object; msg: string }[] = [];
  const preview = createLaunchPreview({ broadcasts, audienceTags, groups, contacts, bots, clock });
  const views: BroadcastView = {
    async broadcastView(workspaceId, id) {
      const b = store.broadcasts.find((x) => x.workspaceId === workspaceId && x.id === id)!;
      return { id: b.id, status: b.status } as never;
    },
  };
  const launch = createLaunchBroadcast({
    transaction: fakeBroadcastTransaction(store),
    broadcasts,
    audienceTags,
    recipients: fakeRecipientRepo(store),
    contacts,
    workspaces,
    preview,
    signals: fakeBroadcastSignals(store),
    jobs,
    views,
    drafts: fakeDraftView(store),
    clock,
    logger: { info: (obj, msg) => logs.push({ obj, msg }) },
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
      lastChangedAt: new Date('2026-10-22T08:00:00Z'),
      createdAt: new Date('2026-10-22T08:00:00Z'),
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

  const vipDraft = () =>
    draft({}, [
      { tagId: VIP, name: 'VIP', kind: 'include' },
      { tagId: GONE, name: 'Old', kind: 'include' },
      { tagId: STAFF, name: 'Staff', kind: 'exclude' },
    ]);

  const rowOf = (id: string) => store.broadcasts.find((b) => b.id === id)!;
  const recipientsOf = (id: string) =>
    store.recipients
      .filter((r) => r.broadcastId === id)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ contactId: r.contactId, position: r.position, state: r.state }));

  return {
    store,
    contacts,
    bots,
    workspaces,
    broadcasts,
    jobs,
    logs,
    preview,
    launch,
    contact,
    draft,
    vipDraft,
    rowOf,
    recipientsOf,
  };
}

type Harness = ReturnType<typeof setup>;

/** 3 reachable VIP contacts, 1 blocked VIP, 1 VIP who never wrote, 1 VIP + Staff (left out). */
function vipAudience(h: Harness) {
  const reachable = [
    h.contact({ tagIds: [VIP] }),
    h.contact({ tagIds: [VIP] }),
    h.contact({ tagIds: [VIP] }),
  ];
  h.contact({ tagIds: [VIP], blocked: new Map([[BOT, new Date('2026-10-20')]]) });
  h.contact({ tagIds: [VIP], wroteTo: [] });
  h.contact({ tagIds: [VIP, STAFF] });
  return reachable.map((c) => c.id).sort();
}

async function confirmed(h: Harness, id: string) {
  const c = await h.preview.getLaunchConfirmation(WS, owner, id);
  return { expected_version: c.version, fingerprint: c.fingerprint };
}

describe('launchBroadcast (AC-06, AC-08, AC-09)', () => {
  it('AC-06: freezes exactly the confirmed recipients in fingerprint order, the text, tag names, bot and breakdown, then queues one link and signals status', async () => {
    const h = setup();
    const ids = vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);

    const got = await h.launch.launchBroadcast(WS, owner, b.id, input);

    expect(got).toEqual({ outcome: 'launched', broadcast: { id: b.id, status: 'sending' } });
    expect(h.recipientsOf(b.id)).toEqual(
      ids.map((contactId, i) => ({ contactId, position: i + 1, state: 'waiting' })),
    );
    expect(h.rowOf(b.id)).toMatchObject({
      status: 'sending',
      text: 'New prices from Monday.',
      launchedAt: NOW,
      launchedByAccountId: OWNER,
      launchTelegramBotId: BOT,
      audienceSize: 5,
      blockedCount: 1,
      neverWroteCount: 1,
      recipientCount: 3,
      lastChangedByAccountId: OWNER,
      lastChangedAt: NOW,
    });
    // The tag rows hold the names at launch; the vanished tag's row is gone.
    expect(
      h.store.tags
        .filter((t) => t.broadcastId === b.id)
        .map((t) => [t.tagId, t.name, t.kind])
        .sort(),
    ).toEqual(
      [
        [VIP, 'VIP clients', 'include'],
        [STAFF, 'Staff', 'exclude'],
      ].sort(),
    );
    expect(h.jobs.links).toEqual([WS]);
    expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
    expect(h.logs).toEqual([
      {
        obj: {
          workspace_id: WS,
          broadcast_id: b.id,
          recipient_count: 3,
          blocked_count: 1,
          never_wrote_count: 1,
        },
        msg: 'broadcast.launched',
      },
    ]);
  });

  it('takes the locks in order: the membership FOR SHARE, the launch lock, then the broadcast row', async () => {
    const h = setup();
    vipAudience(h);
    const b = h.vipDraft();
    await h.launch.launchBroadcast(WS, owner, b.id, await confirmed(h, b.id));
    expect(h.workspaces.locks).toEqual([`members:${OWNER}`]);
    expect(h.broadcasts.locks).toEqual([`launches:${WS}`, `broadcast:${b.id}`]);
  });

  it('a group audience freezes its reachable members', async () => {
    const h = setup();
    const a = h.contact();
    const blocked = h.contact({ blocked: new Map([[BOT, NOW]]) });
    const b = h.draft({ audienceKind: 'group', tagMode: null });
    for (const c of [a, blocked]) {
      h.store.group.push({
        workspaceId: WS,
        broadcastId: b.id,
        contactId: c.id,
        addedByAccountId: OWNER,
        addedAt: NOW,
      });
    }
    const got = await h.launch.launchBroadcast(WS, owner, b.id, await confirmed(h, b.id));
    expect(got.outcome).toBe('launched');
    expect(h.recipientsOf(b.id)).toEqual([{ contactId: a.id, position: 1, state: 'waiting' }]);
    expect(h.rowOf(b.id)).toMatchObject({ audienceSize: 2, blockedCount: 1, recipientCount: 1 });
  });

  it('AC-06: launching twice launches once — the second answers already_launched with no second job or signal', async () => {
    const h = setup();
    vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);
    await h.launch.launchBroadcast(WS, owner, b.id, input);
    const second = await h.launch.launchBroadcast(WS, owner, b.id, input);
    expect(second).toEqual({
      outcome: 'already_launched',
      broadcast: { id: b.id, status: 'sending' },
    });
    expect(h.recipientsOf(b.id)).toHaveLength(3);
    expect(h.jobs.links).toEqual([WS]);
    expect(h.store.signals).toEqual([`status:${WS}:${b.id}`]);
    expect(h.logs).toHaveLength(1);
  });

  it('AC-06: a draft saved since the confirmation is refused with the current draft and nothing launches', async () => {
    const h = setup();
    vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);
    Object.assign(h.rowOf(b.id), { version: 6, text: 'Changed' });
    const err = await h.launch.launchBroadcast(WS, owner, b.id, input).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'BROADCAST_DRAFT_CHANGED',
      details: { draft: { id: b.id, version: 6, text: 'Changed' } },
    });
    expect(h.rowOf(b.id).status).toBe('draft');
    expect(h.recipientsOf(b.id)).toEqual([]);
    expect(h.jobs.links).toEqual([]);
    expect(h.store.signals).toEqual([]);
  });

  it('AC-06: a different reachable set with the same count is refused with the current confirmation', async () => {
    const h = setup();
    const ids = vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);
    // A teammate retags: one VIP leaves, another contact joins — still 3 reachable.
    const leaving = h.contacts.contacts.get(WS)!.find((c) => c.id === ids[0])!;
    leaving.tagIds = [];
    const joining = h.contact({ tagIds: [VIP] });
    const err = await h.launch.launchBroadcast(WS, owner, b.id, input).catch((e: unknown) => e);
    const current = [...ids.slice(1), joining.id].sort();
    expect(err).toMatchObject({
      code: 'BROADCAST_AUDIENCE_CHANGED',
      details: {
        confirmation: {
          broadcast_id: b.id,
          version: 5,
          breakdown: { recipient_count: 3 },
          fingerprint: audienceFingerprint(current),
        },
      },
    });
    expect(h.rowOf(b.id).status).toBe('draft');
    expect(h.recipientsOf(b.id)).toEqual([]);
    expect(h.jobs.links).toEqual([]);
    expect(h.store.signals).toEqual([]);
    // The stored tag names are untouched by a refused launch.
    expect(h.store.tags.filter((t) => t.broadcastId === b.id)).toHaveLength(3);
  });

  it('AC-09: the 11th launch within 24 h is refused, writes nothing and does not count', async () => {
    const h = setup();
    vipAudience(h);
    for (let i = 0; i < 10; i += 1) {
      h.draft({
        status: 'sent',
        launchedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000),
        launchedByAccountId: OWNER,
      });
    }
    const b = h.vipDraft();
    const input = { expected_version: 5, fingerprint: 'x'.repeat(64) };
    await expect(h.launch.launchBroadcast(WS, owner, b.id, input)).rejects.toMatchObject({
      code: 'BROADCAST_LAUNCH_LIMIT_REACHED',
    });
    expect(h.rowOf(b.id).launchedAt).toBeNull();
    expect(h.jobs.links).toEqual([]);
  });

  it('AC-09: a draft that reaches nobody cannot be launched', async () => {
    const h = setup();
    h.contact({ tagIds: [VIP], wroteTo: [] });
    const b = h.vipDraft();
    const input = { expected_version: 5, fingerprint: 'x'.repeat(64) };
    await expect(h.launch.launchBroadcast(WS, owner, b.id, input)).rejects.toMatchObject({
      code: 'BROADCAST_NO_REACHABLE_CONTACT',
    });
    expect(h.rowOf(b.id).status).toBe('draft');
  });

  it('AC-08: an operator is refused as owner only before any lock', async () => {
    const h = setup();
    vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);
    await expect(
      h.launch.launchBroadcast(WS, { accountId: OPERATOR, role: 'operator' }, b.id, input),
    ).rejects.toMatchObject({ code: 'OWNER_ONLY' });
    expect(h.workspaces.locks).toEqual([]);
    expect(h.broadcasts.locks).toEqual([]);
    expect(h.rowOf(b.id).status).toBe('draft');
  });

  it('AC-08: an owner deactivated meanwhile gets access removed and launches nothing', async () => {
    const h = setup();
    vipAudience(h);
    const b = h.vipDraft();
    const input = await confirmed(h, b.id);
    h.workspaces.active.delete(`${WS}:${OWNER}`);
    await expect(h.launch.launchBroadcast(WS, owner, b.id, input)).rejects.toMatchObject({
      code: 'ACCESS_REMOVED',
    });
    expect(h.broadcasts.locks).toEqual([]);
    expect(h.rowOf(b.id).status).toBe('draft');
    expect(h.jobs.links).toEqual([]);
  });

  it('AC-08: a broadcast of another workspace is not found', async () => {
    const h = setup();
    const b = h.draft({ workspaceId: newId() });
    await expect(
      h.launch.launchBroadcast(WS, owner, b.id, {
        expected_version: 5,
        fingerprint: 'x'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.rowOf(b.id).status).toBe('draft');
  });
});
