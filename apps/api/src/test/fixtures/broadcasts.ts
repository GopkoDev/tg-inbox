import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import { insertBot } from './bots.js';
import { insertConversation } from './conversations.js';
import { twoWorkspacesWithTags } from './tags.js';

const T = new Date('2026-10-11T10:00:00Z');

let nextBroadcast = 1;
let nextTelegramMessageId = 900000n;

export type TagMode = 'any' | 'all' | 'none';
export type AudienceTagKind = 'include' | 'exclude';
export type RecipientState =
  'waiting' | 'sending' | 'delivered' | 'blocked' | 'failed' | 'not_confirmed' | 'stopped';
export type FailureReason =
  'account_gone' | 'chat_not_found' | 'telegram_error' | 'text_refused' | 'bot_stopped';
export type EndReason = 'completed' | 'text_refused' | 'bot_stopped' | 'stopped';

export type BroadcastAudienceFixture =
  | {
      kind: 'tags';
      mode: TagMode;
      tags?: Array<{ tagId: string; kind?: AudienceTagKind; tagName?: string }>;
    }
  | { kind: 'group' };

/**
 * A draft broadcasts row (PII guard: synthetic names). `name` defaults to `Test broadcast N`, the
 * text to `Hello`, the audience to tags "any" with no tag; `audience.tags` rows are written too.
 */
export async function insertBroadcast(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    authorAccountId: string;
    name?: string;
    text?: string;
    audience?: BroadcastAudienceFixture;
    version?: number;
    lastChangedAt?: Date;
    createdAt?: Date;
  },
): Promise<string> {
  const id = newId();
  const audience = o.audience ?? { kind: 'tags', mode: 'any' };
  const createdAt = o.createdAt ?? T;
  await db
    .insertInto('broadcasts')
    .values({
      id,
      workspace_id: o.workspaceId,
      name: o.name ?? `Test broadcast ${nextBroadcast++}`,
      text: o.text ?? 'Hello',
      status: 'draft',
      version: o.version ?? 1,
      audience_kind: audience.kind,
      tag_mode: audience.kind === 'tags' ? audience.mode : null,
      author_account_id: o.authorAccountId,
      last_changed_by_account_id: o.authorAccountId,
      last_changed_at: o.lastChangedAt ?? createdAt,
      created_at: createdAt,
    })
    .execute();
  if (audience.kind === 'tags') {
    for (const tag of audience.tags ?? []) {
      await insertAudienceTag(db, {
        workspaceId: o.workspaceId,
        broadcastId: id,
        tagId: tag.tagId,
        kind: tag.kind,
        tagName: tag.tagName,
      });
    }
  }
  return id;
}

/**
 * A broadcast_audience_tags row; `tagName` defaults to the tag's current name (or `Test tag` when
 * the tag is gone — there is no FK), `kind` to `include`.
 */
export async function insertAudienceTag(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    broadcastId: string;
    tagId: string;
    kind?: AudienceTagKind;
    tagName?: string;
  },
): Promise<void> {
  const tagName =
    o.tagName ??
    (
      await db
        .selectFrom('tags')
        .select('name')
        .where('workspace_id', '=', o.workspaceId)
        .where('id', '=', o.tagId)
        .executeTakeFirst()
    )?.name ??
    'Test tag';
  await db
    .insertInto('broadcast_audience_tags')
    .values({
      workspace_id: o.workspaceId,
      broadcast_id: o.broadcastId,
      tag_id: o.tagId,
      kind: o.kind ?? 'include',
      tag_name: tagName,
    })
    .execute();
}

/** A broadcast_group_contacts row. */
export async function insertGroupContact(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    broadcastId: string;
    contactId: string;
    addedByAccountId: string;
    addedAt?: Date;
  },
): Promise<void> {
  await db
    .insertInto('broadcast_group_contacts')
    .values({
      workspace_id: o.workspaceId,
      broadcast_id: o.broadcastId,
      contact_id: o.contactId,
      added_by_account_id: o.addedByAccountId,
      added_at: o.addedAt ?? T,
    })
    .execute();
}

export interface FixtureRecipient {
  contactId: string;
  /** Defaults to the contact's Telegram user id. */
  telegramUserId?: bigint;
  /** Defaults to `waiting`. */
  state?: RecipientState;
  /** A `failed` recipient defaults to `telegram_error`. */
  failureReason?: FailureReason;
  claimedAt?: Date | null;
  outcomeAt?: Date | null;
  /** A `delivered` recipient defaults to a synthetic message id. */
  telegramMessageId?: bigint;
}

const CLAIMED: RecipientState[] = ['sending', 'delivered', 'not_confirmed'];
const UNCLAIMED: RecipientState[] = ['waiting', 'stopped'];
const IN_FLIGHT: RecipientState[] = ['waiting', 'sending'];

/**
 * Turns a draft into `sending` with the frozen breakdown (defaults: no blocked, no never wrote,
 * audience = blocked + never wrote + recipients) and inserts the recipients with positions 1…n in
 * contact-id order, filling the per-state columns so every CHECK holds. Returns the recipients in
 * position order.
 */
