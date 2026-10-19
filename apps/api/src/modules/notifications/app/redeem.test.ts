import { describe, expect, it } from 'vitest';
import { hashToken, newConnectToken, CONNECT_LINK_TTL_MS } from '../domain/connect-link.js';
import { at, notificationsHarness, T0 } from './fakes.js';
import type { NewTelegramLink } from './ports.js';
import { createRedeem } from './redeem.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const W2 = '0199a000-0000-7000-8000-0000000000a2';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';
const BOT = 100001n;
const ANN = { id: 777n, displayName: 'Ann T' };

function setup() {
  const h = notificationsHarness();
  h.addMember(W, A);
  h.addMember(W, B);
  const redeem = createRedeem({
    transaction: h.transaction,
    membership: h.membership,
    links: h.links,
    connectLinks: h.connectLinks,
    signals: h.signalPort,
    enqueue: h.enqueue,
    startPings: h.startPings,
    clock: h.clock,
  });
  let n = 0;
  /** A usable link of `accountId` as issued by T10; returns its token. */
  const issue = (
    accountId: string,
    o: { workspaceId?: string; createdAt?: Date; usedAt?: Date; replacedAt?: Date } = {},
  ) => {
    const token = newConnectToken(new Uint8Array(32).fill(++n));
    const createdAt = o.createdAt ?? T0;
    h.connectLinks.rows.push({
      id: `cl-${n}`,
      workspaceId: o.workspaceId ?? W,
      accountId,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + CONNECT_LINK_TTL_MS),
      usedAt: o.usedAt ?? null,
      replacedAt: o.replacedAt ?? null,
    });
    return token;
  };
  const row = (token: string) =>
    h.connectLinks.rows.find((r) => r.tokenHash.equals(hashToken(token)))!;
  const existing = (accountId: string, telegramUserId: bigint, o: { workspaceId?: string } = {}) =>
    h.links.rows.push({
      id: `tl-${accountId.slice(-2)}`,
      workspaceId: o.workspaceId ?? W,
      accountId,
      telegramBotId: BOT,
      telegramUserId,
      displayName: 'Existing',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
    });
  const go = (token: string, from = ANN, workspaceId = W) =>
    redeem.redeem({ workspaceId, telegramBotId: BOT, from, token, at: h.clock.now() });
  return { h, issue, row, existing, go };
}

