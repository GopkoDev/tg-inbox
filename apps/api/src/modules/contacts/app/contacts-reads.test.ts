import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import { createContactReads } from './contacts.js';
import { fakeContactRepo, fakeTagStore, fakeReadPorts } from './fakes.js';
import type { ContactProfile } from './ports.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const WS = newId();
const OTHER_WS = newId();
const ALICE = newId(); // an operator, since deactivated
const OWNER = newId();

const profile = (n: number, o: Partial<ContactProfile> = {}): ContactProfile => ({
  telegramUserId: BigInt(900000 + n),
  firstName: `User ${n}`,
  lastName: null,
  username: null,
  languageCode: 'en',
  ...o,
});

async function setup() {
  const contactRepo = fakeContactRepo();
  const store = fakeTagStore();
  const names = new Map([
    [ALICE, 'Alice (deactivated)'],
    [OWNER, 'Olga Owner'],
  ]);
  const reads = createContactReads({
    repo: contactRepo,
    ...fakeReadPorts(contactRepo, store),
    workspaces: {
      // Like workspaces.displayNames: only accounts that belong to the workspace, deactivated included.
      displayNames: async (ws, ids) =>
        new Map(ids.filter((id) => names.has(id) && ws === WS).map((id) => [id, names.get(id)!])),
    },
  });
  const contact = async (n: number, wroteAt: number, ws = WS, p: Partial<ContactProfile> = {}) =>
    (await contactRepo.upsertFromProfile(ws, profile(n, p), at(wroteAt), at(0))).contactId;
  return { reads, contactRepo, store, contact };
}

