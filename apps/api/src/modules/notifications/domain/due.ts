import { PING_SPACING_MS, TEAM_AFTER_MS, WAIT_AFTER_MS } from './constants.js';
import { isAway, type PresenceLease } from './presence.js';

export type DueKind = 'mine' | 'unassigned' | 'teammate';

/** An open conversation whose customer is waiting for a reply, with its current period. */
export interface WaitingConversation {
  id: string;
  waitingSince: Date;
  /** What began the period; a read holds a ping back only for `message` (AC-07). */
  startedBy: 'message' | 'reopen';
  assigneeAccountId: string | null;
  /** Accounts that read the waiting message, linked or not. */
  readBy: ReadonlySet<string>;
}

/** A member with a live Telegram link. */
export interface LinkedMember {
  accountId: string;
  /** The link is "Not reachable" (blocked). Such a member is still attempted when due (AC-10). */
  notReachable: boolean;
}

export interface LedgerEntry {
  conversationId: string;
  waitingSince: Date;
  accountId: string;
}

export interface DueInput {
  now: Date;
  conversations: readonly WaitingConversation[];
  linkedMembers: readonly LinkedMember[];
  /** Leases by account; a missing account has none. */
  presence: ReadonlyMap<string, readonly PresenceLease[]>;
  ledger: readonly LedgerEntry[];
  /** The last ping time to each account in the workspace. */
  lastPingAt: ReadonlyMap<string, Date>;
}

export interface DueItem {
  conversationId: string;
  waitingSince: Date;
  kind: DueKind;
}

export interface MemberDue {
  accountId: string;
  items: DueItem[];
  /** When this member may next be pinged: now, or 10 minutes after their last ping. */
  allowedAt: Date;
  sendNow: boolean;
}

export function ledgerKey(conversationId: string, waitingSince: Date, accountId: string): string {
  return `${conversationId}|${waitingSince.getTime()}|${accountId}`;
}

/**
 * Who is due for which conversation (flow 13). Only away members with a live link are considered.
 * A conversation is never due for a member who has it in the ledger for its current period, nor for one
 * who read the waiting message (unless the period began with a reopen). It is due at 5 minutes for the
 * assignee and, if unassigned, for everyone; for the rest of the team at 30 minutes, or at 5 when the
 * assignee is away, has not read it and cannot be pinged (no link, or a link not reachable) (AC-09).
 * Per member the due items are combined into one set; `sendNow` is false inside the 10-minute spacing.
 */
export function dueSets(input: DueInput): MemberDue[] {
  const { now, conversations, linkedMembers, presence, ledger, lastPingAt } = input;
  const t = now.getTime();
  const pinged = new Set(
    ledger.map((e) => ledgerKey(e.conversationId, e.waitingSince, e.accountId)),
  );
  const linked = new Map(linkedMembers.map((m) => [m.accountId, m]));
  const away = (accountId: string) => isAway(presence.get(accountId) ?? [], now);
  const holdsBack = (c: WaitingConversation, accountId: string) =>
    c.startedBy === 'message' && c.readBy.has(accountId);

  const assigneeUnpingable = (c: WaitingConversation): boolean => {
    const a = c.assigneeAccountId;
    if (a === null || !away(a) || holdsBack(c, a)) return false;
    const link = linked.get(a);
    return link === undefined || link.notReachable;
  };

  const result: MemberDue[] = [];
  for (const member of linkedMembers) {
    if (!away(member.accountId)) continue;
    const items: DueItem[] = [];
    for (const c of conversations) {
      if (pinged.has(ledgerKey(c.id, c.waitingSince, member.accountId))) continue;
      if (holdsBack(c, member.accountId)) continue;
      const age = t - c.waitingSince.getTime();
      let kind: DueKind | null = null;
      if (c.assigneeAccountId === member.accountId) {
        if (age >= WAIT_AFTER_MS) kind = 'mine';
      } else if (c.assigneeAccountId === null) {
        if (age >= WAIT_AFTER_MS) kind = 'unassigned';
      } else if (age >= TEAM_AFTER_MS || (age >= WAIT_AFTER_MS && assigneeUnpingable(c))) {
        kind = 'teammate';
      }
      if (kind) items.push({ conversationId: c.id, waitingSince: c.waitingSince, kind });
    }
    if (items.length === 0) continue;
    const last = lastPingAt.get(member.accountId);
    const allowedAt = last ? new Date(last.getTime() + PING_SPACING_MS) : now;
    const sendNow = allowedAt.getTime() <= t;
    result.push({
      accountId: member.accountId,
      items,
      allowedAt: sendNow ? now : allowedAt,
      sendNow,
    });
  }
  return result;
}
