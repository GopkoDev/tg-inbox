import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  fakeBotRepo,
  fakeBotSignals,
  fakeBotTransaction,
  fakeGateway,
  type FakeBotRow,
} from './fakes.js';
import { createHealthCheck } from './health-check.js';
import { HEALTH_CHECK_TIMEOUT } from './ports.js';
import { webhookUrl } from './webhook-url.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const BASE = 'https://inbox.example.test';

function row(o: Partial<FakeBotRow> = {}): FakeBotRow {
  return {
    id: '0199a000-0000-7000-8000-000000000001',
    workspaceId: 'ws-a',
    telegramBotId: 100001n,
    name: 'Old Name',
    username: 'old_name_bot',
    state: 'connected',
    connectedAt: at(0),
    lastCheckedAt: at(0),
    createdAt: at(0),
    token: '100001:SECRET',
    webhookSecret: 's',
    ...o,
  };
}

function setup(rows: FakeBotRow[] = [row()]) {
  const bots = fakeBotRepo();
  bots.rows.push(...rows);
  const telegram = fakeGateway();
  const clock = fixedClock(at(600));
  const signals = fakeBotSignals();
  const health = createHealthCheck({
    bots,
    telegram,
    clock,
    webhookBaseUrl: BASE,
    transaction: fakeBotTransaction(bots, signals),
    signals,
  });
  return { bots, telegram, clock, health, signals };
}

describe('webhookUrl', () => {
  it('builds the per-bot webhook URL under the public base', () => {
    expect(webhookUrl('https://x.test/', 'abc')).toBe('https://x.test/api/telegram/webhook/abc');
    expect(webhookUrl('https://x.test', 'abc')).toBe('https://x.test/api/telegram/webhook/abc');
  });
});

describe('scheduleChecks', () => {
  it('lists the bots due at the clock time', async () => {
    const { health } = setup([
      row({ id: 'b1', workspaceId: 'w1', lastCheckedAt: at(0) }),
      row({ id: 'b2', workspaceId: 'w2', telegramBotId: 2n, lastCheckedAt: at(500) }),
      row({ id: 'b3', workspaceId: 'w3', telegramBotId: 3n, state: 'needs_token' }),
    ]);
    expect(await health.scheduleChecks()).toEqual([{ botId: 'b1', workspaceId: 'w1' }]);
  });
});

