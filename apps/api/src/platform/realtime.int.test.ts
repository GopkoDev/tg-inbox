import { Writable } from 'node:stream';
import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../test/postgres.js';
import { createDb, type Db } from './db.js';
import { newId } from './ids.js';
import { publish, startRealtimeListener, type RealtimeSignal } from './realtime.js';

let database: TestDatabase;
let db: Db;
const logLines: string[] = [];
const logger = pino(
  { level: 'trace' },
  new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  }),
);

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDb(database.url);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await database?.stop();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await wait(25);
  }
}

const botChanged = (): RealtimeSignal => ({ type: 'bot.changed', v: 1, workspace_id: newId() });

describe('realtime listener', () => {
  it('delivers a committed signal, suppresses a rolled-back one, and drops invalid payloads logging the type only', async () => {
    const listener = await startRealtimeListener(database.url, logger, { reconnectDelayMs: 50 });
    const got: RealtimeSignal[] = [];
    listener.onSignal((s) => got.push(s));
    try {
      const committed = botChanged();
      await db.transaction().execute((trx) => publish(trx, committed));
      await until(() => got.length === 1);
      expect(got[0]).toEqual(committed);

      const rolledBack = botChanged();
      await db
        .transaction()
        .execute(async (trx) => {
          await publish(trx, rolledBack);
          throw new Error('rollback');
        })
        .catch(() => undefined);

      // invalid payloads sent raw: bad JSON-schema (secret field present) and non-JSON
      const raw = new pg.Client({ connectionString: database.url });
      await raw.connect();
      try {
        await raw.query(`select pg_notify('realtime', $1)`, [
          JSON.stringify({ type: 'bot.changed', v: 1, secret: 'SECRET-TOKEN-123' }),
        ]);
        await raw.query(`select pg_notify('realtime', $1)`, ['not json SECRET-TOKEN-123']);
      } finally {
        await raw.end();
      }

      const marker = botChanged();
      await db.transaction().execute((trx) => publish(trx, marker));
      await until(() => got.length === 2);
      expect(got.map((s) => s.workspace_id)).toEqual([committed.workspace_id, marker.workspace_id]);
      const logs = logLines.join('');
      expect(logs).not.toContain('SECRET-TOKEN-123');
      expect(logs).toContain('bot.changed');
    } finally {
      await listener.stop();
    }
  }, 60_000);

  it('reconnects after its connection is killed, emits a gap, and keeps delivering', async () => {
    const listener = await startRealtimeListener(database.url, logger, { reconnectDelayMs: 50 });
    const got: RealtimeSignal[] = [];
    let gaps = 0;
    listener.onSignal((s) => got.push(s));
    listener.onGap(() => gaps++);
    const admin = new pg.Client({ connectionString: database.url });
    await admin.connect();
    try {
      const { rowCount } = await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
          where query ilike 'listen%realtime%' and pid <> pg_backend_pid()`,
      );
      expect(rowCount).toBeGreaterThan(0);
      await until(() => gaps >= 1);

      const after = botChanged();
      await db.transaction().execute((trx) => publish(trx, after));
      await until(() => got.length === 1);
      expect(got[0]).toEqual(after);
    } finally {
      await admin.end();
      await listener.stop();
    }
  }, 60_000);

  it('stop() ends the dedicated connection', async () => {
    const listener = await startRealtimeListener(database.url, logger);
    await listener.stop();
    const admin = new pg.Client({ connectionString: database.url });
    await admin.connect();
    try {
      const { rows } = await admin.query(
        `select count(*)::int as n from pg_stat_activity where query ilike 'listen%realtime%' and pid <> pg_backend_pid()`,
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  }, 30_000);
});