export async function launchBroadcastFixture(
  db: Kysely<DB>,
  o: {
    broadcast: string;
    launchedByAccountId: string;
    telegramBotId: bigint;
    recipients: FixtureRecipient[];
    breakdown?: { blocked?: number; neverWrote?: number };
    launchedAt?: Date;
  },
): Promise<Array<{ id: string; contactId: string; position: number }>> {
  const launchedAt = o.launchedAt ?? T;
  const { workspace_id: workspaceId } = await db
    .selectFrom('broadcasts')
    .select('workspace_id')
    .where('id', '=', o.broadcast)
    .executeTakeFirstOrThrow();
  const blocked = o.breakdown?.blocked ?? 0;
  const neverWrote = o.breakdown?.neverWrote ?? 0;
  await db
    .updateTable('broadcasts')
    .set({
      status: 'sending',
      launched_at: launchedAt,
      launched_by_account_id: o.launchedByAccountId,
      launch_telegram_bot_id: o.telegramBotId,
      audience_size: blocked + neverWrote + o.recipients.length,
      blocked_count: blocked,
      never_wrote_count: neverWrote,
      recipient_count: o.recipients.length,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', o.broadcast)
    .execute();

  const sorted = [...o.recipients].sort((x, y) =>
    x.contactId < y.contactId ? -1 : x.contactId > y.contactId ? 1 : 0,
  );
  const inserted: Array<{ id: string; contactId: string; position: number }> = [];
  for (const [i, r] of sorted.entries()) {
    const id = newId();
    const state = r.state ?? 'waiting';
    const telegramUserId =
      r.telegramUserId ??
      (
        await db
          .selectFrom('contacts')
          .select('telegram_user_id')
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', r.contactId)
          .executeTakeFirstOrThrow()
      ).telegram_user_id;
    const claimedAt =
      r.claimedAt !== undefined ? r.claimedAt : CLAIMED.includes(state) ? launchedAt : null;
    const outcomeAt =
      r.outcomeAt !== undefined ? r.outcomeAt : IN_FLIGHT.includes(state) ? null : launchedAt;
    await db
      .insertInto('broadcast_recipients')
      .values({
        id,
        workspace_id: workspaceId,
        broadcast_id: o.broadcast,
        contact_id: r.contactId,
        position: i + 1,
        telegram_user_id: telegramUserId,
        state,
        failure_reason: state === 'failed' ? (r.failureReason ?? 'telegram_error') : null,
        claimed_at: UNCLAIMED.includes(state) ? null : claimedAt,
        outcome_at: outcomeAt,
        telegram_message_id:
          state === 'delivered' ? (r.telegramMessageId ?? nextTelegramMessageId++) : null,
      })
      .execute();
    inserted.push({ id, contactId: r.contactId, position: i + 1 });
  }
  return inserted;
}

/**
 * Ends a launched broadcast: `sent` (reason defaults to `completed`) or `stopped` (reason
 * `stopped`, `stoppedByAccountId` required, stopped at the end time).
 */
export async function endBroadcastFixture(
  db: Kysely<DB>,
  o: {
    broadcast: string;
    status: 'sent' | 'stopped';
    endReason?: EndReason;
    stoppedByAccountId?: string;
    endedAt?: Date;
  },
): Promise<void> {
  const endedAt = o.endedAt ?? T;
  const stopped = o.status === 'stopped';
  if (stopped && !o.stoppedByAccountId) {
    throw new Error('endBroadcastFixture: a stopped broadcast needs stoppedByAccountId');
  }
  await db
    .updateTable('broadcasts')
    .set({
      status: o.status,
      ended_at: endedAt,
      end_reason: o.endReason ?? (stopped ? 'stopped' : 'completed'),
      stopped_at: stopped ? endedAt : null,
      stopped_by_account_id: stopped ? (o.stoppedByAccountId ?? null) : null,
    })
    .where('id', '=', o.broadcast)
    .execute();
}

/**
 * From `twoWorkspacesWithTags`: each workspace with a connected bot, a conversation of its tagged
 * contact, a draft (tag audience "any of VIP") and a launched broadcast with its two contacts as
 * waiting recipients. The base of every cross-workspace isolation test of the broadcasts tables.
 */
export async function twoWorkspacesWithBroadcasts(db: Kysely<DB>) {
  const tagged = await twoWorkspacesWithTags(db);
  async function build(w: (typeof tagged)['a']) {
    const { bot } = await insertBot(db, { workspaceId: w.workspaceId });
    const conversationId = await insertConversation(db, {
      workspaceId: w.workspaceId,
      contactId: w.taggedContactId,
    });
    const draftId = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.operatorAccountId,
      audience: { kind: 'tags', mode: 'any', tags: [{ tagId: w.tagId }] },
    });
    const launchedId = await insertBroadcast(db, {
      workspaceId: w.workspaceId,
      authorAccountId: w.ownerAccountId,
      audience: { kind: 'group' },
    });
    for (const contactId of w.contactIds) {
      await insertGroupContact(db, {
        workspaceId: w.workspaceId,
        broadcastId: launchedId,
        contactId,
        addedByAccountId: w.ownerAccountId,
      });
    }
    const recipients = await launchBroadcastFixture(db, {
      broadcast: launchedId,
      launchedByAccountId: w.ownerAccountId,
      telegramBotId: bot.telegramBotId,
      recipients: w.contactIds.map((contactId) => ({ contactId })),
    });
    return {
      ...w,
      botId: bot.id,
      telegramBotId: bot.telegramBotId,
      conversationId,
      draftId,
      launchedId,
      recipientIds: recipients.map((r) => r.id),
    };
  }
  return { a: await build(tagged.a), b: await build(tagged.b) };
}