describe('checkOne — each outcome row of events.md', () => {
  it('webhook is ours → connected, name and username refreshed (AC-15)', async () => {
    const { bots, telegram, health } = setup([row({ state: 'taken_over' })]);
    expect(await health.checkOne('ws-a', row().id)).toBe('connected');
    expect(bots.rows[0]).toMatchObject({
      state: 'connected',
      name: 'Acme Flowers Bot',
      username: 'acme_flowers_bot',
      lastCheckedAt: at(600),
    });
    expect(telegram.calls.map((c) => [c.method, c.token, c.timeoutMs])).toEqual([
      ['getMe', '100001:SECRET', HEALTH_CHECK_TIMEOUT],
      ['getWebhook', '100001:SECRET', HEALTH_CHECK_TIMEOUT],
    ]);
    expect(telegram.calls[1]!.ourUrl).toBe(`${BASE}/api/telegram/webhook/${row().id}`);
  });

  it('getMe unauthorized → needs_token, identity kept (AC-16)', async () => {
    const { bots, telegram, health } = setup();
    telegram.me = 'unauthorized';
    expect(await health.checkOne('ws-a', row().id)).toBe('needs_token');
    expect(bots.rows[0]).toMatchObject({
      state: 'needs_token',
      name: 'Old Name',
      lastCheckedAt: at(600),
    });
    expect(telegram.calls).toHaveLength(1);
  });

  it('getWebhookInfo unauthorized → needs_token', async () => {
    const { bots, telegram, health } = setup();
    telegram.webhook = 'unauthorized';
    expect(await health.checkOne('ws-a', row().id)).toBe('needs_token');
    expect(bots.rows[0]!.state).toBe('needs_token');
  });

  it.each(['foreign', 'none'] as const)(
    'webhook %s → taken_over, identity refreshed (AC-16b)',
    async (target) => {
      const { bots, telegram, health } = setup();
      telegram.webhook = target;
      expect(await health.checkOne('ws-a', row().id)).toBe('taken_over');
      expect(bots.rows[0]).toMatchObject({
        state: 'taken_over',
        name: 'Acme Flowers Bot',
        lastCheckedAt: at(600),
      });
    },
  );

  it('getMe transient (network, 5xx, 429) → nothing written', async () => {
    const { bots, telegram, health } = setup();
    telegram.me = 'transient';
    expect(await health.checkOne('ws-a', row().id)).toBe('transient');
    expect(bots.rows[0]).toEqual(row());
  });

  it('getMe ok, getWebhookInfo transient → nothing written', async () => {
    const { bots, telegram, health } = setup();
    telegram.webhook = 'transient';
    expect(await health.checkOne('ws-a', row().id)).toBe('transient');
    expect(bots.rows[0]).toEqual(row());
  });

  it('a disconnected bot is a no-op and is not resurrected', async () => {
    const disconnected = row({ state: 'disconnected', token: null, connectedAt: null });
    const { bots, telegram, health } = setup([disconnected]);
    expect(await health.checkOne('ws-a', row().id)).toBe('skipped');
    expect(telegram.calls).toHaveLength(0);
    expect(bots.rows[0]).toEqual(disconnected);
  });

  it('a gone bot or a workspace id that does not own it is a no-op', async () => {
    const { bots, telegram, health } = setup();
    expect(await health.checkOne('ws-b', row().id)).toBe('skipped');
    expect(await health.checkOne('ws-a', '0199a000-0000-7000-8000-00000000ffff')).toBe('skipped');
    expect(telegram.calls).toHaveLength(0);
    expect(bots.rows[0]).toEqual(row());
  });

  it('a bot disconnected while the Bot API calls ran is not written back', async () => {
    const { bots, telegram, health } = setup();
    const getMe = telegram.getMe.bind(telegram);
    telegram.getMe = async (token, ms) => {
      await bots.clearOnDisconnect('ws-a', row().id);
      return getMe(token, ms);
    };
    expect(await health.checkOne('ws-a', row().id)).toBe('skipped');
    expect(bots.rows[0]!.state).toBe('disconnected');
  });

  it('a stored token that cannot be decrypted → needs_token, no Telegram call (ADR-0006)', async () => {
    const { bots, telegram, health } = setup([row({ undecryptable: true })]);
    expect(await health.checkOne('ws-a', row().id)).toBe('needs_token');
    expect(bots.rows[0]).toMatchObject({ state: 'needs_token', lastCheckedAt: at(600) });
    expect(telegram.calls).toHaveLength(0);
  });

  it('a check that read the row before an owner action never overwrites what the action wrote', async () => {
    const { bots, telegram, health } = setup();
    // While the old token is checked, the owner pastes a new one (AC-17): connected, checked now.
    telegram.getMe = async () => {
      Object.assign(bots.rows[0]!, { state: 'connected', lastCheckedAt: at(599), token: 'new' });
      return 'unauthorized';
    };
    expect(await health.checkOne('ws-a', row().id)).toBe('skipped');
    expect(bots.rows[0]).toMatchObject({ state: 'connected', lastCheckedAt: at(599) });
  });

  it('a stale tg-inbox webhook of another row → taken_over: messages do not reach this bot', async () => {
    const { telegram, health } = setup();
    telegram.webhook = 'stale';
    expect(await health.checkOne('ws-a', row().id)).toBe('taken_over');
  });
});

describe('checkOne publishes bot.changed on a state change only (AC-13, AC-14)', () => {
  it('taken over by another service → one signal', async () => {
    const { telegram, health, signals } = setup();
    telegram.webhook = 'foreign';
    expect(await health.checkOne('ws-a', row().id)).toBe('taken_over');
    expect(signals.published).toEqual(['ws-a']);
  });

  it('token rejected → one signal', async () => {
    const { telegram, health, signals } = setup();
    telegram.me = 'unauthorized';
    await health.checkOne('ws-a', row().id);
    expect(signals.published).toEqual(['ws-a']);
  });

  it('taken_over back to connected → one signal', async () => {
    const { health, signals } = setup([row({ state: 'taken_over' })]);
    await health.checkOne('ws-a', row().id);
    expect(signals.published).toEqual(['ws-a']);
  });

  it('no change (still connected), transient or skipped → no signal', async () => {
    const same = setup();
    expect(await same.health.checkOne('ws-a', row().id)).toBe('connected');
    expect(same.signals.published).toEqual([]);

    const transient = setup();
    transient.telegram.me = 'transient';
    await transient.health.checkOne('ws-a', row().id);
    const skipped = setup([
      row({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null }),
    ]);
    await skipped.health.checkOne('ws-a', row().id);
    expect([...transient.signals.published, ...skipped.signals.published]).toEqual([]);
  });
});
