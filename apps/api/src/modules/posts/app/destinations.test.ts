import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import {
  DestinationLimitReachedError,
  NotFoundError,
  OwnerOnlyError,
  PostsNeedWorkingBotError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { CODE_TTL_MS, hashCode } from '../domain/connect-code.js';
import type { CodeRecord } from '../infra/code-repo.js';
import { createChatEvents } from './chat-events.js';
import { createDestinationReads } from './destination-reads.js';
import { createDestinations } from './destinations.js';
import { createPostingTimeZone } from './time-zone.js';
import {
  basePost,
  basePostDestination,
  fakePostRepo,
  fakeStore,
  fakeTransaction,
} from './test-fakes.js';

const T0 = new Date('2026-11-03T09:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const OWNER = newId();
const OPERATOR = newId();
const BOT = 111n;
const CHAT = -1001234567890n;
const owner = { accountId: OWNER, role: 'owner' as const };
const operator = { accountId: OPERATOR, role: 'operator' as const };

function setup(o: { botId?: bigint | null; botState?: string; canPost?: boolean } = {}) {
  const store = fakeStore();
  const codes: CodeRecord[] = [];
  const log = { signals: [] as string[], deleted: [] as string[], locks: [] as string[] };
  const clock = fixedClock(T0);
  const posts = fakePostRepo(store);
  const botId = o.botId === undefined ? BOT : o.botId;
  const readiness = async () =>
    botId === null
      ? null
      : {
          state: (o.botState ?? 'connected') as never,
          telegramBotId: botId,
          sendPausedUntil: null,
        };

  const destinationRepo = {
    async countLive(ws: string) {
      return store.destinations.filter((d) => d.workspaceId === ws && !d.removedAt).length;
    },
    async find(ws: string, id: string) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id);
      return d ? { ...d } : null;
    },
    async lock(ws: string, id: string) {
      return destinationRepo.find(ws, id);
    },
    async findByChat(ws: string, chatId: bigint) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.chatId === chatId);
      return d ? { ...d } : null;
    },
    async listLive(ws: string) {
      return store.destinations
        .filter((d) => d.workspaceId === ws && !d.removedAt)
        .map((d) => ({ ...d }));
    },
    async insert(ws: string, d: Record<string, unknown>) {
      const rec = basePostDestination({ ...(d as object), workspaceId: ws } as never);
      store.destinations.push(rec);
      return { ...rec };
    },
    async revive(ws: string, id: string, v: Record<string, unknown>) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id);
      if (!d) return null;
      Object.assign(d, v, { removedAt: null, removedByAccountId: null });
      return { ...d };
    },
    async remove(ws: string, id: string, by: string, at: Date) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id && !x.removedAt);
      if (!d) return false;
      d.removedAt = at;
      d.removedByAccountId = by;
      return true;
    },
    async setAvailability(
      ws: string,
      id: string,
      v: { availability: 'available' | 'unavailable'; problem: never; membershipChangedAt: Date },
    ) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id);
      if (!d || d.membershipChangedAt > v.membershipChangedAt) return false;
      Object.assign(d, v);
      return true;
    },
    async rename(ws: string, id: string, v: { title: string; username: string | null }) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id);
      if (!d) return false;
      Object.assign(d, v);
      return true;
    },
    async migrateChatId(ws: string, id: string, chatId: bigint) {
      const d = store.destinations.find((x) => x.workspaceId === ws && x.id === id);
      if (!d) return false;
      d.chatId = chatId;
      return true;
    },
  };

  const codeRepo = {
    async insert(
      ws: string,
      c: { id: string; accountId: string; codeHash: Buffer; createdAt: Date; expiresAt: Date },
    ) {
      const rec: CodeRecord = {
        ...c,
        workspaceId: ws,
        replacedAt: null,
        usedAt: null,
        destinationId: null,
        result: null,
        resultAt: null,
      };
      codes.push(rec);
      return { ...rec };
    },
    async find(ws: string, id: string) {
      const c = codes.find((x) => x.workspaceId === ws && x.id === id);
      return c ? { ...c } : null;
    },
    async findByHash(ws: string, hash: Buffer) {
      const c = codes.find((x) => x.workspaceId === ws && x.codeHash.equals(hash));
      return c ? { ...c } : null;
    },
    async replacePrevious(ws: string, accountId: string, at: Date) {
      let n = 0;
      for (const c of codes) {
        if (
          c.workspaceId === ws &&
          c.accountId === accountId &&
          !c.usedAt &&
          !c.replacedAt &&
          c.expiresAt > at
        ) {
          c.replacedAt = at;
          n++;
        }
      }
      return n;
    },
    async markUsed(ws: string, id: string, destinationId: string, at: Date) {
      const c = codes.find((x) => x.workspaceId === ws && x.id === id);
      if (!c || c.usedAt || c.replacedAt) return false;
      Object.assign(c, { usedAt: at, destinationId, result: 'connected', resultAt: at });
      return true;
    },
    async markResult(ws: string, id: string, result: 'no_post_right', at: Date) {
      const c = codes.find((x) => x.workspaceId === ws && x.id === id);
      if (!c || c.usedAt) return false;
      Object.assign(c, { result, resultAt: at });
      return true;
    },
  };

  const shared = {
    transaction: fakeTransaction(),
    codes: codeRepo,
    destinations: destinationRepo,
    clock,
    signals: {
      async destinationsChanged(_tx: Db, ws: string) {
        log.signals.push(`dest:${ws}`);
      },
      async postChanged(_tx: Db, ws: string, id: string) {
        log.signals.push(`post:${ws}:${id}`);
      },
    },
  };
  const workspaces = {
    async lockActiveMembers(_tx: Db, ws: string, ids: readonly string[]) {
      log.locks.push('members');
      return ids.filter((i) => store.active.has(`${ws}:${i}`));
    },
  };
  store.active.add(`${WS}:${OWNER}`);
  store.active.add(`${WS}:${OPERATOR}`);
  const lockPosts = async (_tx: Db, ws: string) => {
    log.locks.push(`posts:${ws}`);
  };

  const destinations = createDestinations({
    ...shared,
    posts,
    workspaces,
    lockPosts,
    bots: { postReadiness: readiness, botUsername: async () => 'test_business_bot' },
  });
  const events = createChatEvents({
    ...shared,
    lockPosts,
    bots: {
      postReadiness: readiness,
      botRights: async () => ({ canPost: o.canPost ?? true }),
      async deletePost(r: { chatId: string; messageId: bigint }) {
        log.deleted.push(`${r.chatId}:${r.messageId}`);
        return { outcome: 'deleted' as const };
      },
    },
  });
  const reads = createDestinationReads({
    destinations: destinationRepo,
    posts,
    workspaces: {
      async displayNames(_ws: string, ids: readonly string[]) {
        return new Map(ids.map((i) => [i, 'Olena']));
      },
    },
    workspaceSettings: { timeZone: async () => 'Europe/Kyiv' },
    currentBotId: async () => botId,
  });
  return {
    store,
    codes,
    log,
    clock,
    destinations,
    events,
    reads,
    posts,
    destinationRepo,
    workspaces,
    lockPosts,
  };
}

