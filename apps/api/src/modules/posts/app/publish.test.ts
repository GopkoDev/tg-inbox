import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  DestinationUnavailableError,
  NotFoundError,
  OwnerOnlyError,
  PostDailyLimitReachedError,
  PostDraftChangedError,
  PostScheduledLimitReachedError,
  PostScheduleOutOfRangeError,
  PostsNeedWorkingBotError,
  PostTextInvalidError,
  PostTimeDoesNotExistError,
  TimeZoneChangedError,
  TimeZoneRequiredError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import type { PostRecord } from '../infra/post-repo.js';
import { createPostPublishing } from './publish.js';
import {
  basePost,
  basePostDestination,
  fakeDestinationRepo,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const WS = newId();
const OWNER = newId();
const OWNER_2 = newId();
const OPERATOR = newId();
const DEST = newId();
const BOT = 1n;
const owner = { accountId: OWNER, role: 'owner' as const };
const owner2 = { accountId: OWNER_2, role: 'owner' as const };
const operator = { accountId: OPERATOR, role: 'operator' as const };
const HOUR = 3_600_000;

interface Opts {
  now?: Date;
  zone?: string | null;
  bot?: { state: string; telegramBotId: bigint } | null;
  inactive?: string[];
}

function setup(opts: Opts = {}) {
  const now = opts.now ?? new Date('2026-11-03T12:00:00Z'); // 14:00 in Europe/Kyiv
  const store = fakeStore();
  store.destinations.push(basePostDestination({ id: DEST, workspaceId: WS, telegramBotId: BOT }));
  const order: string[] = [];
  const jobs: { postId: string; workspaceId: string; moment: string; startAfter: Date }[] = [];
  const base = fakePostRepo(store);
  const posts = {
    ...base,
    // The scheduling write: from a draft (publish, schedule) or from a scheduled post (change time),
    // both against the shown version.
    async schedule(
      ws: string,
      id: string,
      expectedVersion: number,
      s: { scheduledFor: Date; scheduledByAccountId: string; scheduleKind: 'now' | 'time' },
      at: Date,
    ) {
      const p = store.posts.find((x) => x.workspaceId === ws && x.id === id);
      if (!p || (p.state !== 'draft' && p.state !== 'scheduled') || p.version !== expectedVersion) {
        return null;
      }
      Object.assign(p, {
        state: 'scheduled',
        scheduledFor: s.scheduledFor,
        scheduledByAccountId: s.scheduledByAccountId,
        scheduleKind: s.scheduleKind,
        lastChangedByAccountId: s.scheduledByAccountId,
        lastChangedAt: at,
      });
      return { ...p };
    },
    async countScheduled(ws: string) {
      return store.posts.filter((p) => p.workspaceId === ws && p.state === 'scheduled').length;
    },
    async countSentSince(ws: string, since: Date) {
      return store.posts.filter(
        (p) => p.workspaceId === ws && p.sendingStartedAt && p.sendingStartedAt >= since,
      ).length;
    },
    async sentTimesSince(ws: string, since: Date) {
      return store.posts
        .filter((p) => p.workspaceId === ws && p.sendingStartedAt && p.sendingStartedAt >= since)
        .map((p) => p.sendingStartedAt as Date);
    },
  };
  const publishing = createPostPublishing({
    transaction: fakeTransaction(),
    posts,
    destinations: fakeDestinationRepo(store),
    workspaces: {
      async lockActiveMembers(_tx, _ws, ids) {
        order.push('members');
        return ids.filter((i) => !(opts.inactive ?? []).includes(i));
      },
    },
    lockPosts: async () => {
      order.push('posts-lock');
    },
    workspaceSettings: {
      timeZone: async () => (opts.zone === undefined ? 'Europe/Kyiv' : opts.zone),
    },
    bots: {
      postReadiness: async () =>
        opts.bot === undefined ? { state: 'connected', telegramBotId: BOT } : opts.bot,
    },
    jobs: {
      async enqueueSend(_tx, payload, startAfter) {
        jobs.push({ ...payload, startAfter });
      },
    },
    signals: {
      async postChanged(_tx, ws, id) {
        store.signals.push(`post:${ws}:${id}`);
      },
    },
    views: {
      postView: async (ws, id) =>
        ({ ...store.posts.find((p) => p.workspaceId === ws && p.id === id) }) as never,
    },
    clock: fixedClock(now),
  });
  const seed = (o: Partial<PostRecord> = {}) => {
    const p = basePost({
      id: newId(),
      workspaceId: WS,
      destinationId: DEST,
      text: 'Spring sale',
      version: 3,
      ...o,
    });
    store.posts.push(p);
    return p;
  };
  const seedSent = (n: number, hoursAgo: (i: number) => number) => {
    for (let i = 0; i < n; i++) {
      seed({
        state: 'published',
        sendingStartedAt: new Date(now.getTime() - hoursAgo(i) * HOUR),
        publishedAt: new Date(now.getTime() - hoursAgo(i) * HOUR),
      });
    }
  };
  const seedScheduled = (n: number) => {
    for (let i = 0; i < n; i++) {
      seed({ state: 'scheduled', scheduledFor: new Date(now.getTime() + 5 * HOUR) });
    }
  };
  return { store, publishing, seed, seedSent, seedScheduled, jobs, order, now };
}

describe('getPublishConfirmation (AC-03, AC-07)', () => {
  it('shows destination, exact text, version, zone and headroom with no blockers', async () => {
    const h = setup();
    const p = h.seed();
    h.seedSent(4, (i) => i + 1);
    const c = await h.publishing.getPublishConfirmation(WS, owner, p.id);
    expect(c).toMatchObject({
      post_id: p.id,
      version: 3,
      text: 'Spring sale',
      silent: false,
      destination: {
        id: DEST,
        kind: 'channel',
        title: 'Acme Flowers News',
        availability: 'available',
        problem: null,
      },
      time_zone: 'Europe/Kyiv',
      sent_last_24h: 4,
      daily_limit: 30,
      frees_at: null,
      scheduled_limit: 100,
      blockers: [],
    });
  });

  it('refuses an operator with the owners-only error', async () => {
    const h = setup();
    const p = h.seed();
    await expect(h.publishing.getPublishConfirmation(WS, operator, p.id)).rejects.toBeInstanceOf(
      OwnerOnlyError,
    );
  });

  it('lists every blocker that would refuse a publish now', async () => {
    const h = setup({ bot: { state: 'disconnected', telegramBotId: BOT } });
    const p = h.seed({ text: '', destinationId: null });
    h.seedSent(30, (i) => 0.5 + i * 0.5); // all 30 inside the last 24 hours
    const c = await h.publishing.getPublishConfirmation(WS, owner, p.id);
    expect(c.blockers).toEqual(
      expect.arrayContaining(['text_empty', 'no_destination', 'bot_not_working', 'daily_limit']),
    );
    expect(c.frees_at).not.toBeNull();
  });

  it('flags a destination of a replaced bot as unavailable', async () => {
    const h = setup({ bot: { state: 'connected', telegramBotId: 99n } });
    const p = h.seed();
    const c = await h.publishing.getPublishConfirmation(WS, owner, p.id);
    expect(c.blockers).toContain('destination_unavailable');
    expect(c.destination).toMatchObject({
      availability: 'unavailable',
      problem: 'not_current_bot',
    });
  });

  it('flags a post that is no longer a draft', async () => {
    const h = setup();
    const p = h.seed({ state: 'scheduled', scheduledFor: new Date('2026-11-04T07:00:00Z') });
    const c = await h.publishing.getPublishConfirmation(WS, owner, p.id);
    expect(c.blockers).toContain('not_a_draft');
  });

  it('answers not found for an unknown post', async () => {
    const h = setup();
    await expect(h.publishing.getPublishConfirmation(WS, owner, newId())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('publishPost (AC-03, AC-07, AC-08, AC-14, AC-16)', () => {
  it('queues the post to go out now: scheduled / now, by the owner, one job in the transaction', async () => {
    const h = setup();
    const p = h.seed();
    const res = await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    expect(res.outcome).toBe('queued');
    expect(h.store.posts[0]).toMatchObject({
      state: 'scheduled',
      scheduleKind: 'now',
      scheduledFor: h.now,
      scheduledByAccountId: OWNER,
    });
    expect(h.jobs).toEqual([
      { postId: p.id, workspaceId: WS, moment: h.now.toISOString(), startAfter: h.now },
    ]);
    expect(h.store.signals).toEqual([`post:${WS}:${p.id}`]);
  });

  it('takes memberships, then the posts lock, before anything else', async () => {
    const h = setup();
    const p = h.seed();
    await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    expect(h.order).toEqual(['members', 'posts-lock']);
  });

  it('a double click queues one job and answers already_scheduled the second time', async () => {
    const h = setup();
    const p = h.seed();
    await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    const second = await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    expect(second.outcome).toBe('already_scheduled');
    expect(h.jobs).toHaveLength(1);
    expect(h.store.signals).toHaveLength(1);
  });

  it('two owners confirming at once: the second gets already_scheduled, one job, first owner kept', async () => {
    const h = setup();
    const p = h.seed();
    const [a, b] = await Promise.all([
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
      h.publishing.publishPost(WS, owner2, p.id, { expected_version: 3 }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['already_scheduled', 'queued']);
    expect(h.jobs).toHaveLength(1);
  });

  it('answers already_scheduled for a post that already went out, queuing nothing', async () => {
    const h = setup();
    const p = h.seed({ state: 'published', publishedAt: h.now });
    const res = await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    expect(res.outcome).toBe('already_scheduled');
    expect(h.jobs).toEqual([]);
  });

  it('refuses an operator and queues nothing', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.publishing.publishPost(WS, operator, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(OwnerOnlyError);
    expect(h.jobs).toEqual([]);
    expect(h.store.posts[0]!.state).toBe('draft');
  });

  it('refuses an owner whose access was removed', async () => {
    const h = setup({ inactive: [OWNER] });
    const p = h.seed();
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(OwnerOnlyError);
    expect(h.jobs).toEqual([]);
  });

  it('a confirmation for a changed draft publishes nothing', async () => {
    const h = setup();
    const p = h.seed({ version: 4 });
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(PostDraftChangedError);
    expect(h.jobs).toEqual([]);
    expect(h.store.posts[0]!.state).toBe('draft');
  });

  it('refuses an empty text', async () => {
    const h = setup();
    const p = h.seed({ text: '' });
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(PostTextInvalidError);
  });

  it.each([
    ['no destination', { destinationId: null }],
    ['unavailable destination', { destinationId: 'unavailable' }],
  ])('refuses %s', async (_name, patch) => {
    const h = setup();
    if (patch.destinationId === 'unavailable') {
      h.store.destinations[0]!.availability = 'unavailable';
      h.store.destinations[0]!.problem = 'no_post_right';
      patch = { destinationId: DEST };
    }
    const p = h.seed(patch);
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(DestinationUnavailableError);
    expect(h.jobs).toEqual([]);
  });

  it('refuses a destination of the replaced bot (AC-14)', async () => {
    const h = setup({ bot: { state: 'connected', telegramBotId: 99n } });
    const p = h.seed();
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(DestinationUnavailableError);
  });

  it.each([
    ['disconnected', { state: 'disconnected', telegramBotId: BOT }],
    ['no bot', null],
  ])('refuses while the bot is not working (%s) (AC-14)', async (_n, bot) => {
    const h = setup({ bot });
    const p = h.seed();
    await expect(
      h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(PostsNeedWorkingBotError);
    expect(h.jobs).toEqual([]);
  });

  it('refuses the 31st post in 24 hours and says when posting is possible again (AC-16)', async () => {
    const h = setup();
    h.seedSent(30, (i) => 2 + i * 0.5); // oldest is 16.5 h ago
    const p = h.seed();
    const err = await h.publishing
      .publishPost(WS, owner, p.id, { expected_version: 3 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PostDailyLimitReachedError);
    expect((err as PostDailyLimitReachedError).details).toMatchObject({
      limit: 30,
      frees_at: new Date(h.now.getTime() + 7.5 * HOUR).toISOString(),
    });
    expect(h.jobs).toEqual([]);
  });

  it('allows the 30th post (29 sent in 24 hours)', async () => {
    const h = setup();
    h.seedSent(29, (i) => i * 0.5 + 1);
    const p = h.seed();
    const res = await h.publishing.publishPost(WS, owner, p.id, { expected_version: 3 });
    expect(res.outcome).toBe('queued');
  });

  it("does not find another workspace's post", async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.publishing.publishPost(newId(), owner, p.id, { expected_version: 3 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('schedulePost (AC-09, AC-10, AC-16)', () => {
  const at = (local: string, zone = 'Europe/Kyiv', version = 3) => ({
    expected_version: version,
    local_time: local,
    time_zone: zone,
  });

  it('schedules tomorrow 09:00 Europe/Kyiv as an instant and queues one job at it', async () => {
    const h = setup();
    const p = h.seed();
    const res = await h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00'));
    const due = new Date('2026-11-04T07:00:00Z'); // EET, UTC+2
    expect(res.outcome).toBe('scheduled');
    expect(h.store.posts[0]).toMatchObject({
      state: 'scheduled',
      scheduleKind: 'time',
      scheduledFor: due,
      scheduledByAccountId: OWNER,
    });
    expect(h.jobs).toEqual([
      { postId: p.id, workspaceId: WS, moment: due.toISOString(), startAfter: due },
    ]);
    expect(h.order).toEqual(['members', 'posts-lock']);
  });

  it('reads summer time with the zone offset of that day', async () => {
    const h = setup();
    const p = h.seed();
    await h.publishing.schedulePost(WS, owner, p.id, at('2027-01-10T09:00'));
    expect(h.store.posts[0]!.scheduledFor).toEqual(new Date('2027-01-10T07:00:00Z'));
  });

  it('changes the time of a scheduled post against the same version: new job, new owner', async () => {
    const h = setup();
    const p = h.seed();
    await h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00'));
    const res = await h.publishing.schedulePost(WS, owner2, p.id, at('2026-11-05T10:30'));
    const due = new Date('2026-11-05T08:30:00Z');
    expect(res.outcome).toBe('scheduled');
    expect(h.store.posts[0]).toMatchObject({
      scheduledFor: due,
      scheduledByAccountId: OWNER_2,
    });
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1]).toMatchObject({ moment: due.toISOString(), startAfter: due });
  });

  it('refuses an operator', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.publishing.schedulePost(WS, operator, p.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(OwnerOnlyError);
    expect(h.jobs).toEqual([]);
  });

  it('refuses a stale version', async () => {
    const h = setup();
    const p = h.seed({ version: 4 });
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(PostDraftChangedError);
    expect(h.jobs).toEqual([]);
  });

  it('requires a workspace time zone', async () => {
    const h = setup({ zone: null });
    const p = h.seed();
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(TimeZoneRequiredError);
  });

  it('refuses when the zone differs from the one the dialog showed', async () => {
    const h = setup({ zone: 'Europe/Warsaw' });
    const p = h.seed();
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00', 'Europe/Kyiv')),
    ).rejects.toBeInstanceOf(TimeZoneChangedError);
    expect(h.jobs).toEqual([]);
  });

  it('refuses a time less than 2 minutes ahead and accepts exactly 2 minutes', async () => {
    const h = setup(); // now 14:00 Kyiv
    const p = h.seed();
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2026-11-03T14:01')),
    ).rejects.toBeInstanceOf(PostScheduleOutOfRangeError);
    const res = await h.publishing.schedulePost(WS, owner, p.id, at('2026-11-03T14:02'));
    expect(res.outcome).toBe('scheduled');
  });

  it('refuses a time more than 90 days ahead', async () => {
    const h = setup();
    const p = h.seed();
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2027-02-05T14:01')),
    ).rejects.toBeInstanceOf(PostScheduleOutOfRangeError);
    expect(h.jobs).toEqual([]);
  });

  it('refuses a local time the daylight-saving change skips', async () => {
    const h = setup({ now: new Date('2027-03-20T10:00:00Z') });
    const p = h.seed();
    // Europe/Kyiv jumps from 03:00 to 04:00 on 2027-03-28.
    await expect(
      h.publishing.schedulePost(WS, owner, p.id, at('2027-03-28T03:30')),
    ).rejects.toBeInstanceOf(PostTimeDoesNotExistError);
    expect(h.jobs).toEqual([]);
  });

  it('reads a repeated local time as its first occurrence', async () => {
    const h = setup({ now: new Date('2027-10-20T10:00:00Z') });
    const p = h.seed();
    // Europe/Kyiv repeats 03:00-04:00 on 2027-10-31; the first 03:30 is still summer time (UTC+3).
    await h.publishing.schedulePost(WS, owner, p.id, at('2027-10-31T03:30'));
    expect(h.store.posts[0]!.scheduledFor).toEqual(new Date('2027-10-31T00:30:00Z'));
  });

  it('refuses a destination that is unavailable and a bot that is not working', async () => {
    const a = setup();
    a.store.destinations[0]!.availability = 'unavailable';
    a.store.destinations[0]!.problem = 'no_post_right';
    const pa = a.seed();
    await expect(
      a.publishing.schedulePost(WS, owner, pa.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(DestinationUnavailableError);

    const b = setup({ bot: { state: 'disconnected', telegramBotId: BOT } });
    const pb = b.seed();
    await expect(
      b.publishing.schedulePost(WS, owner, pb.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(PostsNeedWorkingBotError);
  });

  it('refuses a draft when 100 posts are already waiting, but still lets one of them change time', async () => {
    const h = setup();
    h.seedScheduled(100);
    const draft = h.seed();
    await expect(
      h.publishing.schedulePost(WS, owner, draft.id, at('2026-11-04T09:00')),
    ).rejects.toBeInstanceOf(PostScheduledLimitReachedError);
    expect(h.jobs).toEqual([]);

    const waiting = h.store.posts.find((p) => p.state === 'scheduled')!;
    const res = await h.publishing.schedulePost(WS, owner, waiting.id, at('2026-11-05T10:00'));
    expect(res.outcome).toBe('scheduled');
  });

  it('does not apply the daily limit when scheduling (it is checked when the post goes out)', async () => {
    const h = setup();
    h.seedSent(30, (i) => i + 1);
    const p = h.seed();
    const res = await h.publishing.schedulePost(WS, owner, p.id, at('2026-11-04T09:00'));
    expect(res.outcome).toBe('scheduled');
  });
});
