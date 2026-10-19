import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { SWEEP_EVERY_MS } from '../domain/constants.js';
import {
  createSchedulePingsHandler,
  createSendPingsHandler,
  SendBotMessageJob,
  SendPingsJob,
  toJobPayload,
} from './jobs.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const L = '0199a000-0000-7000-8000-0000000000c1';

describe('SendBotMessageJob (events.md)', () => {
  it.each(['connected', 'already_connected', 'notifications_off', 'chat_only_notifications'])(
    '%s takes telegram_link_id only',
    (kind) => {
      expect(
        SendBotMessageJob.safeParse({ workspace_id: W, kind, telegram_link_id: L }).success,
      ).toBe(true);
      expect(
        SendBotMessageJob.safeParse({ workspace_id: W, kind, telegram_user_id: '5' }).success,
      ).toBe(false);
      expect(
        SendBotMessageJob.safeParse({
          workspace_id: W,
          kind,
          telegram_link_id: L,
          telegram_user_id: '5',
        }).success,
      ).toBe(false);
    },
  );

  it('link_expired takes a decimal telegram_user_id only', () => {
    const base = { workspace_id: W, kind: 'link_expired' };
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: '777' }).success).toBe(true);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: '0' }).success).toBe(false);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_user_id: 777 }).success).toBe(false);
    expect(SendBotMessageJob.safeParse({ ...base, telegram_link_id: L }).success).toBe(false);
    expect(
      SendBotMessageJob.safeParse({ ...base, telegram_user_id: '7', reason: 'x' }).success,
    ).toBe(false);
  });

  it('cannot_connect needs a reason', () => {
    const base = { workspace_id: W, kind: 'cannot_connect', telegram_user_id: '777' };
    expect(SendBotMessageJob.safeParse(base).success).toBe(false);
    expect(
      SendBotMessageJob.safeParse({ ...base, reason: 'telegram_linked_to_teammate' }).success,
    ).toBe(true);
    expect(SendBotMessageJob.safeParse({ ...base, reason: 'nope' }).success).toBe(false);
  });

  it('toJobPayload builds a valid payload for every message', () => {
    for (const m of [
      { kind: 'connected', telegramLinkId: L },
      { kind: 'link_expired', telegramUserId: 777n },
      { kind: 'cannot_connect', telegramUserId: 777n, reason: 'member_linked_elsewhere' },
    ] as const) {
      expect(SendBotMessageJob.safeParse(toJobPayload(W, m)).success).toBe(true);
    }
    expect(toJobPayload(W, { kind: 'link_expired', telegramUserId: 777n })).toEqual({
      workspace_id: W,
      kind: 'link_expired',
      telegram_user_id: '777',
    });
  });
});

describe('SendPingsJob', () => {
  it('is a workspace id and nothing else', () => {
    expect(SendPingsJob.safeParse({ workspace_id: W }).success).toBe(true);
    expect(SendPingsJob.safeParse({}).success).toBe(false);
    expect(SendPingsJob.safeParse({ workspace_id: 'nope' }).success).toBe(false);
    expect(SendPingsJob.safeParse({ workspace_id: W, text: 'x' }).success).toBe(false);
  });
});

describe('send-pings handler (the chain)', () => {
  const NOW = new Date('2026-10-19T10:00:00Z');
  function setup(sweep: (ws: string) => Promise<{ nextRunAt: Date | null }>) {
    const chained: { workspaceId: string; at: Date }[] = [];
    const logs: object[] = [];
    const handle = createSendPingsHandler({
      sweep: { runSweep: sweep },
      chain: async (workspaceId, at) => {
        chained.push({ workspaceId, at });
      },
      logger: { error: (o) => logs.push(o) },
      clock: fixedClock(NOW),
    });
    return { handle, chained, logs };
  }

  it('enqueues the next link at the time the sweep asked for', async () => {
    const at = new Date(NOW.getTime() + 7000);
    const { handle, chained } = setup(async () => ({ nextRunAt: at }));
    await handle({ workspace_id: W });
    expect(chained).toEqual([{ workspaceId: W, at }]);
  });

  it('ends the chain when the sweep says there is no live link', async () => {
    const { handle, chained } = setup(async () => ({ nextRunAt: null }));
    await handle({ workspace_id: W });
    expect(chained).toEqual([]);
  });

  it('a failed sweep still chains in 20 s, then fails the job; the log has the code only', async () => {
    const { handle, chained, logs } = setup(async () => {
      throw Object.assign(new Error('connection string postgres://secret'), { code: 'ECONNRESET' });
    });
    await expect(handle({ workspace_id: W })).rejects.toThrow();
    expect(chained).toEqual([{ workspaceId: W, at: new Date(NOW.getTime() + SWEEP_EVERY_MS) }]);
    expect(logs).toEqual([expect.objectContaining({ workspaceId: W, code: 'ECONNRESET' })]);
    expect(JSON.stringify(logs)).not.toContain('secret');
  });

  it('an invalid payload fails without sweeping or chaining', async () => {
    let swept = 0;
    const { handle, chained } = setup(async () => {
      swept += 1;
      return { nextRunAt: null };
    });
    await expect(handle({ workspace_id: 'x' })).rejects.toThrow();
    expect(swept).toBe(0);
    expect(chained).toEqual([]);
  });
});

describe('schedule-pings handler (the cron backstop)', () => {
  it('starts one chain per workspace with a live link and counts them', async () => {
    const started: string[] = [];
    const ticks: object[] = [];
    const handle = createSchedulePingsHandler({
      workspacesWithLiveLink: async () => [W, L],
      start: async (workspaceId) => {
        started.push(workspaceId);
        return workspaceId === W;
      },
      logger: { info: (o) => ticks.push(o) },
    });
    await handle();
    expect(started).toEqual([W, L]);
    // One was absorbed by its live chain (the singleton key).
    expect(ticks).toEqual([{ workspaces: 2, started: 1 }]);
  });
});