type Harness = ReturnType<typeof setup>;

const codeEvent = (code: string, over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  telegramBotId: BOT,
  chatId: CHAT,
  kind: 'channel' as const,
  title: 'Acme Flowers News',
  username: null,
  messageId: 77n,
  code,
  ...over,
});

describe('createCode / getCode (AC-01, AC-02, AC-03)', () => {
  it('owner gets a code valid for 10 minutes; only its hash is stored; locks memberships then posts', async () => {
    const h = setup();
    const c = await h.destinations.createCode(WS, owner);
    expect(c.code).toMatch(/^tgp_[A-Za-z0-9_-]{22,64}$/);
    expect(c.group_command).toBe(`/connect@test_business_bot ${c.code}`);
    expect(c.expires_at).toBe(new Date(T0.getTime() + CODE_TTL_MS).toISOString());
    expect(h.codes).toHaveLength(1);
    expect(h.codes[0]!.codeHash.equals(hashCode(c.code))).toBe(true);
    expect(h.log.locks).toEqual(['members', `posts:${WS}`]);
  });

  it('a new code replaces the owner previous live one', async () => {
    const h = setup();
    const first = await h.destinations.createCode(WS, owner);
    await h.destinations.createCode(WS, owner);
    expect(h.codes.find((x) => x.id === first.id)!.replacedAt).toEqual(T0);
    expect((await h.destinations.getCode(WS, owner, first.id)).status).toBe('replaced');
  });

  it('an operator is refused: only a business owner connects', async () => {
    const h = setup();
    await expect(h.destinations.createCode(WS, operator)).rejects.toBeInstanceOf(OwnerOnlyError);
    expect(h.codes).toHaveLength(0);
  });

  it('refuses without a working bot', async () => {
    const h = setup({ botState: 'needs_token' });
    await expect(h.destinations.createCode(WS, owner)).rejects.toBeInstanceOf(
      PostsNeedWorkingBotError,
    );
    const none = setup({ botId: null });
    await expect(none.destinations.createCode(WS, owner)).rejects.toBeInstanceOf(
      PostsNeedWorkingBotError,
    );
  });

  it('refuses the 21st destination', async () => {
    const h = setup();
    for (let i = 0; i < 20; i++) {
      h.store.destinations.push(
        basePostDestination({ id: newId(), workspaceId: WS, chatId: BigInt(-i - 1) }),
      );
    }
    await expect(h.destinations.createCode(WS, owner)).rejects.toBeInstanceOf(
      DestinationLimitReachedError,
    );
  });

  it('reads waiting, then expired; another member or workspace gets 404', async () => {
    const h = setup();
    const c = await h.destinations.createCode(WS, owner);
    expect(await h.destinations.getCode(WS, owner, c.id)).toMatchObject({
      status: 'waiting',
      needed_right: null,
      destination_id: null,
    });
    await expect(
      h.destinations.getCode(WS, { accountId: newId(), role: 'owner' }, c.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.destinations.getCode(OTHER_WS, owner, c.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    h.clock.advance(CODE_TTL_MS + 1);
    expect((await h.destinations.getCode(WS, owner, c.id)).status).toBe('expired');
  });
});

async function withCode(h: Harness) {
  return h.destinations.createCode(WS, owner);
}

describe('onDestinationCode (AC-01, AC-02, AC-14)', () => {
  it('connects the channel, spends the code, removes the code message, signals', async () => {
    const h = setup();
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.store.destinations).toHaveLength(1);
    expect(h.store.destinations[0]).toMatchObject({
      workspaceId: WS,
      chatId: CHAT,
      kind: 'channel',
      title: 'Acme Flowers News',
      telegramBotId: BOT,
      availability: 'available',
      connectedByAccountId: OWNER,
    });
    const status = await h.destinations.getCode(WS, owner, c.id);
    expect(status).toMatchObject({
      status: 'connected',
      destination_id: h.store.destinations[0]!.id,
    });
    expect(h.log.deleted).toEqual([`${CHAT}:77`]);
    expect(h.log.signals).toContain(`dest:${WS}`);
  });

  it('a group (supergroup) becomes kind group', async () => {
    const h = setup();
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code, { kind: 'supergroup' }));
    expect(h.store.destinations[0]!.kind).toBe('group');
  });

  it('without the right to post nothing is connected, the right is named, the code stays usable', async () => {
    const h = setup({ canPost: false });
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.store.destinations).toHaveLength(0);
    expect(h.log.deleted).toEqual([]);
    const status = await h.destinations.getCode(WS, owner, c.id);
    expect(status.status).toBe('no_post_right');
    expect(status.needed_right).not.toBeNull();
    expect(h.codes[0]!.usedAt).toBeNull();
  });

  it('an expired code connects nothing', async () => {
    const h = setup();
    const c = await withCode(h);
    h.clock.advance(CODE_TTL_MS + 1);
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.store.destinations).toHaveLength(0);
    expect((await h.destinations.getCode(WS, owner, c.id)).status).toBe('expired');
  });

  it('a used code connects nothing the second time', async () => {
    const h = setup();
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code));
    await h.events.onDestinationCode(
      codeEvent(c.code, { chatId: -1009999999999n, title: 'Other' }),
    );
    expect(h.store.destinations).toHaveLength(1);
  });

  it('a replaced code and an unknown code connect nothing', async () => {
    const h = setup();
    const old = await withCode(h);
    await withCode(h);
    await h.events.onDestinationCode(codeEvent(old.code));
    await h.events.onDestinationCode(codeEvent('tgp_unknownunknownunknownxx'));
    expect(h.store.destinations).toHaveLength(0);
  });

  it('a code of another workspace does not match', async () => {
    const h = setup();
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code, { workspaceId: OTHER_WS }));
    expect(h.store.destinations).toHaveLength(0);
  });

  it('a code received by a different Telegram bot than the current one connects nothing', async () => {
    const h = setup();
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code, { telegramBotId: 999n }));
    expect(h.store.destinations).toHaveLength(0);
  });

  it('a removed destination in the same chat is revived as the same destination', async () => {
    const h = setup();
    const id = newId();
    h.store.destinations.push(
      basePostDestination({
        id,
        workspaceId: WS,
        chatId: CHAT,
        telegramBotId: 5n,
        removedAt: T0,
        removedByAccountId: OWNER,
        availability: 'unavailable',
        problem: 'not_member',
      }),
    );
    const c = await withCode(h);
    await h.events.onDestinationCode(codeEvent(c.code, { title: 'Renamed News' }));
    expect(h.store.destinations).toHaveLength(1);
    expect(h.store.destinations[0]).toMatchObject({
      id,
      removedAt: null,
      telegramBotId: BOT,
      title: 'Renamed News',
      availability: 'available',
      problem: null,
    });
  });
});

