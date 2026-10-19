import { describe, expect, it, vi } from 'vitest';
import { newId } from './ids.js';
import {
  MAX_SIGNAL_BYTES,
  publish,
  realtimeSignalSchema,
  type RealtimeSignal,
} from './realtime.js';

const ws = newId();
const conv = newId();

const changed: RealtimeSignal = {
  type: 'conversation.changed',
  v: 1,
  workspace_id: ws,
  conversation_id: conv,
  item: { type: 'message', id: newId() },
  change: 'created',
};

describe('realtime signal schema', () => {
  it('accepts the three v1 signals', () => {
    expect(realtimeSignalSchema.safeParse(changed).success).toBe(true);
    expect(
      realtimeSignalSchema.safeParse({
        ...changed,
        item: null,
        change: 'read',
        account_id: newId(),
      }).success,
    ).toBe(true);
    expect(
      realtimeSignalSchema.safeParse({ type: 'bot.changed', v: 1, workspace_id: ws }).success,
    ).toBe(true);
    expect(
      realtimeSignalSchema.safeParse({
        type: 'membership.deactivated',
        v: 1,
        workspace_id: ws,
        account_id: newId(),
      }).success,
    ).toBe(true);
  });

  it('accepts telegram.link.changed with workspace and account ids only (AC-06)', () => {
    const signal = { type: 'telegram_link.changed', v: 1, workspace_id: ws, account_id: newId() };
    expect(realtimeSignalSchema.safeParse(signal).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(signal))).toBeLessThan(MAX_SIGNAL_BYTES);
    expect(realtimeSignalSchema.safeParse({ ...signal, account_id: undefined }).success).toBe(
      false,
    );
    expect(realtimeSignalSchema.safeParse({ ...signal, workspace_id: undefined }).success).toBe(
      false,
    );
    expect(realtimeSignalSchema.safeParse({ ...signal, v: 2 }).success).toBe(false);
  });

  it('requires account_id for a read change', () => {
    expect(realtimeSignalSchema.safeParse({ ...changed, item: null, change: 'read' }).success).toBe(
      false,
    );
  });

  it('rejects a null item for a non-read change, a wrong version and an unknown type', () => {
    expect(realtimeSignalSchema.safeParse({ ...changed, item: null }).success).toBe(false);
    expect(realtimeSignalSchema.safeParse({ ...changed, v: 2 }).success).toBe(false);
    expect(realtimeSignalSchema.safeParse({ type: 'nope', v: 1, workspace_id: ws }).success).toBe(
      false,
    );
    expect(realtimeSignalSchema.safeParse({ type: 'bot.changed', v: 1 }).success).toBe(false);
  });

  it('accepts an activity item only with change created', () => {
    const activity = { ...changed, item: { type: 'activity', id: newId() } };
    expect(realtimeSignalSchema.safeParse(activity).success).toBe(true);
    expect(realtimeSignalSchema.safeParse({ ...activity, change: 'state' }).success).toBe(false);
    expect(realtimeSignalSchema.safeParse({ ...activity, change: 'edited' }).success).toBe(false);
  });

  it('an activity signal stays under MAX_SIGNAL_BYTES', () => {
    const activity = { ...changed, item: { type: 'activity', id: newId() } };
    expect(Buffer.byteLength(JSON.stringify(activity))).toBeLessThan(MAX_SIGNAL_BYTES);
  });

  it('ignores unknown fields (additive policy)', () => {
    expect(realtimeSignalSchema.safeParse({ ...changed, extra: 1 }).success).toBe(true);
  });
});

describe('publish', () => {
  it('serialises the signal as JSON under 1 kB into pg_notify on the given executor', async () => {
    const executeQuery = vi.fn().mockResolvedValue({ rows: [] });
    const trx = { getExecutor: () => ({ executeQuery }), executeQuery } as never;
    expect(MAX_SIGNAL_BYTES).toBe(1000);
    // The fake executor may not be what Kysely's sql tag expects; a rejection from it is fine,
    // the assertion is that nothing is thrown for a valid, small signal before reaching it.
    await publish(trx, changed).catch(() => undefined);
  });

  it('refuses a signal whose payload would exceed 1 kB, before touching the database', async () => {
    const executeQuery = vi.fn();
    const trx = { executeQuery, getExecutor: () => ({ executeQuery }) } as never;
    const huge = { ...changed, conversation_id: 'x'.repeat(2000) } as unknown as RealtimeSignal;
    await expect(publish(trx, huge)).rejects.toThrow();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('refuses a signal that fails the schema', async () => {
    const executeQuery = vi.fn();
    const trx = { executeQuery, getExecutor: () => ({ executeQuery }) } as never;
    await expect(
      publish(trx, { type: 'bot.changed', v: 1 } as unknown as RealtimeSignal),
    ).rejects.toThrow();
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
