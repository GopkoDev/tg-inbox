import { describe, expect, it } from 'vitest';
import {
  dueSets,
  ledgerKey,
  type DueInput,
  type LinkedMember,
  type WaitingConversation,
} from './due.js';
import type { PresenceLease } from './presence.js';
import { PING_SPACING_MS, TEAM_AFTER_MS, WAIT_AFTER_MS } from './constants.js';

const MIN = 60_000;
const NOW = new Date('2026-10-19T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const ME = 'acc-me';
const OTHER = 'acc-other';
const THIRD = 'acc-third';

const away: PresenceLease[] = [];
const present: PresenceLease[] = [
  { liveUntil: new Date(NOW.getTime() + 30_000), onScreen: true, lastOnScreenAt: null },
];

let n = 0;
const conv = (o: Partial<WaitingConversation> = {}): WaitingConversation => ({
  id: `conv-${++n}`,
  waitingSince: ago(6 * MIN),
  startedBy: 'message',
  assigneeAccountId: null,
  readBy: new Set(),
  ...o,
});

const member = (accountId: string, notReachable = false): LinkedMember => ({
  accountId,
  notReachable,
});

function run(o: Partial<DueInput> & { conversations: WaitingConversation[] }) {
  return dueSets({
    now: NOW,
    linkedMembers: [member(ME)],
    presence: new Map(),
    ledger: [],
    lastPingAt: new Map(),
    ...o,
  });
}

const kinds = (r: ReturnType<typeof run>, account: string) =>
  r.find((m) => m.accountId === account)?.items.map((i) => i.kind);

describe('constants', () => {
  it('uses 5 and 30 minutes and a 10-minute spacing', () => {
    expect(WAIT_AFTER_MS).toBe(5 * MIN);
    expect(TEAM_AFTER_MS).toBe(30 * MIN);
    expect(PING_SPACING_MS).toBe(10 * MIN);
  });
});

describe('dueSets, the 5-minute marks (AC-07)', () => {
  it('is due as mine 5 minutes after the period start for the assignee', () => {
    const c = conv({ assigneeAccountId: ME, waitingSince: ago(5 * MIN) });
    const r = run({ conversations: [c] });
    expect(r).toHaveLength(1);
    expect(r[0]?.items).toEqual([
      { conversationId: c.id, waitingSince: c.waitingSince, kind: 'mine' },
    ]);
  });

  it('is not due before 5 minutes', () => {
    expect(
      run({ conversations: [conv({ assigneeAccountId: ME, waitingSince: ago(5 * MIN - 1) })] }),
    ).toEqual([]);
  });

  it('is due as unassigned at 5 minutes for every away linked member', () => {
    const c = conv();
    const r = run({
      conversations: [c],
      linkedMembers: [member(ME), member(OTHER)],
    });
    expect(kinds(r, ME)).toEqual(['unassigned']);
    expect(kinds(r, OTHER)).toEqual(['unassigned']);
  });

  it('skips a member who is present', () => {
    const r = run({
      conversations: [conv()],
      linkedMembers: [member(ME), member(OTHER)],
      presence: new Map([[OTHER, present]]),
    });
    expect(r.map((m) => m.accountId)).toEqual([ME]);
  });

  it('treats a member with only expired leases as away', () => {
    const expired: PresenceLease[] = [{ liveUntil: ago(1), onScreen: true, lastOnScreenAt: null }];
    const r = run({ conversations: [conv()], presence: new Map([[ME, expired]]) });
    expect(kinds(r, ME)).toEqual(['unassigned']);
  });

  it('becomes due the moment a present member becomes away (next sweep)', () => {
    const c = conv();
    expect(run({ conversations: [c], presence: new Map([[ME, present]]) })).toEqual([]);
    expect(kinds(run({ conversations: [c], presence: new Map([[ME, away]]) }), ME)).toEqual([
      'unassigned',
    ]);
  });
});

describe('dueSets, read holds back unless the period began with a reopen (AC-07)', () => {
  it('is not due for a member who read the waiting message', () => {
    const c = conv({ assigneeAccountId: ME, readBy: new Set([ME]) });
    expect(run({ conversations: [c] })).toEqual([]);
  });

  it('is still due for a reader when the period began with a reopen', () => {
    const c = conv({ assigneeAccountId: ME, startedBy: 'reopen', readBy: new Set([ME]) });
    expect(kinds(run({ conversations: [c] }), ME)).toEqual(['mine']);
  });

  it('holds back only the member who read, not the others', () => {
    const c = conv({ readBy: new Set([ME]) });
    const r = run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] });
    expect(r.map((m) => m.accountId)).toEqual([OTHER]);
  });
});

