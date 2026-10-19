import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { fakeContactRepo, fakeTagStore, fakeTagWritePorts } from './fakes.js';
import { createTagAdmin } from './tag-admin.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000);
const WS = newId();
const OTHER_WS = newId();
const OWNER = newId();
const OP = newId();

async function setup() {
  const contactRepo = fakeContactRepo();
  const store = fakeTagStore();
  const ports = fakeTagWritePorts(contactRepo, store);
  const logs: { obj: Record<string, unknown>; msg: string }[] = [];
  const admin = createTagAdmin({
    transaction: ports.transaction,
    tags: ports.tags,
    contactTags: ports.contactTags,
    tagHistory: ports.tagHistory,
    signals: ports.signals,
    clock: fixedClock(NOW),
    logger: { info: (obj, msg) => logs.push({ obj: obj as Record<string, unknown>, msg }) },
  });
  let n = 0;
  const contact = async (ws = WS) =>
    (
      await contactRepo.upsertFromProfile(
        ws,
        {
          telegramUserId: BigInt(5000 + n++),
          firstName: `C${n}`,
          lastName: null,
          username: null,
          languageCode: null,
        },
        NOW,
        NOW,
      )
    ).contactId;
  return { admin, store, ports, contact, logs };
}
type S = Awaited<ReturnType<typeof setup>>;
const carry = (s: S, c: string, t: string, by = OP, when = at(-100)) =>
  s.store.link(WS, c, t, by, when);

describe('listTags (AC-02, AC-10)', () => {
  it('lists the workspace tags with counts in tag-list order, zero counts included', async () => {
    const s = await setup();
    const c = await s.contact();
    const b = s.store.addTag(WS, 'beta');
    const a = s.store.addTag(WS, 'Alpha');
    const z = s.store.addTag(WS, 'Zero');
    s.store.addTag(OTHER_WS, 'Foreign');
    carry(s, c, a);
    carry(s, c, b);
    expect(await s.admin.listTags(WS)).toEqual({
      workspace_id: WS,
      items: [
        { id: a, name: 'Alpha', contact_count: 1 },
        { id: b, name: 'beta', contact_count: 1 },
        { id: z, name: 'Zero', contact_count: 0 },
      ],
    });
  });
});