describe('membership, upgrade, rename (AC-13, AC-14)', () => {
  const seed = (h: Harness, over = {}) => {
    const d = basePostDestination({
      id: newId(),
      workspaceId: WS,
      chatId: CHAT,
      telegramBotId: BOT,
      ...over,
    });
    h.store.destinations.push(d);
    return d;
  };
  const membership = (over: Record<string, unknown> = {}) => ({
    workspaceId: WS,
    telegramBotId: BOT,
    chatId: CHAT,
    kind: 'channel' as const,
    title: 'Acme Flowers News',
    username: null,
    status: 'administrator',
    canPost: true,
    date: new Date('2026-11-03T09:30:00Z'),
    ...over,
  });

  it('losing the right marks it unavailable no_post_right; regaining marks it available', async () => {
    const h = setup();
    const d = seed(h);
    await h.events.onChatMembership(membership({ canPost: false }));
    expect(h.store.destinations[0]).toMatchObject({
      id: d.id,
      availability: 'unavailable',
      problem: 'no_post_right',
    });
    expect(h.log.signals).toContain(`dest:${WS}`);
    await h.events.onChatMembership(membership({ date: new Date('2026-11-03T09:40:00Z') }));
    expect(h.store.destinations[0]).toMatchObject({ availability: 'available', problem: null });
  });

  it('leaving or being kicked marks it unavailable not_member', async () => {
    const h = setup();
    seed(h);
    await h.events.onChatMembership(membership({ status: 'kicked', canPost: false }));
    expect(h.store.destinations[0]).toMatchObject({
      availability: 'unavailable',
      problem: 'not_member',
    });
  });

  it('an update older than the stored one is ignored', async () => {
    const h = setup();
    seed(h, { membershipChangedAt: new Date('2026-11-03T10:00:00Z') });
    h.log.signals.length = 0;
    await h.events.onChatMembership(membership({ canPost: false }));
    expect(h.store.destinations[0]!.availability).toBe('available');
    expect(h.log.signals).toEqual([]);
  });

  it('a chat that is not a destination (or of another workspace) never becomes one', async () => {
    const h = setup();
    await h.events.onChatMembership(membership());
    seed(h, { workspaceId: OTHER_WS });
    await h.events.onChatMembership(membership({ canPost: false }));
    expect(h.store.destinations).toHaveLength(1);
    expect(h.store.destinations[0]!.availability).toBe('available');
  });

  it('a removed destination is not touched by membership news', async () => {
    const h = setup();
    seed(h, { removedAt: T0 });
    await h.events.onChatMembership(membership({ canPost: false }));
    expect(h.store.destinations[0]!.availability).toBe('available');
  });

  it('an upgraded group keeps working as the same destination under the new chat id', async () => {
    const h = setup();
    const d = seed(h, { kind: 'group' });
    await h.events.onChatMigrated({
      workspaceId: WS,
      telegramBotId: BOT,
      chatId: CHAT,
      newChatId: -1009876543210n,
    });
    expect(h.store.destinations).toHaveLength(1);
    expect(h.store.destinations[0]).toMatchObject({ id: d.id, chatId: -1009876543210n });
    expect(h.log.signals).toContain(`dest:${WS}`);
  });

  it('a rename updates the destination name, nothing for a stranger chat', async () => {
    const h = setup();
    seed(h);
    await h.events.onChatRenamed({
      workspaceId: WS,
      telegramBotId: BOT,
      chatId: CHAT,
      title: 'New Name',
    });
    await h.events.onChatRenamed({
      workspaceId: WS,
      telegramBotId: BOT,
      chatId: -5n,
      title: 'Stranger',
    });
    expect(h.store.destinations).toHaveLength(1);
    expect(h.store.destinations[0]!.title).toBe('New Name');
  });
});

