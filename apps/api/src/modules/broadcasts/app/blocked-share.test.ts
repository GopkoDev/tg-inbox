import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import type { RecipientState } from '../domain/recipient.js';
import { createMeasureBlockedShare } from './blocked-share.js';
import {
  fakeBroadcastRepo,
  fakeBroadcastStore,
  fakeContactsApi,
  fakeRecipientRepo,
} from './fakes.js';
import type { BroadcastRecord } from './ports.js';

const WS = newId();
const OTHER_WS = newId();
const OWNER = newId();
const AT = new Date('2026-10-23T09:00:00Z');
const BOT = 7001n;
const OTHER_BOT = 7002n;

function setup() {
  const store = fakeBroadcastStore();
  const contacts = fakeContactsApi();
  const lines: { obj: Record<string, unknown>; msg: string }[] = [];
  const logger = {
    info(obj: object, msg: string) {
      lines.push({ obj: obj as Record<string, unknown>, msg });
    },
  };
  let breakdownCalls = 0;
  const measure = createMeasureBlockedShare({
    broadcasts: fakeBroadcastRepo(store),
    recipients: fakeRecipientRepo(store),
    contacts: {
      async audienceBreakdown(ws, audience, bot) {
        breakdownCalls += 1;
        return contacts.audienceBreakdown(ws, audience, bot);
      },
    },
    logger,
  });

  /** A broadcast of `ws` whose recipients have `states`; each recipient is a contact of `ws`. */
  const broadcast = (
    ws: string,
    states: { state: RecipientState; blockedFor?: bigint[] }[],
    o: Partial<BroadcastRecord> = {},
  ) => {
    const row: BroadcastRecord = {
      id: newId(),
      workspaceId: ws,
      name: 'Spring prices',
      text: 'New prices from Monday.',
      status: 'sent',
      version: 2,
      audienceKind: 'tags',
      tagMode: 'any',
      authorAccountId: OWNER,
      lastChangedByAccountId: OWNER,
      lastChangedAt: AT,
      createdAt: AT,
      launchedAt: AT,
      launchedByAccountId: OWNER,
      launchTelegramBotId: BOT,
      audienceSize: states.length,
      blockedCount: 0,
      neverWroteCount: 0,
      recipientCount: states.length,
      stoppedAt: null,
      stoppedByAccountId: null,
      endedAt: AT,
      endReason: 'completed',
      ...o,
    };
    store.broadcasts.push(row);
    const list = contacts.contacts.get(ws) ?? [];
    contacts.contacts.set(ws, list);
    states.forEach(({ state, blockedFor = [] }, i) => {
      const contactId = newId();
      list.push({
        id: contactId,
        firstName: `Customer ${i}`,
        tagIds: [],
        wroteTo: [BOT, OTHER_BOT],
        blocked: new Map(blockedFor.map((b) => [b, AT])),
      });
      store.recipients.push({
        workspaceId: ws,
        id: newId(),
        broadcastId: row.id,
        contactId,
        position: i + 1,
        telegramUserId: BigInt(900_000 + i),
        state,
        failureReason: null,
        claimedAt: AT,
        outcomeAt: AT,
        telegramMessageId: state === 'delivered' ? 1n : null,
      });
    });
    return row;
  };

  return { measure, lines, broadcast, breakdownCalls: () => breakdownCalls };
}

describe('measureBlockedShare (spec §7 KPI, AC-11)', () => {
  it('counts the delivered recipients now blocked for the launch bot and logs one broadcast.blocked_share line', async () => {
    const h = setup();
    const b = h.broadcast(WS, [
      { state: 'delivered' },
      { state: 'delivered', blockedFor: [BOT] },
      // Blocked another bot only: not counted.
      { state: 'delivered', blockedFor: [OTHER_BOT] },
      { state: 'delivered' },
      // Not delivered: never counted, blocked or not.
      { state: 'blocked', blockedFor: [BOT] },
      { state: 'failed', blockedFor: [BOT] },
    ]);

    const got = await h.measure.measureBlockedShare(WS, b.id);

    expect(got).toEqual({ deliveredCount: 4, blockedSinceCount: 1, share: 0.25 });
    expect(h.lines).toEqual([
      {
        msg: 'broadcast.blocked_share',
        obj: {
          workspace_id: WS,
          broadcast_id: b.id,
          delivered_count: 4,
          blocked_since_count: 1,
          share: 0.25,
        },
      },
    ]);
    // Ids and counts only: no text, name, username or chat id.
    const logged = JSON.stringify(h.lines);
    expect(logged).not.toContain('New prices');
    expect(logged).not.toContain('Spring prices');
    expect(logged).not.toContain('Customer');
    expect(logged).not.toContain('900000');
  });

  it('a broadcast that delivered nothing logs share 0 without asking contacts', async () => {
    const h = setup();
    const b = h.broadcast(WS, [{ state: 'failed' }, { state: 'stopped' }], {
      endReason: 'bot_stopped',
    });

    const got = await h.measure.measureBlockedShare(WS, b.id);

    expect(got).toEqual({ deliveredCount: 0, blockedSinceCount: 0, share: 0 });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]!.obj).toMatchObject({ delivered_count: 0, blocked_since_count: 0, share: 0 });
    expect(h.breakdownCalls()).toBe(0);
  });

  it("another workspace's broadcast, an unknown id and a draft are not measured and log nothing", async () => {
    const h = setup();
    const foreign = h.broadcast(OTHER_WS, [{ state: 'delivered', blockedFor: [BOT] }]);
    const draft = h.broadcast(WS, [], {
      status: 'draft',
      launchedAt: null,
      launchTelegramBotId: null,
      endedAt: null,
      endReason: null,
    });

    expect(await h.measure.measureBlockedShare(WS, foreign.id)).toBeNull();
    expect(await h.measure.measureBlockedShare(WS, newId())).toBeNull();
    expect(await h.measure.measureBlockedShare(WS, draft.id)).toBeNull();
    expect(h.lines).toEqual([]);
  });
});
