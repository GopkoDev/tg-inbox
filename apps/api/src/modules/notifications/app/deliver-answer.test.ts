import { describe, expect, it } from 'vitest';
import { answerText } from '../domain/answers.js';
import { createDeliverAnswer } from './deliver-answer.js';
import { at, notificationsHarness } from './fakes.js';
import type { BotMessage, MemberSendOutcome, TelegramLink } from './ports.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const A = '0199a000-0000-7000-8000-0000000000b1';
const PANEL = 'https://panel.example';

function setup(
  o: { outcome?: MemberSendOutcome; bot?: 'none' | 'connected' | 'needs_token' } = {},
) {
  const h = notificationsHarness();
  if (o.bot !== 'none') h.setBot(W, { state: o.bot ?? 'connected' });
  const sent: { workspaceId: string; telegramUserId: bigint; text: string }[] = [];
  let outcome: MemberSendOutcome = o.outcome ?? { outcome: 'accepted' };
  const deliver = createDeliverAnswer({
    links: h.links,
    bots: h.botPort,
    workspaces: { workspaceName: async (w) => (w === W ? 'Acme Flowers' : null) },
    send: async (request) => {
      sent.push(request);
      return outcome;
    },
    panelUrl: PANEL,
    clock: h.clock,
  });
  const link = (patch: Partial<TelegramLink> = {}): TelegramLink => {
    const row: TelegramLink = {
      id: 'tl-1',
      workspaceId: W,
      accountId: A,
      telegramBotId: 100001n,
      telegramUserId: 777n,
      displayName: 'Ann T',
      linkedAt: at(-60),
      blockedAt: null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
      ...patch,
    };
    h.links.rows.push(row);
    return row;
  };
  return {
    h,
    sent,
    deliver,
    link,
    setOutcome: (next: MemberSendOutcome) => {
      outcome = next;
    },
  };
}

const withLink = (
  kind: Exclude<BotMessage['kind'], 'link_expired' | 'cannot_connect'>,
): BotMessage => ({
  kind,
  telegramLinkId: 'tl-1',
});