describe('removeDestination (AC-03, Clarifications)', () => {
  it('returns its scheduled posts to drafts with the notice and a new version, signals each', async () => {
    const h = setup();
    const dest = basePostDestination({ id: newId(), workspaceId: WS });
    const other = basePostDestination({ id: newId(), workspaceId: WS, chatId: -2n });
    h.store.destinations.push(dest, other);
    const mine = basePost({
      id: newId(),
      workspaceId: WS,
      destinationId: dest.id,
      state: 'scheduled',
      scheduledFor: new Date('2026-11-04T09:00:00Z'),
    });
    const theirs = basePost({
      id: newId(),
      workspaceId: WS,
      destinationId: other.id,
      state: 'scheduled',
    });
    h.store.posts.push(mine, theirs);

    const res = await h.destinations.removeDestination(WS, owner, dest.id);
    expect(res).toEqual({ outcome: 'removed', returned_to_draft: 1 });
    expect(h.store.destinations.find((d) => d.id === dest.id)).toMatchObject({
      removedAt: T0,
      removedByAccountId: OWNER,
    });
    expect(h.store.posts.find((p) => p.id === mine.id)).toMatchObject({
      state: 'draft',
      draftNotice: 'destination_removed',
      version: 2,
    });
    expect(h.store.posts.find((p) => p.id === theirs.id)!.state).toBe('scheduled');
    expect(h.log.signals).toEqual(expect.arrayContaining([`dest:${WS}`, `post:${WS}:${mine.id}`]));
    expect(h.log.locks.slice(0, 2)).toEqual(['members', `posts:${WS}`]);
  });

  it('removing again answers unchanged', async () => {
    const h = setup();
    const dest = basePostDestination({ id: newId(), workspaceId: WS });
    h.store.destinations.push(dest);
    await h.destinations.removeDestination(WS, owner, dest.id);
    expect(await h.destinations.removeDestination(WS, owner, dest.id)).toEqual({
      outcome: 'unchanged',
      returned_to_draft: 0,
    });
  });

  it('an operator is refused; a foreign or unknown destination is 404', async () => {
    const h = setup();
    const dest = basePostDestination({ id: newId(), workspaceId: WS });
    h.store.destinations.push(dest);
    await expect(h.destinations.removeDestination(WS, operator, dest.id)).rejects.toBeInstanceOf(
      OwnerOnlyError,
    );
    expect(h.store.destinations[0]!.removedAt).toBeNull();
    await expect(h.destinations.removeDestination(OTHER_WS, owner, dest.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('listDestinations (AC-14)', () => {
  it('lists live destinations with scheduled counts, zone and the connecting member', async () => {
    const h = setup();
    const a = basePostDestination({
      id: newId(),
      workspaceId: WS,
      chatId: -1n,
      telegramBotId: BOT,
    });
    h.store.destinations.push(
      a,
      basePostDestination({ id: newId(), workspaceId: WS, chatId: -2n, removedAt: T0 }),
    );
    h.store.posts.push(
      basePost({ id: newId(), workspaceId: WS, destinationId: a.id, state: 'scheduled' }),
      basePost({ id: newId(), workspaceId: WS, destinationId: a.id, state: 'scheduled' }),
      basePost({ id: newId(), workspaceId: WS, destinationId: a.id, state: 'draft' }),
    );
    const list = await h.reads.listDestinations(WS);
    expect(list).toMatchObject({ workspace_id: WS, time_zone: 'Europe/Kyiv', scheduled_total: 2 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: a.id,
      scheduled_count: 2,
      availability: 'available',
      connected_by: { account_id: 'a', display_name: 'Olena' },
    });
  });

  it('a destination of another Telegram bot reads unavailable not_current_bot', async () => {
    const h = setup();
    h.store.destinations.push(
      basePostDestination({ id: newId(), workspaceId: WS, telegramBotId: 5n }),
    );
    const list = await h.reads.listDestinations(WS);
    expect(list.items[0]).toMatchObject({
      availability: 'unavailable',
      problem: 'not_current_bot',
    });
  });
});

describe('setTimeZone (AC-03)', () => {
  function zoneSetup(current: string | null) {
    const h = setup();
    const written: string[] = [];
    h.store.posts.push(
      basePost({ id: newId(), workspaceId: WS, state: 'scheduled' }),
      basePost({ id: newId(), workspaceId: WS, state: 'scheduled' }),
    );
    const tz = createPostingTimeZone({
      transaction: fakeTransaction(),
      posts: h.posts,
      workspaces: h.workspaces,
      lockPosts: h.lockPosts,
      workspaceSettings: {
        timeZone: async () => current,
        async setTimeZone(_tx: Db, _ws: string, zone: string) {
          written.push(zone);
        },
      },
      signals: {
        destinationsChanged: async (_tx: Db, ws: string) => void h.log.signals.push(`dest:${ws}`),
      },
    });
    return { h, tz, written };
  }

  it('an owner saves the zone, reports how many scheduled posts are re-labelled, signals', async () => {
    const { h, tz, written } = zoneSetup('Europe/Kyiv');
    const res = await tz.setTimeZone(WS, owner, 'Europe/Warsaw');
    expect(res).toEqual({ outcome: 'saved', time_zone: 'Europe/Warsaw', relabelled_scheduled: 2 });
    expect(written).toEqual(['Europe/Warsaw']);
    expect(h.log.signals).toContain(`dest:${WS}`);
  });

  it('the same zone is unchanged and writes nothing', async () => {
    const { tz, written } = zoneSetup('Europe/Kyiv');
    expect(await tz.setTimeZone(WS, owner, 'Europe/Kyiv')).toMatchObject({ outcome: 'unchanged' });
    expect(written).toEqual([]);
  });

  it('an operator is refused', async () => {
    const { tz, written } = zoneSetup(null);
    await expect(tz.setTimeZone(WS, operator, 'Europe/Kyiv')).rejects.toBeInstanceOf(
      OwnerOnlyError,
    );
    expect(written).toEqual([]);
  });
});

describe('T26: redeem under the posts lock, the limit, the needed right (AC-01, AC-02)', () => {
  const fill = (h: Harness, n: number) => {
    for (let i = 0; i < n; i++) {
      h.store.destinations.push(
        basePostDestination({ id: newId(), workspaceId: WS, chatId: BigInt(-1000 - i) }),
      );
    }
  };

  it('takes the posts lock before counting or inserting', async () => {
    const h = setup();
    const c = await withCode(h);
    h.log.locks.length = 0;
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.log.locks).toContain(`posts:${WS}`);
  });

  it('a 21st destination is refused and the code shows destination_limit', async () => {
    const h = setup();
    const c = await withCode(h);
    fill(h, 20);
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.store.destinations).toHaveLength(20);
    expect(h.log.deleted).toEqual([]);
    expect((await h.destinations.getCode(WS, owner, c.id)).status).toBe('destination_limit');
  });

  it('reviving a removed destination at the limit is refused too', async () => {
    const h = setup();
    const c = await withCode(h);
    fill(h, 20);
    h.store.destinations.push(
      basePostDestination({
        id: newId(),
        workspaceId: WS,
        chatId: CHAT,
        removedAt: T0,
        removedByAccountId: OWNER,
      } as never),
    );
    await h.events.onDestinationCode(codeEvent(c.code));
    expect(h.store.destinations.find((d) => d.chatId === CHAT)!.removedAt).not.toBeNull();
    expect((await h.destinations.getCode(WS, owner, c.id)).status).toBe('destination_limit');
  });

  it('names send_messages for a group and post_messages for a channel', async () => {
    const g = setup({ canPost: false });
    const gc = await withCode(g);
    await g.events.onDestinationCode(codeEvent(gc.code, { kind: 'supergroup' }));
    expect(await g.destinations.getCode(WS, owner, gc.id)).toMatchObject({
      status: 'no_post_right',
      needed_right: 'send_messages',
    });
    const c = setup({ canPost: false });
    const cc = await withCode(c);
    await c.events.onDestinationCode(codeEvent(cc.code, { kind: 'channel' }));
    expect(await c.destinations.getCode(WS, owner, cc.id)).toMatchObject({
      status: 'no_post_right',
      needed_right: 'post_messages',
    });
  });
});