describe('dueSets, the ledger (AC-08)', () => {
  it('skips a conversation already pinged to this member for this period', () => {
    const c = conv({ assigneeAccountId: ME });
    const r = run({
      conversations: [c],
      ledger: [{ conversationId: c.id, waitingSince: c.waitingSince, accountId: ME }],
    });
    expect(r).toEqual([]);
  });

  it('is due again in a new waiting period of the same conversation', () => {
    const c = conv({ assigneeAccountId: ME });
    const r = run({
      conversations: [c],
      ledger: [{ conversationId: c.id, waitingSince: ago(60 * MIN), accountId: ME }],
    });
    expect(kinds(r, ME)).toEqual(['mine']);
  });

  it('counts the ledger per member', () => {
    const c = conv();
    const r = run({
      conversations: [c],
      linkedMembers: [member(ME), member(OTHER)],
      ledger: [{ conversationId: c.id, waitingSince: c.waitingSince, accountId: ME }],
    });
    expect(r.map((m) => m.accountId)).toEqual([OTHER]);
  });

  it('builds ledger keys from member, conversation and the period instant', () => {
    const t = new Date('2026-10-19T09:00:00Z');
    expect(ledgerKey('c', t, 'a')).toBe(ledgerKey('c', new Date(t.getTime()), 'a'));
    expect(ledgerKey('c', t, 'a')).not.toBe(ledgerKey('c', new Date(t.getTime() + 1), 'a'));
    expect(ledgerKey('c', t, 'a')).not.toBe(ledgerKey('c', t, 'b'));
  });
});

describe('dueSets, the team reach (AC-09)', () => {
  it('does not ping the team at 6 minutes while the assignee is present', () => {
    const c = conv({ assigneeAccountId: OTHER });
    const r = run({
      conversations: [c],
      linkedMembers: [member(ME), member(OTHER)],
      presence: new Map([[OTHER, present]]),
    });
    expect(kinds(r, ME)).toBeUndefined();
  });

  it('does not ping the team at 6 minutes when the assignee is away but has read it', () => {
    const c = conv({ assigneeAccountId: OTHER, readBy: new Set([OTHER]) });
    const r = run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] });
    expect(kinds(r, ME)).toBeUndefined();
  });

  it('does not ping the team at 6 minutes when the assignee is away, unread and reachable', () => {
    const c = conv({ assigneeAccountId: OTHER });
    const r = run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] });
    expect(kinds(r, ME)).toBeUndefined();
    expect(kinds(r, OTHER)).toEqual(['mine']);
  });

  it("pings the team at 30 minutes as a teammate's", () => {
    const c = conv({
      assigneeAccountId: OTHER,
      waitingSince: ago(30 * MIN),
      readBy: new Set([OTHER]),
    });
    const r = run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] });
    expect(kinds(r, ME)).toEqual(['teammate']);
  });

  it('does not ping the team at 29 minutes', () => {
    const c = conv({
      assigneeAccountId: OTHER,
      waitingSince: ago(30 * MIN - 1),
      readBy: new Set([OTHER]),
    });
    expect(kinds(run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] }), ME)).toBe(
      undefined,
    );
  });

  it('pings the team at 5 minutes when the assignee is away, unread and has no link', () => {
    const c = conv({ assigneeAccountId: OTHER });
    const r = run({ conversations: [c], linkedMembers: [member(ME)] });
    expect(kinds(r, ME)).toEqual(['teammate']);
  });

  it('pings the team at 5 minutes when the assignee link is not reachable', () => {
    const c = conv({ assigneeAccountId: OTHER });
    const r = run({
      conversations: [c],
      linkedMembers: [member(ME), member(OTHER, true)],
    });
    expect(kinds(r, ME)).toEqual(['teammate']);
    // The unreachable assignee is still attempted when due.
    expect(kinds(r, OTHER)).toEqual(['mine']);
  });

  it('keeps the unlinked assignee reachable while present', () => {
    const c = conv({ assigneeAccountId: OTHER });
    const r = run({ conversations: [c], presence: new Map([[OTHER, present]]) });
    expect(r).toEqual([]);
  });

  it('keeps the unlinked assignee reachable once they read the message', () => {
    const c = conv({ assigneeAccountId: OTHER, readBy: new Set([OTHER]) });
    expect(run({ conversations: [c] })).toEqual([]);
  });

  it("ignores the assignee's earlier reads in a reopened period", () => {
    const c = conv({ assigneeAccountId: OTHER, startedBy: 'reopen', readBy: new Set([OTHER]) });
    expect(kinds(run({ conversations: [c] }), ME)).toEqual(['teammate']);
  });

  it('does not ping the assignee as a teammate', () => {
    const c = conv({ assigneeAccountId: ME, waitingSince: ago(40 * MIN) });
    expect(kinds(run({ conversations: [c] }), ME)).toEqual(['mine']);
  });
});