describe('listContacts (AC-01, AC-02)', () => {
  it('lists the workspace contacts newest last wrote first with counts and an echoed filter', async () => {
    const { reads, contact, store } = await setup();
    const old = await contact(1, 10);
    const recent = await contact(2, 20);
    await contact(3, 30, OTHER_WS);
    const vip = store.addTag(WS, 'VIP');
    store.link(WS, recent, vip, ALICE, at(5));
    const page = await reads.listContacts(WS, { q: undefined, mode: 'any' });
    expect(page.items.map((i) => i.id)).toEqual([recent, old]);
    expect(page.items[0]).toMatchObject({
      workspace_id: WS,
      first_name: 'User 2',
      language_code: 'en',
      first_wrote_at: at(20).toISOString(),
      last_wrote_at: at(20).toISOString(),
      tags: [{ id: vip, name: 'VIP' }],
    });
    expect(page).toMatchObject({
      workspace_id: WS,
      filter: { q: null, mode: 'any', tag_ids: [] },
      has_prev: false,
      has_next: false,
      next_cursor: null,
      matching_count: 2,
      total_count: 2,
      missing_tag_ids: [],
    });
  });

  it('normalises the search ("@Olena " finds olena) and echoes the normalised text', async () => {
    const { reads, contact } = await setup();
    const olena = await contact(1, 10, WS, { username: 'olena_k' });
    await contact(2, 20);
    const page = await reads.listContacts(WS, { q: '  @Olena ', mode: 'any' });
    expect(page.items.map((i) => i.id)).toEqual([olena]);
    expect(page.filter.q).toBe('Olena');
    expect(page.matching_count).toBe(1);
    expect(page.total_count).toBe(2);
    expect((await reads.listContacts(WS, { q: ' @ ', mode: 'any' })).filter.q).toBeNull();
  });

  it('refuses none with tags as a validation error on the tag field', async () => {
    const { reads, store } = await setup();
    const vip = store.addTag(WS, 'VIP');
    await expect(reads.listContacts(WS, { mode: 'none', tagIds: [vip] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { field: 'tag' },
    });
    // none with an empty list is fine
    await expect(reads.listContacts(WS, { mode: 'none', tagIds: [] })).resolves.toBeDefined();
  });

  it('drops ids that are not tags of the workspace, reports them as missing and echoes the resolved ids', async () => {
    const { reads, contact, store } = await setup();
    const vip = store.addTag(WS, 'VIP');
    const foreign = store.addTag(OTHER_WS, 'VIP');
    const gone = newId();
    const c = await contact(1, 10);
    store.link(WS, c, vip, ALICE, at(1));
    await contact(2, 20);
    const page = await reads.listContacts(WS, { mode: 'any', tagIds: [vip, gone, foreign, vip] });
    expect(page.filter.tag_ids).toEqual([vip]);
    expect(page.missing_tag_ids).toEqual([gone, foreign]);
    expect(page.items.map((i) => i.id)).toEqual([c]);
    expect(page.matching_count).toBe(1);
  });

  it('with every requested tag missing, filters nothing', async () => {
    const { reads, contact } = await setup();
    await contact(1, 10);
    await contact(2, 20);
    const page = await reads.listContacts(WS, { mode: 'all', tagIds: [newId()] });
    expect(page.items).toHaveLength(2);
    expect(page.matching_count).toBe(2);
    expect(page.missing_tag_ids).toHaveLength(1);
  });

  it.each(['any', 'all'] as const)(
    '%s with no tag chosen filters nothing (matching_count equals total_count)',
    async (mode) => {
      const { reads, contact, store } = await setup();
      const c1 = await contact(1, 10);
      await contact(2, 20);
      store.link(WS, c1, store.addTag(WS, 'VIP'), ALICE, at(1));
      const page = await reads.listContacts(WS, { mode, tagIds: [] });
      expect(page.matching_count).toBe(2);
      expect(page.total_count).toBe(2);
      expect(page.items).toHaveLength(2);
    },
  );

  it('a tag renamed since the link was saved still resolves and filters, and shows its new name', async () => {
    const { reads, contact, store } = await setup();
    const loyal = store.addTag(WS, 'Loyal');
    const c = await contact(1, 10);
    await contact(2, 20);
    store.link(WS, c, loyal, ALICE, at(1));
    store.renameTag(WS, loyal, 'Loyal customers');
    const page = await reads.listContacts(WS, { mode: 'any', tagIds: [loyal] });
    expect(page.missing_tag_ids).toEqual([]);
    expect(page.items.map((i) => i.id)).toEqual([c]);
    expect(page.items[0]!.tags).toEqual([{ id: loyal, name: 'Loyal customers' }]);
  });

  it('continues from the cursor with no repeat, and refuses a cursor from another filter', async () => {
    const { reads, contact } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(await contact(i, i));
    const first = await reads.listContacts(WS, { mode: 'any' });
    expect(first.items).toHaveLength(50);
    expect(first.has_next).toBe(true);
    expect(first.next_cursor).not.toBeNull();
    const second = await reads.listContacts(WS, { mode: 'any', after: first.next_cursor! });
    expect(second.has_prev).toBe(true);
    expect(second.has_next).toBe(false);
    expect(second.next_cursor).toBeNull();
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([...ids].reverse());
    await expect(
      reads.listContacts(WS, { mode: 'any', q: 'user', after: first.next_cursor! }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(reads.listContacts(WS, { mode: 'any', after: 'garbage' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('getContact (AC-04, AC-13)', () => {
  it('returns the facts with tags in tag-list order and the adders named, deactivated members included', async () => {
    const { reads, contact, store } = await setup();
    const c = await contact(1, 10, WS, { username: 'u1', lastName: 'Last' });
    const kyiv = store.addTag(WS, 'Kyiv');
    const apple = store.addTag(WS, 'apple');
    store.link(WS, c, kyiv, ALICE, at(3));
    store.link(WS, c, apple, OWNER, at(4));
    const profileDto = await reads.getContact(WS, c);
    expect(profileDto).toEqual({
      id: c,
      workspace_id: WS,
      first_name: 'User 1',
      last_name: 'Last',
      username: 'u1',
      language_code: 'en',
      first_wrote_at: at(10).toISOString(),
      last_wrote_at: at(10).toISOString(),
      tags: [
        {
          id: apple,
          name: 'apple',
          added_by: { account_id: OWNER, display_name: 'Olga Owner' },
          added_at: at(4).toISOString(),
        },
        {
          id: kyiv,
          name: 'Kyiv',
          added_by: { account_id: ALICE, display_name: 'Alice (deactivated)' },
          added_at: at(3).toISOString(),
        },
      ],
    });
  });

  it('is not found for an unknown id and for a contact of another workspace', async () => {
    const { reads, contact } = await setup();
    const foreign = await contact(1, 10, OTHER_WS);
    await expect(reads.getContact(WS, foreign)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    await expect(reads.getContact(WS, newId())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listTagHistory (AC-04, AC-13)', () => {
  it('names the actors, keeps the tag name of the moment and pages 50 newest first', async () => {
    const { reads, contact, store } = await setup();
    const c = await contact(1, 10);
    const vip = store.addTag(WS, 'VIP');
    for (let i = 0; i < 55; i++) {
      store.history(WS, c, {
        tagId: vip,
        tagName: i === 54 ? 'Loyal' : 'VIP',
        kind: i === 54 ? 'merged' : 'added',
        mergedInto: i === 54 ? { tagId: vip, name: 'VIP' } : null,
        actorAccountId: i === 54 ? OWNER : ALICE,
        source: i === 54 ? 'settings' : 'profile',
        createdAt: at(100 + i),
      });
    }
    const first = await reads.listTagHistory(WS, c);
    expect(first.items).toHaveLength(50);
    expect(first).toMatchObject({
      workspace_id: WS,
      contact_id: c,
      has_prev: false,
      has_next: true,
    });
    expect(first.items[0]).toMatchObject({
      kind: 'merged',
      tag_name: 'Loyal',
      merged_into_tag_id: vip,
      merged_into_name: 'VIP',
      actor: { account_id: OWNER, display_name: 'Olga Owner' },
      source: 'settings',
      created_at: at(154).toISOString(),
    });
    expect(first.items[1]!.actor).toEqual({
      account_id: ALICE,
      display_name: 'Alice (deactivated)',
    });
    const second = await reads.listTagHistory(WS, c, first.next_cursor!);
    expect(second.items).toHaveLength(5);
    expect(second).toMatchObject({ has_prev: true, has_next: false, next_cursor: null });
    await expect(reads.listTagHistory(WS, c, 'garbage')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('is not found for an unknown contact and for one of another workspace', async () => {
    const { reads, contact } = await setup();
    const foreign = await contact(1, 10, OTHER_WS);
    await expect(reads.listTagHistory(WS, foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(reads.listTagHistory(WS, newId())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
