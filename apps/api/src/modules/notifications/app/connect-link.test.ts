import { describe, expect, it } from 'vitest';
import {
  AccessRemovedError,
  ConnectLinkLimitReachedError,
  PingsNeedWorkingBotError,
  TelegramAlreadyLinkedError,
} from '../../../platform/errors.js';
import { hashToken, CONNECT_LINK_TTL_MS } from '../domain/connect-link.js';
import { at, notificationsHarness } from './fakes.js';
import { createConnectLinkIssuer } from './connect-link.js';
import { createSettings } from './settings.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';
const input = { workspaceId: W, accountId: A, role: 'operator' as const };

function setup() {
  const h = notificationsHarness();
  h.setBot(W);
  h.addMember(W, A);
  h.addMember(W, B);
  const settings = createSettings({ links: h.links, bots: h.botPort });
  const issuer = createConnectLinkIssuer({
    transaction: h.transaction,
    membership: h.membership,
    links: h.links,
    connectLinks: h.connectLinks,
    bots: h.botPort,
    settings,
    clock: h.clock,
    randomBytes: h.randomBytes,
  });
  return { h, issuer };
}

describe('createConnectLink (AC-04, AC-05, AC-06, AC-12, AC-13)', () => {
  it('reads the bot inside its own transaction, never on a second connection (B4)', async () => {
    const { h, issuer } = setup();
    await issuer.createConnectLink(input);
    h.setBot(W, { state: 'needs_token' });
    await expect(issuer.createConnectLink({ ...input, accountId: B })).rejects.toBeInstanceOf(
      PingsNeedWorkingBotError,
    );
    expect(h.botReads.length).toBeGreaterThanOrEqual(3);
    expect(h.botReads.every((tx) => tx !== undefined)).toBe(true);
  });

  it('issues a t.me link, stores only the hash, expires in 10 minutes', async () => {
    const { h, issuer } = setup();
    const issued = await issuer.createConnectLink(input);
    expect(issued.workspace_id).toBe(W);
    expect(issued.bot_username).toBe('acme_bot');
    expect(issued.url).toMatch(/^https:\/\/t\.me\/acme_bot\?start=tgi_[A-Za-z0-9_-]{43}$/);
    expect(issued.expires_at).toBe(new Date(at(0).getTime() + CONNECT_LINK_TTL_MS).toISOString());
    const token = issued.url.split('start=tgi_')[1]!;
    expect(h.connectLinks.rows).toHaveLength(1);
    const row = h.connectLinks.rows[0]!;
    expect(row.tokenHash.equals(hashToken(token))).toBe(true);
    expect(row.accountId).toBe(A);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('a newer link replaces the previous unused one', async () => {
    const { h, issuer } = setup();
    await issuer.createConnectLink(input);
    h.clock.advance(1000);
    await issuer.createConnectLink(input);
    const [first, second] = h.connectLinks.rows;
    expect(first!.replacedAt).toEqual(at(1));
    expect(second!.replacedAt).toBeNull();
  });

  it('takes the membership lock before the issuing lock', async () => {
    const { h, issuer } = setup();
    await issuer.createConnectLink(input);
    expect(h.events).toEqual(['lock-membership']);
    expect(h.connectLinks.locks).toEqual([`${W}:${A}`]);
  });

  it('not an active member: ACCESS_REMOVED, nothing created', async () => {
    const { h, issuer } = setup();
    h.members.get(W)!.delete(A);
    await expect(issuer.createConnectLink(input)).rejects.toBeInstanceOf(AccessRemovedError);
    expect(h.connectLinks.rows).toHaveLength(0);
  });

  it('the 6th request in 10 minutes: 429 with retry_at = oldest + 10 min, no row', async () => {
    const { h, issuer } = setup();
    for (let i = 0; i < 5; i += 1) {
      await issuer.createConnectLink(input);
      h.clock.advance(10_000);
    }
    const err = await issuer.createConnectLink(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectLinkLimitReachedError);
    expect((err as ConnectLinkLimitReachedError).details).toMatchObject({
      limit: 5,
      window_seconds: 600,
      retry_at: at(600).toISOString(),
    });
    expect(h.connectLinks.rows).toHaveLength(5);
  });

  it('the limit is per member', async () => {
    const { h, issuer } = setup();
    for (let i = 0; i < 5; i += 1) await issuer.createConnectLink(input);
    await expect(issuer.createConnectLink({ ...input, accountId: B })).resolves.toBeDefined();
    expect(h.connectLinks.rows).toHaveLength(6);
  });

  it('after the window, a new link is allowed again', async () => {
    const { h, issuer } = setup();
    for (let i = 0; i < 5; i += 1) await issuer.createConnectLink(input);
    h.clock.advance(601_000);
    await expect(issuer.createConnectLink(input)).resolves.toBeDefined();
  });

  it('already linked: 409 with the connected settings, no row; limit is checked first', async () => {
    const { h, issuer } = setup();
    h.links.rows.push({
      id: 'l1',
      workspaceId: W,
      accountId: A,
      telegramBotId: 100001n,
      telegramUserId: 555n,
      displayName: 'Ann',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
    });
    const err = await issuer.createConnectLink(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramAlreadyLinkedError);
    expect(
      ((err as TelegramAlreadyLinkedError).details as { settings: { telegram: { state: string } } })
        .settings.telegram.state,
    ).toBe('connected');
    expect(h.connectLinks.rows).toHaveLength(0);
  });

  it.each(['needs_token', 'taken_over', 'disconnected'] as const)(
    'bot %s: PINGS_NEED_WORKING_BOT with settings, no row',
    async (state) => {
      const { h, issuer } = setup();
      h.setBot(W, { state });
      const err = await issuer.createConnectLink(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PingsNeedWorkingBotError);
      expect(
        ((err as PingsNeedWorkingBotError).details as { settings: { can_connect: boolean } })
          .settings.can_connect,
      ).toBe(false);
      expect(h.connectLinks.rows).toHaveLength(0);
    },
  );

  it('no bot: PINGS_NEED_WORKING_BOT', async () => {
    const { h, issuer } = setup();
    h.bots.clear();
    await expect(issuer.createConnectLink(input)).rejects.toBeInstanceOf(PingsNeedWorkingBotError);
  });
});
