import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type { BroadcastItemView } from '../../conversations/app/ports.js';
import type { InboxReadsDeps } from './ports.js';
import { createInboxReadUseCases } from './reads.js';

const WS = newId();
const CONVERSATION = newId();
const BROADCAST = newId();
const OWNER = newId();
const SENT = new Date('2026-10-23T09:00:10Z');
const CLAIMED = new Date('2026-10-23T09:00:05Z');

const item = (o: Partial<BroadcastItemView> = {}): BroadcastItemView => ({
  id: newId(),
  conversationId: CONVERSATION,
  broadcastId: BROADCAST,
  state: 'delivered',
  positionAt: SENT,
  telegramMessageId: 55n,
  createdAt: SENT,
  ...o,
});

function setup(entries: BroadcastItemView[]) {
  const detailCalls: string[][] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const deps = {
    conversations: {
      async threadPage() {
        return {
          items: entries.map((broadcastItem) => ({
            type: 'broadcast' as const,
            position: { at: broadcastItem.positionAt, kind: 3, id: broadcastItem.id },
            broadcastItem,
          })),
          hasPrev: false,
          hasNext: false,
          prevCursor: null,
          nextCursor: null,
          readThroughAt: null,
          newestReplyId: null,
        };
      },
    },
    contacts: {},
    workspaces: { displayNames: async () => new Map<string, string>() },
    bots: {},
    broadcasts: {
      async itemDetails(_ws: string, ids: readonly string[]) {
        detailCalls.push([...ids]);
        return ids.includes(BROADCAST)
          ? [
              {
                broadcast_id: BROADCAST,
                broadcast_name: 'Spring prices',
                text: 'New prices from Monday.',
                launched_by: { account_id: OWNER, display_name: 'Olga Owner' },
              },
            ]
          : [];
      },
    },
    broadcastItems: {
      async getBroadcastItem(workspaceId: string, conversationId: string, itemId: string) {
        const found = byId.get(itemId);
        return workspaceId === WS && found?.conversationId === conversationId ? found : null;
      },
    },
    clock: fixedClock(SENT),
  } as unknown as InboxReadsDeps;
  return { reads: createInboxReadUseCases(deps), detailCalls };
}

const dto = (i: BroadcastItemView) => ({
  type: 'broadcast',
  id: i.id,
  workspace_id: WS,
  conversation_id: CONVERSATION,
  broadcast_id: BROADCAST,
  broadcast_name: 'Spring prices',
  text: 'New prices from Monday.',
  launched_by: { account_id: OWNER, display_name: 'Olga Owner' },
  state: i.state,
  position_at: i.positionAt.toISOString(),
});

describe('inbox thread broadcast items (AC-16)', () => {
  it('enriches the page broadcast items with the name, text and launcher in one itemDetails call', async () => {
    const delivered = item();
    const notConfirmed = item({
      state: 'not_confirmed',
      positionAt: CLAIMED,
      telegramMessageId: null,
    });
    const h = setup([notConfirmed, delivered]);
    const page = await h.reads.listThreadItems(WS, CONVERSATION, { limit: 50 });
    expect(page.items).toEqual([dto(notConfirmed), dto(delivered)]);
    expect(h.detailCalls).toEqual([[BROADCAST]]);
  });

  it('a page with no broadcast items asks broadcasts nothing', async () => {
    const h = setup([]);
    expect((await h.reads.listThreadItems(WS, CONVERSATION, { limit: 50 })).items).toEqual([]);
    expect(h.detailCalls).toEqual([]);
  });

  it('reads one broadcast item; one of another conversation or workspace is not found', async () => {
    const one = item();
    const h = setup([one]);
    expect(await h.reads.getThreadBroadcastItem(WS, CONVERSATION, one.id)).toEqual(dto(one));
    await expect(h.reads.getThreadBroadcastItem(WS, newId(), one.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      h.reads.getThreadBroadcastItem(newId(), CONVERSATION, one.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
