import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import type { DB } from '../../../platform/db.types.gen.js';
import { insertAccount } from '../../../test/fixtures/auth.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createAccountRepo } from '../infra/account-repo.js';
import { createEmailLock } from '../infra/email-lock.js';
import { createSignInFailureRepo } from '../infra/sign-in-failure-repo.js';
import { createCredentialUseCases } from './credentials.js';
import { fakeHasher, fakeSessionRepo } from './fakes.js';
import { createSessionUseCases } from './sessions.js';

describe('credentials without a held connection (postgres)', () => {
  let database: TestDatabase;
  let db: Kysely<DB>;

  beforeAll(async () => {
    database = await startTestDatabase();
    // One connection only: if a verify held it, the probe query below could never run.
    db = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: database.url,
          max: 1,
          connectionTimeoutMillis: 3000,
        }),
      }),
    });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('AC-09: another query runs on a pool of one while the hash is being verified', async () => {
    const base = fakeHasher();
    const hash = await base.hash('correct-horse-1');
    await insertAccount(db, { email: 'held@example.test', passwordHash: hash });
    let probed = false;
    const hasher = {
      ...base,
      async verify(h: string, p: string) {
        // Would time out (pool exhausted) if the verify held the only connection.
        await db.selectFrom('accounts').select('id').limit(1).execute();
        probed = true;
        return base.verify(h, p);
      },
    };
    const creds = createCredentialUseCases({
      accounts: createAccountRepo(db),
      failures: createSignInFailureRepo(db),
      hasher,
      clock: systemClock,
      sessionUseCases: createSessionUseCases({ sessions: fakeSessionRepo(), clock: systemClock }),
      emailLock: createEmailLock(db),
    });
    await expect(
      creds.verifyPassword('held@example.test', 'correct-horse-1'),
    ).resolves.toBeTruthy();
    expect(probed).toBe(true);
  });
});
