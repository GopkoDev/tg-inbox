import { describe, expect, it } from 'vitest';
import { hashToken, newConnectToken, CONNECT_LINK_TTL_MS } from '../domain/connect-link.js';
import { at, notificationsHarness, T0 } from './fakes.js';
import { createIntercept } from './intercept.js';
import { createRedeem } from './redeem.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const A = '0199a000-0000-7000-8000-0000000000b1';
const BOT = 100001n;
const OTHER_BOT = 100002n;
const from = {
  telegramUserId: 777n,
  firstName: 'Ann',
  lastName: 'T',
  username: 'ann_t',
  languageCode: 'en',
};
const msg = (o: Partial<Parameters<ReturnType<typeof createIntercept>['intercept']>[0]> = {}) => ({
  workspaceId: W,
  telegramBotId: BOT,
  from,
  kind: 'text' as const,
  text: 'ok',
  edited: false,
  ...o,
});

function setup() {
  const h = notificationsHarness();
  h.addMember(W, A);
  const redeem = createRedeem({
    transaction: h.transaction,
    membership: h.membership,
    links: h.links,
    connectLinks: h.connectLinks,
    signals: h.signalPort,
    enqueue: h.enqueue,
    clock: h.clock,
  });
  const { intercept } = createIntercept({
    transaction: h.transaction,
    links: h.links,
    redeem,
    enqueue: h.enqueue,
    clock: h.clock,
  });
  const link = (o: { telegramBotId?: bigint; telegramUserId?: bigint; removed?: boolean } = {}) =>
    h.links.rows.push({
      id: 'tl-1',
      workspaceId: W,
      accountId: A,
      telegramBotId: o.telegramBotId ?? BOT,
      telegramUserId: o.telegramUserId ?? 777n,
      displayName: 'Ann',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: o.removed ? at(-1) : null,
      removedReason: o.removed ? 'member' : null,
    });
  const issue = () => {
    const token = newConnectToken(new Uint8Array(32).fill(9));
    h.connectLinks.rows.push({
      id: 'cl-1',
      workspaceId: W,
      accountId: A,
      tokenHash: hashToken(token),
      createdAt: T0,
      expiresAt: new Date(T0.getTime() + CONNECT_LINK_TTL_MS),
      usedAt: null,
      replacedAt: null,
    });
    return token;
  };
  return { h, intercept, link, issue };
}

describe('intercept (AC-04, AC-11)', () => {
  it('a connect-link start is redeemed and consumed', async () => {
    const { h, intercept, issue } = setup();
    const token = issue();
    expect(await intercept(msg({ text: `/start tgi_${token}` }))).toBe('consumed');
    expect(h.links.rows).toHaveLength(1);
    expect(h.links.rows[0]).toMatchObject({
      displayName: 'Ann T',
      telegramUserId: 777n,
      telegramBotId: BOT,
    });
    expect(h.jobs.map((j) => j.message.kind)).toEqual(['connected']);
  });

  it('a start with an unknown token is consumed too and answered link_expired', async () => {
    const { h, intercept } = setup();
    expect(await intercept(msg({ text: `/start tgi_${'x'.repeat(43)}` }))).toBe('consumed');
    expect(h.jobs).toEqual([
      { workspaceId: W, message: { kind: 'link_expired', telegramUserId: 777n } },
    ]);
  });

  it('a connect-link start from an already linked sender is redeemed (already connected)', async () => {
    const { h, intercept, link, issue } = setup();
    link();
    const token = issue();
    expect(await intercept(msg({ text: `/start tgi_${token}` }))).toBe('consumed');
    expect(h.jobs.map((j) => j.message.kind)).toEqual(['already_connected']);
  });

  it('a start in a caption or an edit is not a connect-link start', async () => {
    const { h, intercept, issue } = setup();
    const token = issue();
    expect(await intercept(msg({ kind: 'photo', text: `/start tgi_${token}` }))).toBe('pass');
    expect(await intercept(msg({ text: `/start tgi_${token}`, edited: true }))).toBe('pass');
    expect(h.connectLinks.rows[0]!.usedAt).toBeNull();
    expect(h.links.rows).toEqual([]);
  });

  it('anything from a linked sender with this bot is consumed: text, media, edits, campaign starts', async () => {
    const { intercept, link } = setup();
    link();
    for (const m of [
      msg(),
      msg({ kind: 'photo', text: null }),
      msg({ edited: true }),
      msg({ text: '/start promo' }),
      msg({ text: '/start tgi_short' }),
    ]) {
      expect(await intercept(m)).toBe('consumed');
    }
  });

  it('sends at most one chat_only_notifications per hour', async () => {
    const { h, intercept, link } = setup();
    link();
    await intercept(msg());
    await intercept(msg());
    h.clock.advance(59 * 60_000);
    await intercept(msg());
    expect(h.jobs).toEqual([
      { workspaceId: W, message: { kind: 'chat_only_notifications', telegramLinkId: 'tl-1' } },
    ]);
    h.clock.advance(2 * 60_000);
    await intercept(msg());
    expect(h.jobs).toHaveLength(2);
  });

  it('a sender without a live link passes, including a campaign start', async () => {
    const { h, intercept } = setup();
    expect(await intercept(msg())).toBe('pass');
    expect(await intercept(msg({ text: '/start promo' }))).toBe('pass');
    expect(h.jobs).toEqual([]);
  });

  it('a disconnected member passes again', async () => {
    const { intercept, link } = setup();
    link({ removed: true });
    expect(await intercept(msg())).toBe('pass');
  });

  it('a link made with another bot does not count: pass, no notice', async () => {
    const { h, intercept, link } = setup();
    link({ telegramBotId: OTHER_BOT });
    expect(await intercept(msg())).toBe('pass');
    expect(h.jobs).toEqual([]);
  });

  it('the Telegram account of a link in another workspace does not count', async () => {
    const { intercept, link } = setup();
    link();
    expect(await intercept(msg({ workspaceId: '0199a000-0000-7000-8000-0000000000a2' }))).toBe(
      'pass',
    );
  });
});
