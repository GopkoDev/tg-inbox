import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { ResetLinkInvalidError } from '../../../platform/errors.js';
import { insertAccount, insertSession, insertSignInFailures } from '../../../test/fixtures/auth.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createAccountRepo } from '../infra/account-repo.js';
import { createPasswordHasher } from '../infra/password-hasher.js';
import { createResetLinkRepo } from '../infra/reset-link-repo.js';
import { createSessionRepo } from '../infra/session-repo.js';
import { createSignInFailureRepo } from '../infra/sign-in-failure-repo.js';
import { createResetLinkUseCases } from './reset-links.js';
import { createSessionUseCases } from './sessions.js';

describe('reset link use cases (postgres)', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  function build() {
    const clock = fixedClock(new Date('2026-03-01T10:00:00Z'));
    const sessions = createSessionRepo(db);
    return {
      clock,
      uc: createResetLinkUseCases({
        accounts: createAccountRepo(db),
        links: createResetLinkRepo(db),
        sessions,
        failures: createSignInFailureRepo(db),
        hasher: createPasswordHasher(),
        clock,
        sessionUseCases: createSessionUseCases({ sessions, clock }),
        transaction: (fn) => db.transaction().execute((tx) => fn(tx)),
        publicWebUrl: 'http://localhost:5173',
      }),
    };
  }
  const tokenOf = (link: string) => link.split('/reset-password/')[1]!;

  it('AC-21: redeem ends other sessions, clears failures, signs in once', async () => {
    const { uc, clock } = build();
    const acc = await insertAccount(db);
    await insertSession(db, acc.id);
    await insertSession(db, acc.id);
    await insertSignInFailures(db, acc.email, [clock.now()]);
    const { link } = await uc.issueResetLink(acc.email);

    const token = await uc.redeemResetLink(tokenOf(link), 'brand-new-pass');

    expect(token).toBeTruthy();
    const rows = await db
      .selectFrom('sessions')
      .selectAll()
      .where('account_id', '=', acc.id)
      .execute();
    expect(rows).toHaveLength(1);
    const failures = await db
      .selectFrom('sign_in_failures')
      .selectAll()
      .where('email', '=', acc.email)
      .execute();
    expect(failures).toHaveLength(0);
    const stored = await db
      .selectFrom('accounts')
      .select('password_hash')
      .where('id', '=', acc.id)
      .executeTakeFirstOrThrow();
    expect(stored.password_hash).not.toBe(acc.password_hash);
  });

  it('AC-22: two concurrent redeems of one link yield exactly one success', async () => {
    const { uc } = build();
    const acc = await insertAccount(db);
    const { link } = await uc.issueResetLink(acc.email);
    const results = await Promise.allSettled([
      uc.redeemResetLink(tokenOf(link), 'brand-new-pass'),
      uc.redeemResetLink(tokenOf(link), 'another-pass-12'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ResetLinkInvalidError);
    const rows = await db
      .selectFrom('sessions')
      .selectAll()
      .where('account_id', '=', acc.id)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
