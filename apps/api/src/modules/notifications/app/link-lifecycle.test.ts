import { describe, expect, it } from 'vitest';
import { at, notificationsHarness, T0 } from './fakes.js';
import { createLinkLifecycle } from './link-lifecycle.js';
import type { TelegramLink } from './ports.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const W2 = '0199a000-0000-7000-8000-0000000000a2';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';
const X = 100001n;
const Y = 100002n;

function setup() {
  const h = notificationsHarness();
  const lifecycle = createLinkLifecycle({
    links: h.links,
    connectLinks: h.connectLinks,
    signals: h.signalPort,
    clock: h.clock,
  });
  let n = 0;
  const link = (
    accountId: string,
    o: { workspaceId?: string; bot?: bigint } = {},
  ): TelegramLink => {
    const row: TelegramLink = {
      id: `tl-${++n}`,
      workspaceId: o.workspaceId ?? W,
      accountId,
      telegramBotId: o.bot ?? X,
      telegramUserId: BigInt(900 + n),
      displayName: 'Ann T',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
    };
    h.links.rows.push(row);
    return row;
  };
  const connectLink = (accountId: string, o: { workspaceId?: string; usedAt?: Date } = {}) => {
    h.connectLinks.rows.push({
      id: `cl-${++n}`,
      workspaceId: o.workspaceId ?? W,
      accountId,
      tokenHash: Buffer.from(String(n)),
      createdAt: at(-30),
      expiresAt: at(570),
      usedAt: o.usedAt ?? null,
      replacedAt: null,
    });
    return h.connectLinks.rows.at(-1)!;
  };
  return { h, lifecycle, link, connectLink, tx: {} as never };
}

describe('removeLinkOnDeactivation (flow 15)', () => {
  it('removes the live link as deactivated, clears the id and name, and signals that account', async () => {
    const s = setup();
    const row = s.link(A);
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(5) });
    expect(row).toMatchObject({
      removedAt: at(5),
      removedReason: 'deactivated',
      telegramUserId: null,
      displayName: null,
    });
    expect(s.h.signals).toEqual([{ workspaceId: W, accountId: A }]);
    expect(s.h.jobs).toEqual([]);
  });

  it("marks the member's unused connect links replaced; a used one stays", async () => {
    const s = setup();
    s.link(A);
    const unused = s.connectLink(A);
    const used = s.connectLink(A, { usedAt: at(-10) });
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(5) });
    expect(unused.replacedAt).toEqual(at(5));
    expect(used.replacedAt).toBeNull();
  });

  it('a member with no link: connect links replaced, no signal', async () => {
    const s = setup();
    const pending = s.connectLink(A);
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(5) });
    expect(pending.replacedAt).toEqual(at(5));
    expect(s.h.signals).toEqual([]);
  });

  it('touches nothing of a teammate or of another workspace', async () => {
    const s = setup();
    const mine = s.link(A);
    const teammate = s.link(B);
    const elsewhere = s.link(A, { workspaceId: W2 });
    const elsewhereLink = s.connectLink(A, { workspaceId: W2 });
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(5) });
    expect(mine.removedAt).toEqual(at(5));
    expect(teammate.removedAt).toBeNull();
    expect(elsewhere.removedAt).toBeNull();
    expect(elsewhereLink.replacedAt).toBeNull();
  });

  it('a second run is a no-op', async () => {
    const s = setup();
    s.link(A);
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(5) });
    await s.lifecycle.removeLinkOnDeactivation(s.tx, { workspaceId: W, accountId: A, at: at(6) });
    expect(s.h.signals).toHaveLength(1);
  });
});

describe('onBotConnected (flow 16)', () => {
  it('removes every live link made with another bot as bot_replaced, one signal per account', async () => {
    const s = setup();
    const a = s.link(A, { bot: Y });
    const b = s.link(B, { bot: Y });
    await s.lifecycle.onBotConnected(s.tx, { workspaceId: W, telegramBotId: X });
    for (const row of [a, b]) {
      expect(row).toMatchObject({
        removedAt: T0,
        removedReason: 'bot_replaced',
        telegramUserId: null,
        displayName: null,
      });
    }
    expect(s.h.signals).toEqual([
      { workspaceId: W, accountId: A },
      { workspaceId: W, accountId: B },
    ]);
    expect(s.h.jobs).toEqual([]);
  });

  it('a rotation (same Telegram bot id) keeps every link and signals nothing', async () => {
    const s = setup();
    const a = s.link(A, { bot: X });
    await s.lifecycle.onBotConnected(s.tx, { workspaceId: W, telegramBotId: X });
    expect(a.removedAt).toBeNull();
    expect(s.h.signals).toEqual([]);
  });

  it('leaves the links of another workspace alone', async () => {
    const s = setup();
    const other = s.link(A, { workspaceId: W2, bot: Y });
    await s.lifecycle.onBotConnected(s.tx, { workspaceId: W, telegramBotId: X });
    expect(other.removedAt).toBeNull();
  });
});
