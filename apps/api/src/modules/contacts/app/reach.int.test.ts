import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { startRealtimeListener, type RealtimeSignal } from '../../../platform/realtime.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactRepo } from '../infra/contact-repo.js';
import { createReachRepo } from '../infra/reach-repo.js';
import { createReachSignals } from '../infra/tag-signals.js';
import { createContactReach, type ContactReach } from './reach.js';

const BOT = 9501n;
const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('recordBlockChange (postgres, AC-14)', () => {
  let database: TestDatabase;
  let db: Db;
  let reach: ContactReach;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    reach = createContactReach({
      transaction: (fn) => db.transaction().execute((tx) => fn(tx as unknown as Db)),
      contacts: createContactRepo(db),
      reach: createReachRepo(db),
      signals: createReachSignals(),
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('publishes contact.changed reach only when the mark changed, scoped to the workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const olena = await insertContact(db, { workspaceId: a, telegramUserId: 610001n });
    const inB = await insertContact(db, { workspaceId: b, telegramUserId: 610001n });
    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }), {
      reconnectDelayMs: 50,
    });
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    try {
      expect(await reach.recordBlockChange(a, BOT, 610001n, true, at(10))).toBe(true);
      expect(await reach.recordBlockChange(a, BOT, 610001n, true, at(11))).toBe(false);
      expect(await reach.recordBlockChange(a, BOT, 610001n, false, at(5))).toBe(false);
      // A member's linked account that is not a contact: nothing written, nothing published.
      expect(await reach.recordBlockChange(a, BOT, 619999n, true, at(12))).toBe(false);
      expect(await reach.recordBlockChange(a, BOT, 610001n, false, at(20))).toBe(true);

      const end = Date.now() + 10_000;
      while (got.length < 2 && Date.now() < end) await wait(25);
      await wait(200);
      expect(got).toEqual([
        { type: 'contact.changed', v: 1, workspace_id: a, contact_id: olena, change: 'reach' },
        { type: 'contact.changed', v: 1, workspace_id: a, contact_id: olena, change: 'reach' },
      ]);
    } finally {
      await listener.stop();
    }

    const rows = await db
      .selectFrom('contact_bot_reach')
      .select(['workspace_id', 'contact_id', 'blocked_at', 'changed_at'])
      .where('workspace_id', 'in', [a, b])
      .execute();
    // The same Telegram user in workspace B is untouched.
    expect(rows).toEqual([
      { workspace_id: a, contact_id: olena, blocked_at: null, changed_at: at(20) },
    ]);
    expect(rows.some((r) => r.contact_id === inB)).toBe(false);
  });
});
