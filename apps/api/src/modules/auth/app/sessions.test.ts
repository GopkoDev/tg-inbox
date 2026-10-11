import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { UnauthenticatedError } from '../../../platform/errors.js';
import { fakeSessionRepo } from './fakes.js';
import { createSessionUseCases } from './sessions.js';

const DAY = 86_400_000;

function setup() {
  const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
  const sessions = fakeSessionRepo();
  return { clock, sessions, uc: createSessionUseCases({ sessions, clock }) };
}

describe('openSession', () => {
  it('stores only the hash with created_at = last_seen_at = now', async () => {
    const { uc, sessions, clock } = setup();
    const token = await uc.openSession('acc-1');
    const row = sessions.rows[0]!;
    expect(row.tokenHash.toString('hex')).not.toContain(token);
    expect(row.createdAt).toEqual(clock.now());
    expect(row.lastSeenAt).toEqual(clock.now());
  });

  it('passes the transaction handle through', async () => {
    const { clock } = setup();
    const seen: unknown[] = [];
    const repo = fakeSessionRepo();
    const orig = repo.insert.bind(repo);
    repo.insert = async (input, tx) => {
      seen.push(tx);
      return orig(input, tx);
    };
    const tx = {} as never;
    await createSessionUseCases({ sessions: repo, clock }).openSession('a', tx);
    expect(seen).toEqual([tx]);
  });
});

describe('signOut', () => {
  it('AC-11: ends only that session', async () => {
    const { uc, sessions } = setup();
    const a = await uc.openSession('acc-1');
    const b = await uc.openSession('acc-1');
    await uc.signOut(a);
    await expect(uc.resolveSession(a, { background: false })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(uc.resolveSession(b, { background: false })).resolves.toBeTruthy();
    expect(sessions.rows).toHaveLength(1);
  });

  it('succeeds silently when there is no session', async () => {
    const { uc } = setup();
    await expect(uc.signOut('nope')).resolves.toBeUndefined();
  });
});

describe('resolveSession', () => {
  it('rejects an unknown token', async () => {
    const { uc } = setup();
    await expect(uc.resolveSession('nope', { background: false })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('deletes and rejects a session idle more than 30 days', async () => {
    const { uc, clock, sessions } = setup();
    const token = await uc.openSession('acc-1');
    clock.advance(30 * DAY + 1);
    await expect(uc.resolveSession(token, { background: false })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(sessions.rows).toHaveLength(0);
  });

  it('serves a background request on a 29-day-idle session without refreshing', async () => {
    const { uc, clock, sessions } = setup();
    const token = await uc.openSession('acc-1');
    const start = clock.now();
    clock.advance(29 * DAY);
    const s = await uc.resolveSession(token, { background: true });
    expect(s.accountId).toBe('acc-1');
    expect(sessions.rows[0]!.lastSeenAt).toEqual(start);
    expect(sessions.touches).toBe(0);
  });

  it('refreshes last_seen_at for user actions at most once a minute', async () => {
    const { uc, clock, sessions } = setup();
    const token = await uc.openSession('acc-1');
    clock.advance(30_000);
    await uc.resolveSession(token, { background: false });
    expect(sessions.touches).toBe(0);
    clock.advance(30_000);
    await uc.resolveSession(token, { background: false });
    expect(sessions.touches).toBe(1);
    expect(sessions.rows[0]!.lastSeenAt).toEqual(clock.now());
    clock.advance(10_000);
    await uc.resolveSession(token, { background: false });
    expect(sessions.touches).toBe(1);
  });
});
