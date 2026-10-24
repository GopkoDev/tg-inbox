import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import { createContactAudiences, REACHABLE_LIMIT } from './audiences.js';
import { fakeAudienceQuery, fakeContactRepo, fakeTagStore } from './fakes.js';

const WS = newId();
const BOT = 9001n;
const T = new Date('2026-10-01T10:00:00Z');

async function setup() {
  const contactRepo = fakeContactRepo();
  const store = fakeTagStore();
  const query = fakeAudienceQuery(contactRepo, store);
  const audiences = createContactAudiences({
    audiences: query,
    tags: {
      async resolveIds(ws, ids) {
        return store.tags
          .filter((t) => t.workspaceId === ws && ids.includes(t.id))
          .map((t) => t.id);
      },
      async namesOf(ws, ids) {
        return store.tags
          .filter((t) => t.workspaceId === ws && ids.includes(t.id))
          .map((t) => ({ id: t.id, name: t.name }));
      },
    },
  });
  let n = 0;
  const contact = async (o: { wrote?: boolean; blocked?: boolean } = {}) => {
    n += 1;
    const { contactId } = await contactRepo.upsertFromProfile(
      WS,
      {
        telegramUserId: BigInt(800000 + n),
        firstName: n === 1 ? 'Olena' : 'Test User',
        lastName: null,
        username: null,
        languageCode: 'en',
      },
      T,
      T,
    );
    if (o.wrote !== false || o.blocked)
      query.reach.push({
        workspaceId: WS,
        contactId,
        telegramBotId: BOT,
        wroteAt: o.wrote === false ? null : T,
        blockedAt: o.blocked ? T : null,
      });
    return contactId;
  };
  return { audiences, query, store, contact };
}

describe('contacts audiences (app layer, ADR-0004)', () => {
  it('leaves tags that no longer exist out of a tag audience before evaluating it', async () => {
    const { audiences, store, contact } = await setup();
    const vip = store.addTag(WS, 'VIP');
    const gone = newId();
    const c1 = await contact();
    await contact();
    store.link(WS, c1, vip, newId(), T);
    const breakdown = await audiences.audienceBreakdown(
      WS,
      { kind: 'tags', mode: 'all', include: [vip, gone], exclude: [gone] },
      BOT,
    );
    expect(breakdown).toEqual({
      audienceSize: 1,
      reach: { blocked: 0, neverWrote: 0, reachable: 1 },
    });
  });

  it('partitions blocked, then never wrote, then reachable; reach is null without a bot', async () => {
    const { audiences, contact } = await setup();
    const ids = [
      await contact(),
      await contact({ blocked: true }),
      await contact({ wrote: false, blocked: true }),
      await contact({ wrote: false }),
    ];
    const audience = { kind: 'ids', contactIds: ids } as const;
    expect(await audiences.audienceBreakdown(WS, audience, BOT)).toEqual({
      audienceSize: 4,
      reach: { blocked: 2, neverWrote: 1, reachable: 1 },
    });
    expect(await audiences.audienceBreakdown(WS, audience, null)).toEqual({
      audienceSize: 4,
      reach: null,
    });
  });

  it('answers an empty group without querying', async () => {
    const { audiences, query } = await setup();
    const empty = { kind: 'ids', contactIds: [] } as const;
    expect(await audiences.audienceBreakdown(WS, empty, BOT)).toEqual({
      audienceSize: 0,
      reach: { blocked: 0, neverWrote: 0, reachable: 0 },
    });
    expect(await audiences.audienceBreakdown(WS, empty, null)).toEqual({
      audienceSize: 0,
      reach: null,
    });
    expect(await audiences.reachableContacts(WS, empty, BOT)).toEqual([]);
    expect(query.calls).toEqual([]);
  });

  it('asks for at most 10 001 reachable contacts unless told otherwise', async () => {
    const { audiences, query, contact } = await setup();
    const a = await contact();
    const b = await contact();
    expect(REACHABLE_LIMIT).toBe(10_001);
    await audiences.reachableContacts(WS, { kind: 'ids', contactIds: [b, a] }, BOT);
    expect(query.calls.at(-1)).toEqual(`reachable:${REACHABLE_LIMIT}`);
    const one = await audiences.reachableContacts(WS, { kind: 'ids', contactIds: [b, a] }, BOT, 1);
    expect(one).toEqual([{ id: [a, b].sort()[0], telegramUserId: expect.any(BigInt) }]);
  });

  it('matches like the Contacts list: the search normalised, unknown tags left out', async () => {
    const { audiences, store, contact } = await setup();
    const vip = store.addTag(WS, 'VIP');
    const olena = await contact();
    const other = await contact();
    store.link(WS, olena, vip, newId(), T);
    store.link(WS, other, vip, newId(), T);
    expect(
      await audiences.matchingContactIds(WS, { q: '  @olena ', mode: 'any', tagIds: [vip] }),
    ).toEqual([olena]);
    expect(await audiences.matchingContactIds(WS, { mode: 'all', tagIds: [vip, newId()] })).toEqual(
      [olena, other].sort(),
    );
  });
});