describe('renameTag (AC-09)', () => {
  it('renames keeping the id, writes no history and publishes one tags.changed', async () => {
    const s = await setup();
    const c = await s.contact();
    const t = s.store.addTag(WS, 'Loyal');
    carry(s, c, t);
    const res = await s.admin.renameTag(WS, OWNER, t, { name: '  Regular  customers ' });
    expect(res).toEqual({
      workspace_id: WS,
      outcome: 'renamed',
      tag: { id: t, name: 'Regular customers', contact_count: 1 },
      merged_tag_id: null,
    });
    expect(s.store.entries).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([`tags.changed:${WS}`]);
    expect(s.ports.events).toEqual(['lock:tags', 'lock:for-update']);
  });

  it('a case-only rename changes only the shown name (same key, same id)', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'vip');
    const res = await s.admin.renameTag(WS, OWNER, t, { name: 'VIP' });
    expect(res).toMatchObject({ outcome: 'renamed', tag: { id: t, name: 'VIP' } });
    expect(s.ports.signalLog).toEqual([`tags.changed:${WS}`]);
  });

  it('the same text is a no-op success that publishes nothing', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'VIP');
    const res = await s.admin.renameTag(WS, OWNER, t, { name: ' VIP ' });
    expect(res).toMatchObject({
      outcome: 'unchanged',
      tag: { id: t, name: 'VIP' },
      merged_tag_id: null,
    });
    expect(s.ports.signalLog).toEqual([]);
  });

  it('refuses a name another tag holds with that tag and its count (the merge offer)', async () => {
    const s = await setup();
    const vip = s.store.addTag(WS, 'VIP');
    const loyal = s.store.addTag(WS, 'Loyal');
    for (let i = 0; i < 3; i++) carry(s, await s.contact(), vip);
    await expect(s.admin.renameTag(WS, OWNER, loyal, { name: 'vip' })).rejects.toMatchObject({
      code: 'TAG_NAME_TAKEN',
      statusCode: 409,
      details: { tag: { id: vip, name: 'VIP', contact_count: 3 } },
    });
    expect(s.store.tags.find((t) => t.id === loyal)?.name).toBe('Loyal');
    expect(s.ports.signalLog).toEqual([]);
  });

  it('follows the name rules (AC-07) and answers TAG_NOT_FOUND for a gone or foreign tag', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'VIP');
    for (const name of ['', '   ', 'x'.repeat(33)]) {
      await expect(s.admin.renameTag(WS, OWNER, t, { name })).rejects.toMatchObject({
        code: 'TAG_NAME_INVALID',
      });
    }
    const foreign = s.store.addTag(OTHER_WS, 'VIP');
    for (const id of [foreign, newId()]) {
      await expect(s.admin.renameTag(WS, OWNER, id, { name: 'Other' })).rejects.toMatchObject({
        code: 'TAG_NOT_FOUND',
        statusCode: 404,
        details: { tag_id: id },
      });
    }
    expect(s.ports.signalLog).toEqual([]);
  });

  it('a history entry written before the rename still reads under the old name (AC-04)', async () => {
    const s = await setup();
    const c = await s.contact();
    const t = s.store.addTag(WS, 'Loyal');
    s.store.history(WS, c, {
      tagId: t,
      tagName: 'Loyal',
      kind: 'added',
      mergedInto: null,
      actorAccountId: OP,
      source: 'inbox',
      createdAt: at(-5),
    });
    await s.admin.renameTag(WS, OWNER, t, { name: 'Regular' });
    expect(s.store.entries[0]?.tagName).toBe('Loyal');
  });

  describe('the confirmed merge', () => {
    it('re-points carriers keeping adder and time, keeps the earlier link, writes one merged entry per carrier, deletes the tag', async () => {
      const s = await setup();
      const vip = s.store.addTag(WS, 'VIP');
      const loyal = s.store.addTag(WS, 'Loyal');
      const onlyLoyal = await s.contact();
      const both = await s.contact();
      const onlyVip = await s.contact();
      carry(s, onlyLoyal, loyal, OP, at(-300));
      carry(s, both, loyal, OWNER, at(-500)); // earlier than the VIP link
      carry(s, both, vip, OP, at(-200));
      carry(s, onlyVip, vip, OP, at(-100));
      const res = await s.admin.renameTag(WS, OWNER, loyal, { name: 'vip', mergeIntoTagId: vip });
      expect(res).toEqual({
        workspace_id: WS,
        outcome: 'merged',
        tag: { id: vip, name: 'VIP', contact_count: 3 },
        merged_tag_id: loyal,
      });
      expect(s.store.tags.some((t) => t.id === loyal)).toBe(false);
      const link = (c: string) => s.store.links.find((l) => l.contactId === c && l.tagId === vip)!;
      expect(link(onlyLoyal)).toMatchObject({ addedBy: OP, addedAt: at(-300) });
      expect(link(both)).toMatchObject({ addedBy: OWNER, addedAt: at(-500) });
      expect(link(onlyVip)).toMatchObject({ addedBy: OP, addedAt: at(-100) });
      expect(s.store.links).toHaveLength(3);
      expect(s.store.entries.map((e) => [e.contactId, e.kind]).sort()).toEqual(
        [
          [onlyLoyal, 'merged'],
          [both, 'merged'],
        ].sort(),
      );
      expect(s.store.entries[0]).toMatchObject({
        tagId: loyal,
        tagName: 'Loyal',
        mergedInto: { tagId: vip, name: 'VIP' },
        actorAccountId: OWNER,
        source: 'settings',
      });
      expect(s.ports.signalLog).toEqual([`tags.changed:${WS}`]);
      expect(s.ports.events).toEqual(['lock:tags', 'lock:for-update']);
    });

    it('logs tag.merged with ids only, even for a tag no contact carries', async () => {
      const s = await setup();
      const vip = s.store.addTag(WS, 'VIP');
      const loyal = s.store.addTag(WS, 'Loyal');
      await s.admin.renameTag(WS, OWNER, loyal, { name: 'VIP', mergeIntoTagId: vip });
      expect(s.store.entries).toHaveLength(0);
      const line = s.logs.find((l) => l.msg === 'tag.merged');
      expect(line?.obj).toMatchObject({ workspaceId: WS, fromTagId: loyal, toTagId: vip });
      expect(JSON.stringify(s.logs)).not.toMatch(/VIP|Loyal/);
    });

    it('answers TAG_MERGE_TARGET_CHANGED with the current holder, or null, and changes nothing', async () => {
      const s = await setup();
      const vip = s.store.addTag(WS, 'VIP');
      const loyal = s.store.addTag(WS, 'Loyal');
      carry(s, await s.contact(), loyal);
      s.store.renameTag(WS, vip, 'Very important');
      const other = s.store.addTag(WS, 'vip');
      await expect(
        s.admin.renameTag(WS, OWNER, loyal, { name: 'VIP', mergeIntoTagId: vip }),
      ).rejects.toMatchObject({
        code: 'TAG_MERGE_TARGET_CHANGED',
        statusCode: 409,
        details: { name_holder: { id: other, name: 'vip', contact_count: 0 } },
      });
      s.store.tags.splice(
        s.store.tags.findIndex((t) => t.id === other),
        1,
      );
      await expect(
        s.admin.renameTag(WS, OWNER, loyal, { name: 'VIP', mergeIntoTagId: vip }),
      ).rejects.toMatchObject({ details: { name_holder: null } });
      await expect(
        s.admin.renameTag(WS, OWNER, loyal, { name: 'VIP', mergeIntoTagId: newId() }),
      ).rejects.toMatchObject({ code: 'TAG_MERGE_TARGET_CHANGED' });
      expect(s.store.tags.some((t) => t.id === loyal)).toBe(true);
      expect(s.store.entries).toHaveLength(0);
      expect(s.ports.signalLog).toEqual([]);
    });

    it('refuses a merge into the tag itself and a foreign target', async () => {
      const s = await setup();
      const loyal = s.store.addTag(WS, 'Loyal');
      await expect(
        s.admin.renameTag(WS, OWNER, loyal, { name: 'Loyal', mergeIntoTagId: loyal }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: { field: 'merge_into_tag_id' },
      });
      const foreign = s.store.addTag(OTHER_WS, 'VIP');
      await expect(
        s.admin.renameTag(WS, OWNER, loyal, { name: 'VIP', mergeIntoTagId: foreign }),
      ).rejects.toMatchObject({ code: 'TAG_MERGE_TARGET_CHANGED' });
    });

    it('answers TAG_NOT_FOUND when the merged tag is gone', async () => {
      const s = await setup();
      const vip = s.store.addTag(WS, 'VIP');
      await expect(
        s.admin.renameTag(WS, OWNER, newId(), { name: 'VIP', mergeIntoTagId: vip }),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
    });
  });

  it('never consults the member rate limit, however many entries the owner has (AC-15)', async () => {
    const s = await setup();
    const c = await s.contact();
    const t = s.store.addTag(WS, 'Loyal');
    for (let i = 0; i < 100; i++) {
      s.store.history(WS, c, {
        tagId: t,
        tagName: 'Loyal',
        kind: 'added',
        mergedInto: null,
        actorAccountId: OWNER,
        source: 'inbox',
        createdAt: at(-1),
      });
    }
    const res = await s.admin.renameTag(WS, OWNER, t, { name: 'Regular' });
    expect(res.outcome).toBe('renamed');
    expect(s.ports.events).not.toContain('lock:member-changes');
  });
});