describe('dueSets, reassignment and unassigning (AC-08)', () => {
  it('a reassignment keeps the clock: a new away assignee is due at once at 7 minutes', () => {
    const c = conv({ assigneeAccountId: THIRD, waitingSince: ago(7 * MIN) });
    const r = run({ conversations: [c], linkedMembers: [member(THIRD)] });
    expect(kinds(r, THIRD)).toEqual(['mine']);
  });

  it('unassigning at 7 minutes makes it due at once for the away members as unassigned', () => {
    const c = conv({ assigneeAccountId: null, waitingSince: ago(7 * MIN) });
    const r = run({ conversations: [c], linkedMembers: [member(ME), member(OTHER)] });
    expect(kinds(r, ME)).toEqual(['unassigned']);
    expect(kinds(r, OTHER)).toEqual(['unassigned']);
  });
});

describe('dueSets, the 10-minute spacing (AC-08)', () => {
  it('is sendable now when the member was never pinged', () => {
    const [m] = run({ conversations: [conv()] });
    expect(m?.sendNow).toBe(true);
    expect(m?.allowedAt).toEqual(NOW);
  });

  it('waits when the last ping was 6 minutes ago, with the allowed moment 10 minutes after it', () => {
    const last = ago(6 * MIN);
    const [m] = run({ conversations: [conv()], lastPingAt: new Map([[ME, last]]) });
    expect(m?.sendNow).toBe(false);
    expect(m?.allowedAt).toEqual(new Date(last.getTime() + 10 * MIN));
    expect(m?.items).toHaveLength(1);
  });

  it('is sendable at exactly 10 minutes after the last ping', () => {
    const [m] = run({ conversations: [conv()], lastPingAt: new Map([[ME, ago(10 * MIN)]]) });
    expect(m?.sendNow).toBe(true);
  });

  it('combines everything due into one set per member', () => {
    const a = conv({ assigneeAccountId: ME });
    const b = conv();
    const c = conv({
      assigneeAccountId: OTHER,
      waitingSince: ago(31 * MIN),
      readBy: new Set([OTHER]),
    });
    const r = run({ conversations: [a, b, c], linkedMembers: [member(ME), member(OTHER)] });
    const mine = r.find((m) => m.accountId === ME);
    expect(mine?.items.map((i) => [i.conversationId, i.kind])).toEqual([
      [a.id, 'mine'],
      [b.id, 'unassigned'],
      [c.id, 'teammate'],
    ]);
    expect(r.filter((m) => m.accountId === ME)).toHaveLength(1);
  });

  it('spaces each member by their own last ping', () => {
    const r = run({
      conversations: [conv()],
      linkedMembers: [member(ME), member(OTHER)],
      lastPingAt: new Map([[ME, ago(MIN)]]),
    });
    expect(r.find((m) => m.accountId === ME)?.sendNow).toBe(false);
    expect(r.find((m) => m.accountId === OTHER)?.sendNow).toBe(true);
  });

  it('returns nothing when nothing is due', () => {
    expect(run({ conversations: [] })).toEqual([]);
    expect(run({ conversations: [conv({ waitingSince: ago(MIN) })] })).toEqual([]);
  });
});