describe('deliverAnswer (flow 10)', () => {
  it.each(['connected', 'already_connected', 'chat_only_notifications'] as const)(
    '%s goes to the linked member with its TG-02 text',
    async (kind) => {
      const s = setup();
      s.link();
      expect(await s.deliver.deliver(W, withLink(kind))).toEqual({ result: 'done' });
      expect(s.sent).toEqual([
        {
          workspaceId: W,
          telegramUserId: 777n,
          text: answerText(kind, {
            workspaceName: 'Acme Flowers',
            workspaceId: W,
            panelUrl: PANEL,
          }),
        },
      ]);
    },
  );

  it('link_expired and cannot_connect go to the Telegram user id of the payload', async () => {
    const s = setup();
    await s.deliver.deliver(W, { kind: 'link_expired', telegramUserId: 555n });
    await s.deliver.deliver(W, {
      kind: 'cannot_connect',
      telegramUserId: 556n,
      reason: 'telegram_linked_to_teammate',
    });
    expect(s.sent.map((m) => m.telegramUserId)).toEqual([555n, 556n]);
    expect(s.sent[0]!.text).toBe(
      answerText('link_expired', { workspaceName: '', workspaceId: W, panelUrl: PANEL }),
    );
    expect(s.sent[1]!.text).toBe(
      answerText('cannot_connect', {
        workspaceName: 'Acme Flowers',
        workspaceId: W,
        panelUrl: PANEL,
        reason: 'telegram_linked_to_teammate',
      }),
    );
  });

  it('a bot that does not work drops the answer without a send', async () => {
    for (const bot of ['none', 'needs_token'] as const) {
      const s = setup({ bot });
      s.link();
      expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
      expect(s.sent).toEqual([]);
    }
  });

  it('a disconnected bot drops the answer too', async () => {
    const s = setup();
    s.h.setBot(W, { state: 'disconnected' });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
    expect(s.sent).toEqual([]);
  });

  it('a taken-over bot still sends', async () => {
    const s = setup();
    s.h.setBot(W, { state: 'taken_over' });
    s.link();
    await s.deliver.deliver(W, withLink('connected'));
    expect(s.sent).toHaveLength(1);
  });

  it('a send pause postpones the answer to its end, without a send', async () => {
    const s = setup();
    s.h.setBot(W, { sendPausedUntil: at(40) });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({
      result: 'retry_at',
      at: at(40),
    });
    expect(s.sent).toEqual([]);
  });

  it('a pause in the past does not postpone', async () => {
    const s = setup();
    s.h.setBot(W, { sendPausedUntil: at(-1) });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
    expect(s.sent).toHaveLength(1);
  });

  it('rate_limited postpones to the retry time', async () => {
    const s = setup({ outcome: { outcome: 'rate_limited', retryAfter: at(12) } });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({
      result: 'retry_at',
      at: at(12),
    });
  });

  it('blocked finishes without a retry', async () => {
    const s = setup({ outcome: { outcome: 'blocked' } });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
  });

  it('bot_unavailable finishes', async () => {
    const s = setup({ outcome: { outcome: 'bot_unavailable' } });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
  });

  it('transient fails the attempt so pg-boss retries', async () => {
    const s = setup({ outcome: { outcome: 'transient' } });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'failed' });
  });

  it('unknown (maybe delivered) is never retried: a second answer would be a duplicate', async () => {
    const s = setup({ outcome: { outcome: 'unknown' } });
    s.link();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'unknown' });
    expect(s.sent).toHaveLength(1);
  });

  it('an answer for a link that is gone or removed is dropped, not sent', async () => {
    const s = setup();
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
    s.link({ removedAt: at(-5), removedReason: 'deactivated', telegramUserId: null });
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
    expect(s.sent).toEqual([]);
  });

  it('a link of another workspace is not found', async () => {
    const s = setup();
    s.link({ workspaceId: '0199a000-0000-7000-8000-0000000000a2' });
    expect(await s.deliver.deliver(W, withLink('connected'))).toEqual({ result: 'done' });
    expect(s.sent).toEqual([]);
  });

  describe("notifications_off clears the removed link's Telegram id on every finish", () => {
    const removed = { removedAt: at(-5), removedReason: 'member' as const, displayName: null };

    it.each([
      ['accepted', { outcome: 'accepted' }],
      ['blocked', { outcome: 'blocked' }],
      ['bot_unavailable', { outcome: 'bot_unavailable' }],
      ['unknown', { outcome: 'unknown' }],
    ] as const)('after %s', async (_name, outcome) => {
      const s = setup({ outcome });
      const row = s.link(removed);
      await s.deliver.deliver(W, withLink('notifications_off'));
      expect(s.sent).toHaveLength(1);
      expect(row.telegramUserId).toBeNull();
    });

    it('when the bot does not work (nothing sent)', async () => {
      const s = setup({ bot: 'needs_token' });
      const row = s.link(removed);
      expect(await s.deliver.deliver(W, withLink('notifications_off'))).toEqual({ result: 'done' });
      expect(s.sent).toEqual([]);
      expect(row.telegramUserId).toBeNull();
    });

    it('not while the send is only postponed', async () => {
      const s = setup({ outcome: { outcome: 'rate_limited', retryAfter: at(9) } });
      const row = s.link(removed);
      await s.deliver.deliver(W, withLink('notifications_off'));
      expect(row.telegramUserId).toBe(777n);
    });

    it('not after a failed attempt that will be retried; yes on the last one', async () => {
      const s = setup({ outcome: { outcome: 'transient' } });
      const row = s.link(removed);
      expect(await s.deliver.deliver(W, withLink('notifications_off'))).toEqual({
        result: 'failed',
      });
      expect(row.telegramUserId).toBe(777n);
      expect(
        await s.deliver.deliver(W, withLink('notifications_off'), { lastAttempt: true }),
      ).toEqual({
        result: 'failed',
      });
      expect(row.telegramUserId).toBeNull();
    });

    it('the dead letter clears it (an expired job never reached the last attempt)', async () => {
      const s = setup();
      const row = s.link(removed);
      await s.deliver.clearOnDeadLetter(W, withLink('notifications_off'));
      expect(row.telegramUserId).toBeNull();
    });

    it('the dead letter leaves other kinds alone', async () => {
      const s = setup();
      const row = s.link();
      await s.deliver.clearOnDeadLetter(W, withLink('connected'));
      expect(row.telegramUserId).toBe(777n);
    });
  });
});