describe('deleteTag against the confirmed count (AC-09)', () => {
  it('deletes the tag and its links with one deleted entry per contact and one tags.changed', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'Old promo');
    const cs = [await s.contact(), await s.contact(), await s.contact()];
    for (const c of cs) carry(s, c, t);
    const res = await s.admin.deleteTag(WS, OWNER, t, 3);
    expect(res).toEqual({ workspace_id: WS, tag_id: t, removed_from_count: 3 });
    expect(s.store.tags).toHaveLength(0);
    expect(s.store.links).toHaveLength(0);
    expect(s.store.entries).toHaveLength(3);
    expect(s.store.entries[0]).toMatchObject({
      kind: 'deleted',
      tagId: t,
      tagName: 'Old promo',
      mergedInto: null,
      actorAccountId: OWNER,
      source: 'settings',
    });
    expect(s.ports.signalLog).toEqual([`tags.changed:${WS}`]);
    expect(s.ports.events).toEqual(['lock:tags', 'lock:for-update']);
  });

  it('rolls back with TAG_COUNT_CHANGED and the current count when the count moved', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'Old promo');
    for (let i = 0; i < 41; i++) carry(s, await s.contact(), t);
    await expect(s.admin.deleteTag(WS, OWNER, t, 40)).rejects.toMatchObject({
      code: 'TAG_COUNT_CHANGED',
      statusCode: 409,
      details: { tag: { id: t, name: 'Old promo', contact_count: 41 } },
    });
    expect(s.store.tags).toHaveLength(1);
    expect(s.store.links).toHaveLength(41);
    expect(s.store.entries).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([]);
  });

  it('deletes a tag on no contact when 0 is confirmed, without entries', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'Empty');
    expect(await s.admin.deleteTag(WS, OWNER, t, 0)).toMatchObject({ removed_from_count: 0 });
    expect(s.store.entries).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([`tags.changed:${WS}`]);
  });

  it('answers TAG_NOT_FOUND for a repeated, gone or foreign delete', async () => {
    const s = await setup();
    const t = s.store.addTag(WS, 'Empty');
    await s.admin.deleteTag(WS, OWNER, t, 0);
    const foreign = s.store.addTag(OTHER_WS, 'Foreign');
    for (const id of [t, foreign]) {
      await expect(s.admin.deleteTag(WS, OWNER, id, 0)).rejects.toMatchObject({
        code: 'TAG_NOT_FOUND',
        statusCode: 404,
      });
    }
    expect(s.store.tags.some((x) => x.id === foreign)).toBe(true);
  });
});
