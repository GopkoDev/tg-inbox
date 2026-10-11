import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { NotFoundError, ResetLinkInvalidError, ValidationError } from '../../../platform/errors.js';
import { createAccountUseCases } from './accounts.js';
import {
  fakeAccountRepo,
  fakeFailureRepo,
  fakeHasher,
  fakeResetLinkRepo,
  fakeSessionRepo,
  fakeTransaction,
} from './fakes.js';
import { createResetLinkUseCases } from './reset-links.js';
import { createSessionUseCases } from './sessions.js';

const HOUR = 3_600_000;

async function setup() {
  const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
  const accounts = fakeAccountRepo();
  const failures = fakeFailureRepo();
  const sessions = fakeSessionRepo();
  const links = fakeResetLinkRepo();
  const hasher = fakeHasher();
  const sessionUseCases = createSessionUseCases({ sessions, clock });
  const account = await createAccountUseCases({ accounts, hasher, clock }).createAccount({
    email: 'bob@x.com',
    displayName: 'Bob',
    password: 'old-password-1',
  });
  const uc = createResetLinkUseCases({
    accounts,
    links,
    sessions,
    failures,
    hasher,
    clock,
    sessionUseCases,
    transaction: fakeTransaction,
    publicWebUrl: 'https://panel.example',
  });
  const tokenOf = (link: string) => link.split('/reset-password/')[1]!;
  return {
    clock,
    accounts,
    failures,
    sessions,
    links,
    hasher,
    uc,
    account,
    tokenOf,
    sessionUseCases,
  };
}

describe('issueResetLink', () => {
  it('returns the link once and stores only the hash', async () => {
    const { uc, links, account, clock, tokenOf } = await setup();
    const r = await uc.issueResetLink(' BOB@x.com ');
    expect(r.accountId).toBe(account.id);
    expect(r.link).toMatch(/^https:\/\/panel\.example\/reset-password\/[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt.getTime()).toBe(clock.now().getTime() + 24 * HOUR);
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]!.tokenHash.toString('base64url')).not.toBe(tokenOf(r.link));
  });

  it('refuses an unknown email with NotFoundError', async () => {
    const { uc } = await setup();
    await expect(uc.issueResetLink('ghost@x.com')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-21: a new link supersedes the earlier unused one', async () => {
    const { uc, tokenOf, links } = await setup();
    const first = await uc.issueResetLink('bob@x.com');
    await uc.issueResetLink('bob@x.com');
    expect(links.rows.map((r) => r.state)).toEqual(['superseded', 'pending']);
    await expect(uc.lookUpResetLink(tokenOf(first.link))).rejects.toBeInstanceOf(
      ResetLinkInvalidError,
    );
  });
});

describe('lookUpResetLink', () => {
  it('accepts a pending link and refuses unknown tokens', async () => {
    const { uc, tokenOf } = await setup();
    const { link } = await uc.issueResetLink('bob@x.com');
    await expect(uc.lookUpResetLink(tokenOf(link))).resolves.toBeUndefined();
    await expect(uc.lookUpResetLink('nope')).rejects.toBeInstanceOf(ResetLinkInvalidError);
  });

  it('AC-22: refuses a link older than 24 hours', async () => {
    const { uc, tokenOf, clock } = await setup();
    const { link } = await uc.issueResetLink('bob@x.com');
    clock.advance(24 * HOUR - 1000);
    await expect(uc.lookUpResetLink(tokenOf(link))).resolves.toBeUndefined();
    clock.advance(1000);
    await expect(uc.lookUpResetLink(tokenOf(link))).rejects.toBeInstanceOf(ResetLinkInvalidError);
  });
});

describe('redeemResetLink', () => {
  it('AC-21: sets the password, ends other sessions, clears failures, signs in this device', async () => {
    const { uc, tokenOf, sessions, failures, accounts, account, clock, hasher, sessionUseCases } =
      await setup();
    await sessionUseCases.openSession(account.id);
    await sessionUseCases.openSession(account.id);
    await failures.record('bob@x.com', clock.now());
    const { link } = await uc.issueResetLink('bob@x.com');

    const token = await uc.redeemResetLink(tokenOf(link), 'brand-new-pass');

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hasher.verify(accounts.rows[0]!.passwordHash, 'brand-new-pass')).toBe(true);
    expect(sessions.rows).toHaveLength(1);
    expect(failures.rows).toHaveLength(0);
  });

  it('AC-22: a used link cannot be redeemed again', async () => {
    const { uc, tokenOf } = await setup();
    const { link } = await uc.issueResetLink('bob@x.com');
    await uc.redeemResetLink(tokenOf(link), 'brand-new-pass');
    await expect(uc.redeemResetLink(tokenOf(link), 'another-pass-1')).rejects.toBeInstanceOf(
      ResetLinkInvalidError,
    );
  });

  it('AC-22: an expired link is refused and writes nothing', async () => {
    const { uc, tokenOf, clock, sessions, accounts } = await setup();
    const { link } = await uc.issueResetLink('bob@x.com');
    const before = accounts.rows[0]!.passwordHash;
    clock.advance(24 * HOUR + 1000);
    await expect(uc.redeemResetLink(tokenOf(link), 'brand-new-pass')).rejects.toBeInstanceOf(
      ResetLinkInvalidError,
    );
    expect(accounts.rows[0]!.passwordHash).toBe(before);
    expect(sessions.rows).toHaveLength(0);
  });

  it('rejects a short password before any write; the link stays pending', async () => {
    const { uc, tokenOf, links, sessions, accounts } = await setup();
    const { link } = await uc.issueResetLink('bob@x.com');
    const before = accounts.rows[0]!.passwordHash;
    const err = await uc.redeemResetLink(tokenOf(link), '123456789').catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toEqual({ field: 'password' });
    expect(links.rows[0]!.state).toBe('pending');
    expect(accounts.rows[0]!.passwordHash).toBe(before);
    expect(sessions.rows).toHaveLength(0);
  });
});
