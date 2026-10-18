import { describe, expect, it } from 'vitest';
import type { InboxBotStatus } from '@tg/shared';
import { fixedClock } from '../../../platform/clock.js';
import {
  BotCannotReplyError,
  DuplicateRiskConfirmationRequiredError,
  NotFoundError,
  ReplyLimitReachedError,
  ReplyNotResendableError,
  TeammateRepliedError,
  ValidationError,
} from '../../../platform/errors.js';
import type { ReplyView } from '../../conversations/app/ports.js';
import type {
  CreateReplyInput,
  CreateReplyResult,
  ReplyRequests,
  RequeueReplyInput,
  RequeueReplyResult,
} from '../../conversations/app/replies.js';
import { createSendReply } from './send-reply.js';

const WS = '01920000-0000-7000-8000-000000000001';
const CONV = '01920000-0000-7000-8000-0000000000c1';
const ME = '01920000-0000-7000-8000-0000000000b1';
const MATE = '01920000-0000-7000-8000-0000000000b2';
const KEY = '6f1c2b8e-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-18T10:00:00Z');

const view = (o: Partial<ReplyView> = {}): ReplyView => ({
  id: '01920000-0000-7000-8000-0000000000f2',
  conversationId: CONV,
  clientKey: KEY,
  body: 'Hello',
  authorAccountId: ME,
  state: 'sending',
  failureReason: null,
  positionAt: NOW,
  sentAt: null,
  createdAt: NOW,
  ...o,
});

function setup(
  o: {
    botState?: InboxBotStatus['state'];
    create?: CreateReplyResult;
    requeue?: RequeueReplyResult;
  } = {},
) {
  const calls: string[] = [];
  const botState = o.botState ?? 'connected';
  const status: InboxBotStatus = {
    workspace_id: WS,
    state: botState,
    can_reply: botState === 'connected' || botState === 'taken_over',
    receiving: botState === 'connected',
  };
  const inputs: { create?: CreateReplyInput; requeue?: RequeueReplyInput } = {};
  const replies: ReplyRequests = {
    async createReply(input) {
      calls.push('createReply');
      inputs.create = input;
      const result = o.create ?? { status: 'created', reply: view() };
      if (result.status === 'created') await input.enqueueDrain({} as never, WS, CONV);
      return result;
    },
    async requeueReply(input) {
      calls.push('requeueReply');
      inputs.requeue = input;
      const result = o.requeue ?? { status: 'requeued', reply: view() };
      if (result.status === 'requeued') await input.enqueueDrain({} as never, WS, CONV);
      return result;
    },
  };
  const enqueued: [string, string][] = [];
  const useCases = createSendReply({
    replies,
    bots: {
      canCarryReplies: async () => {
        calls.push('canCarryReplies');
        return status.can_reply;
      },
      inboxBotStatus: async () => status,
    },
    workspaces: {
      displayNames: async (_ws, ids) => new Map(ids.map((id) => [id, `name-${id.slice(-2)}`])),
    },
    enqueueDrain: async (_tx, ws, conv) => {
      calls.push('enqueueDrain');
      enqueued.push([ws, conv]);
    },
    clock: fixedClock(NOW),
  });
  return { useCases, calls, inputs, enqueued, status };
}

const send = (body = 'Hello', extra: Record<string, unknown> = {}) => ({
  client_key: KEY,
  body,
  last_seen_reply_id: null,
  confirm_teammate_reply: false,
  ...extra,
});