describe('redeem (AC-04, AC-05, AC-06, AC-12)', () => {
  it('free: links the issued membership with the bot id, uses the link up, signals, enqueues connected', async () => {
    const { h, issue, row, go } = setup();
    const token = issue(A);
    h.clock.advance(60_000);
    expect(await go(token)).toEqual({ outcome: 'linked' });
    expect(h.links.rows).toHaveLength(1);
    expect(h.links.rows[0]).toMatchObject({
      workspaceId: W,
      accountId: A,
      telegramBotId: BOT,
      telegramUserId: 777n,
      displayName: 'Ann T',
      linkedAt: at(60),
      removedAt: null,
    });
    expect(row(token).usedAt).toEqual(at(60));
    expect(h.signals).toEqual([{ workspaceId: W, accountId: A }]);
    expect(h.jobs).toEqual([
      { workspaceId: W, message: { kind: 'connected', telegramLinkId: h.links.rows[0]!.id } },
    ]);
  });

  it("starts the workspace's ping chain in the same transaction as a new link", async () => {
    const { h, issue, go } = setup();
    await go(issue(A));
    expect(h.pingStarts).toEqual([W]);
  });

  it.each([
    ['unknown token', (s: ReturnType<typeof setup>) => s.go('x'.repeat(43))],
    [
      'already connected from this account',
      async (s: ReturnType<typeof setup>) => {
        await s.go(s.issue(A));
        s.h.pingStarts.length = 0;
        return s.go(s.issue(A));
      },
    ],
  ])('%s: no chain is started', async (_name, act) => {
    const s = setup();
    await act(s);
    expect(s.h.pingStarts).toEqual([]);
  });

  it('takes the membership lock before anything else', async () => {
    const { h, issue, go } = setup();
    await go(issue(A));
    expect(h.events).toEqual(['lock-membership']);
  });

  it('unknown token: link_expired to the sender, nothing written', async () => {
    const { h, go } = setup();
    expect(await go('x'.repeat(43))).toEqual({ outcome: 'link_expired' });
    expect(h.links.rows).toEqual([]);
    expect(h.jobs).toEqual([
      { workspaceId: W, message: { kind: 'link_expired', telegramUserId: 777n } },
    ]);
    expect(h.signals).toEqual([]);
  });

  it('a token of another workspace is unknown here (no hint)', async () => {
    const { h, issue, go } = setup();
    const token = issue(A, { workspaceId: W2 });
    expect(await go(token)).toEqual({ outcome: 'link_expired' });
    expect(h.links.rows).toEqual([]);
    expect(h.connectLinks.rows[0]!.usedAt).toBeNull();
  });

  it.each([
    ['expired', (h: ReturnType<typeof setup>['h']) => h.clock.advance(CONNECT_LINK_TTL_MS)],
    ['used', undefined],
    ['replaced', undefined],
  ])('%s link: link_expired, nothing linked', async (kind, tweak) => {
    const { h, issue, go } = setup();
    const token = issue(A, {
      ...(kind === 'used' && { usedAt: at(-1) }),
      ...(kind === 'replaced' && { replacedAt: at(-1) }),
    });
    tweak?.(h);
    expect(await go(token)).toEqual({ outcome: 'link_expired' });
    expect(h.links.rows).toEqual([]);
    expect(h.signals).toEqual([]);
    expect(h.jobs.map((j) => j.message.kind)).toEqual(['link_expired']);
  });

  it('replayed after success: link_expired', async () => {
    const { h, issue, go } = setup();
    const token = issue(A);
    await go(token);
    expect(await go(token)).toEqual({ outcome: 'link_expired' });
    expect(h.links.rows).toHaveLength(1);
    expect(h.signals).toHaveLength(1);
  });

  it('membership not active: the link is used up, link_expired, nothing linked', async () => {
    const { h, issue, row, go } = setup();
    h.members.get(W)!.delete(A);
    const token = issue(A);
    expect(await go(token)).toEqual({ outcome: 'link_expired' });
    expect(row(token).usedAt).toEqual(T0);
    expect(h.links.rows).toEqual([]);
    expect(h.signals).toEqual([]);
    expect(h.jobs.map((j) => j.message.kind)).toEqual(['link_expired']);
  });

  it('the Telegram account belongs to a teammate: used up, cannot_connect (teammate)', async () => {
    const { h, issue, row, existing, go } = setup();
    existing(B, 777n);
    const token = issue(A);
    expect(await go(token)).toEqual({
      outcome: 'cannot_connect',
      reason: 'telegram_linked_to_teammate',
    });
    expect(row(token).usedAt).toEqual(T0);
    expect(h.links.rows).toHaveLength(1);
    expect(h.signals).toEqual([]);
    expect(h.jobs).toEqual([
      {
        workspaceId: W,
        message: {
          kind: 'cannot_connect',
          telegramUserId: 777n,
          reason: 'telegram_linked_to_teammate',
        },
      },
    ]);
  });

  it('the Telegram account is linked in another workspace only: still free here', async () => {
    const { h, issue, existing, go } = setup();
    existing(B, 777n, { workspaceId: W2 });
    expect(await go(issue(A))).toEqual({ outcome: 'linked' });
    expect(h.links.rows).toHaveLength(2);
  });

  it('the member is linked from another Telegram account: used up, cannot_connect (elsewhere)', async () => {
    const { h, issue, row, existing, go } = setup();
    existing(A, 999n);
    const token = issue(A);
    expect(await go(token)).toEqual({
      outcome: 'cannot_connect',
      reason: 'member_linked_elsewhere',
    });
    expect(row(token).usedAt).toEqual(T0);
    expect(h.links.rows).toHaveLength(1);
    expect(h.links.rows[0]!.telegramUserId).toBe(999n);
    expect(h.jobs[0]!.message).toMatchObject({ kind: 'cannot_connect', telegramUserId: 777n });
  });

  it('the member is already linked from this account: used up, already_connected, no signal', async () => {
    const { h, issue, row, existing, go } = setup();
    existing(A, 777n);
    const token = issue(A);
    expect(await go(token)).toEqual({ outcome: 'already_connected' });
    expect(row(token).usedAt).toEqual(T0);
    expect(h.signals).toEqual([]);
    expect(h.jobs).toEqual([
      {
        workspaceId: W,
        message: { kind: 'already_connected', telegramLinkId: h.links.rows[0]!.id },
      },
    ]);
  });

  it('a race on the partial unique indexes is re-decided on the winner (no deadlock, no double link)', async () => {
    const { h, issue, go } = setup();
    const realInsert = h.links.insert.bind(h.links);
    let raced = false;
    h.links.insert = async (w, link: NewTelegramLink, tx) => {
      if (!raced) {
        raced = true;
        // A teammate's redeem of the same Telegram account committed between our reads and our insert.
        h.links.rows.push({
          id: 'winner',
          workspaceId: W,
          accountId: B,
          telegramBotId: BOT,
          telegramUserId: link.telegramUserId,
          displayName: 'Winner',
          linkedAt: h.clock.now(),
          blockedAt: null,
          lastNoticeAt: null,
          removedAt: null,
          removedReason: null,
        });
        return { ok: false, reason: 'telegram_user_linked' };
      }
      return realInsert(w, link, tx);
    };
    expect(await go(issue(A))).toEqual({
      outcome: 'cannot_connect',
      reason: 'telegram_linked_to_teammate',
    });
    expect(h.links.rows.map((r) => r.id)).toEqual(['winner']);
    expect(h.jobs.map((j) => j.message.kind)).toEqual(['cannot_connect']);
  });
});