describe('sendReply check order (flow 1)', () => {
  it.each([
    ['', 'Write a reply before sending', { field: 'body' }],
    [' \n  ', 'Write a reply before sending', { field: 'body' }],
    [
      'a'.repeat(4097),
      'Replies are limited to 4096 characters',
      { field: 'body', max_length: 4096 },
    ],
    // 2049 astral characters are 4098 UTF-16 units but fewer code points than 4096
    [
      '😀'.repeat(2049),
      'Replies are limited to 4096 characters',
      { field: 'body', max_length: 4096 },
    ],
  ])('refuses body %#, before the bot and the store (AC-07)', async (body, message, details) => {
    const { useCases, calls } = setup({ botState: 'needs_token' });
    const error = await useCases.sendReply(WS, ME, CONV, send(body)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ message, details });
    expect(calls).toEqual([]);
  });

  it('accepts exactly 4096 units', async () => {
    const { useCases } = setup();
    const out = await useCases.sendReply(WS, ME, CONV, send('a'.repeat(4096)));
    expect(out.created).toBe(true);
  });

  it('refuses a bot that cannot carry replies before storing anything, even over the limit (AC-13)', async () => {
    const { useCases, calls, status } = setup({
      botState: 'needs_token',
      create: { status: 'limited', retryAt: NOW },
    });
    const error = await useCases.sendReply(WS, ME, CONV, send()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotCannotReplyError);
    expect((error as BotCannotReplyError).details).toEqual({ bot: status });
    expect(calls).toEqual(['canCarryReplies']);
  });

  it('creates with the limit, window, flags and enqueues the drain for its own conversation', async () => {
    const { useCases, inputs, enqueued } = setup();
    const out = await useCases.sendReply(
      WS,
      ME,
      CONV,
      send('Hi', { last_seen_reply_id: '01920000-0000-7000-8000-0000000000f1' }),
    );
    expect(out.created).toBe(true);
    expect(out.reply).toMatchObject({
      type: 'reply',
      state: 'sending',
      author: { account_id: ME },
      workspace_id: WS,
      conversation_id: CONV,
    });
    expect(inputs.create).toMatchObject({
      workspaceId: WS,
      conversationId: CONV,
      authorId: ME,
      clientKey: KEY,
      body: 'Hi',
      lastSeenReplyId: '01920000-0000-7000-8000-0000000000f1',
      confirmTeammate: false,
      limit: 30,
      windowMs: 60_000,
    });
    expect(enqueued).toEqual([[WS, CONV]]);
  });

  it('answers a repeated client key with the existing reply and nothing enqueued', async () => {
    const { useCases, enqueued } = setup({
      create: { status: 'existing', reply: view({ state: 'sent', sentAt: NOW }) },
    });
    const out = await useCases.sendReply(WS, ME, CONV, send());
    expect(out).toMatchObject({ created: false, reply: { state: 'sent' } });
    expect(enqueued).toEqual([]);
  });

  it('maps the limit to REPLY_LIMIT_REACHED with retry_at and Retry-After', async () => {
    const retryAt = new Date(NOW.getTime() + 12_300);
    const { useCases } = setup({ create: { status: 'limited', retryAt } });
    const error = await useCases.sendReply(WS, ME, CONV, send()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplyLimitReachedError);
    expect(error).toMatchObject({
      details: { limit: 30, window_seconds: 60, retry_at: retryAt.toISOString() },
      headers: { 'Retry-After': '13' },
    });
  });

  it('maps a teammate reply to TEAMMATE_REPLIED with who and when (AC-16)', async () => {
    const mate = view({ id: '01920000-0000-7000-8000-0000000000f3', authorAccountId: MATE });
    const { useCases } = setup({ create: { status: 'teammate', reply: mate } });
    const error = await useCases.sendReply(WS, ME, CONV, send()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TeammateRepliedError);
    expect((error as TeammateRepliedError).details).toEqual({
      reply: {
        id: mate.id,
        author: { account_id: MATE, display_name: 'name-b2' },
        position_at: NOW.toISOString(),
      },
    });
  });

  it('passes the teammate confirmation through', async () => {
    const { useCases, inputs } = setup();
    await useCases.sendReply(WS, ME, CONV, send('Hi', { confirm_teammate_reply: true }));
    expect(inputs.create?.confirmTeammate).toBe(true);
  });

  it('maps an unknown conversation to not found', async () => {
    const { useCases } = setup({ create: { status: 'not_found' } });
    await expect(useCases.sendReply(WS, ME, CONV, send())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resendReply check order', () => {
  const REPLY = '01920000-0000-7000-8000-0000000000f2';
  const resend = (u: ReturnType<typeof setup>['useCases'], confirm = false) =>
    u.resendReply(WS, ME, CONV, REPLY, { confirm_duplicate_risk: confirm });

  it('requeues and enqueues the drain, returning the sending reply', async () => {
    const { useCases, inputs, enqueued } = setup();
    const out = await resend(useCases, true);
    expect(out).toMatchObject({ state: 'sending' });
    expect(inputs.requeue).toMatchObject({
      workspaceId: WS,
      conversationId: CONV,
      replyId: REPLY,
      memberId: ME,
      confirmDuplicate: true,
      limit: 30,
      windowMs: 60_000,
    });
    expect(enqueued).toEqual([[WS, CONV]]);
  });

  it('not resendable wins over a broken bot', async () => {
    const { useCases } = setup({
      botState: 'needs_token',
      requeue: { status: 'not_resendable', reply: view() },
    });
    const error = await resend(useCases).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplyNotResendableError);
    expect((error as ReplyNotResendableError).details).toMatchObject({
      reply: { type: 'reply', state: 'sending', id: REPLY },
    });
  });

  it('the limit wins over a broken bot', async () => {
    const { useCases } = setup({
      botState: 'needs_token',
      requeue: { status: 'limited', retryAt: new Date(NOW.getTime() + 1000) },
    });
    await expect(resend(useCases)).rejects.toBeInstanceOf(ReplyLimitReachedError);
  });

  it('the duplicate-risk confirmation wins over a broken bot', async () => {
    const { useCases } = setup({
      botState: 'needs_token',
      requeue: { status: 'confirmation_required' },
    });
    await expect(resend(useCases)).rejects.toBeInstanceOf(DuplicateRiskConfirmationRequiredError);
  });

  it('the bot check comes last and nothing is enqueued when it refuses', async () => {
    const { useCases, calls, enqueued, status } = setup({ botState: 'needs_token' });
    const error = await resend(useCases).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotCannotReplyError);
    expect((error as BotCannotReplyError).details).toEqual({ bot: status });
    expect(enqueued).toEqual([]);
    expect(calls).toEqual(['requeueReply', 'canCarryReplies']);
  });

  it('maps an unknown reply to not found', async () => {
    const { useCases } = setup({ requeue: { status: 'not_found' } });
    await expect(resend(useCases)).rejects.toBeInstanceOf(NotFoundError);
  });
});
