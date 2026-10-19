import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { createTagWrites } from './tags.js';
import { fakeContactRepo, fakeTagStore, fakeTagWritePorts } from './fakes.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const WS = newId();
const OTHER_WS = newId();
const ME = newId();
const NAMES = new Map([[ME, 'Mia Member']]);

async function setup() {
  const contactRepo = fakeContactRepo();
  const store = fakeTagStore();
  const ports = fakeTagWritePorts(contactRepo, store);
  const logs: { obj: object; msg: string }[] = [];
  const writes = createTagWrites({
    transaction: ports.transaction,
    contacts: contactRepo,
    tags: ports.tags,
    contactTags: ports.contactTags,
    tagHistory: ports.tagHistory,
    signals: ports.signals,
    workspaces: {
      displayNames: async (_ws, ids) => new Map(ids.map((id) => [id, NAMES.get(id) ?? 'Other'])),
    },
    clock: fixedClock(NOW),
    logger: { info: (obj, msg) => logs.push({ obj, msg }) },
  });
  const contact = async (n: number, ws = WS) =>
    (
      await contactRepo.upsertFromProfile(
        ws,
        {
          telegramUserId: BigInt(1000 + n),
          firstName: `C${n}`,
          lastName: null,
          username: null,
          languageCode: null,
        },
        NOW,
        NOW,
      )
    ).contactId;
  return { writes, store, ports, contact, logs };
}

const history = (s: Awaited<ReturnType<typeof setup>>) => s.store.entries;

describe('addContactTag (AC-06 .. AC-08, AC-14, AC-15)', () => {
  it('adds an existing tag by id: one link, one added entry, contact.changed only', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const vip = s.store.addTag(WS, 'VIP');
    const res = await s.writes.addContactTag(WS, ME, c, { tagId: vip }, 'inbox');
    expect(res).toMatchObject({
      workspace_id: WS,
      contact_id: c,
      outcome: 'recorded',
      tag: { id: vip, name: 'VIP' },
      tag_created: false,
      tags: [{ id: vip, name: 'VIP', added_by: { account_id: ME, display_name: 'Mia Member' } }],
    });
    expect(res.tags[0]?.added_at).toBe(NOW.toISOString());
    expect(history(s)).toHaveLength(1);
    expect(history(s)[0]).toMatchObject({
      kind: 'added',
      tagName: 'VIP',
      actorAccountId: ME,
      source: 'inbox',
      contactId: c,
    });
    expect(s.ports.signalLog).toEqual([`contact.changed:${WS}:${c}`]);
  });

  it('creates a tag by name, tidied, and publishes contact.changed then tags.changed', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const res = await s.writes.addContactTag(WS, ME, c, { name: '  Kyiv   North ' }, 'profile');
    expect(res).toMatchObject({
      outcome: 'recorded',
      tag_created: true,
      tag: { name: 'Kyiv North' },
    });
    expect(s.store.tags).toHaveLength(1);
    expect(s.ports.signalLog).toEqual([`contact.changed:${WS}:${c}`, `tags.changed:${WS}`]);
    expect(history(s)).toHaveLength(1);
  });

  it('applies the existing tag for a name that differs in case or spacing (AC-08)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const vip = s.store.addTag(WS, 'VIP');
    const res = await s.writes.addContactTag(WS, ME, c, { name: ' vip ' }, 'inbox');
    expect(res).toMatchObject({ tag_created: false, tag: { id: vip, name: 'VIP' } });
    expect(s.store.tags).toHaveLength(1);
  });

  it('answers unchanged for a tag the contact already carries: no entry, nothing published', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const vip = s.store.addTag(WS, 'VIP');
    s.store.link(WS, c, vip, ME, NOW);
    const res = await s.writes.addContactTag(WS, ME, c, { name: 'vip' }, 'inbox');
    expect(res).toMatchObject({ outcome: 'unchanged', tag_created: false, tag: { id: vip } });
    expect(res.tags).toHaveLength(1);
    expect(history(s)).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([]);
  });

  it('refuses an invalid name before any write (AC-07)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    for (const name of ['', '   ', 'x'.repeat(33)]) {
      await expect(s.writes.addContactTag(WS, ME, c, { name }, 'inbox')).rejects.toMatchObject({
        code: 'TAG_NAME_INVALID',
        statusCode: 400,
      });
    }
    expect(s.store.tags).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([]);
  });

  it('refuses a 101st tag (AC-08)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    for (let i = 0; i < 100; i++) s.store.addTag(WS, `tag ${i}`);
    await expect(
      s.writes.addContactTag(WS, ME, c, { name: 'one more' }, 'inbox'),
    ).rejects.toMatchObject({ code: 'TAG_LIMIT_REACHED', statusCode: 409 });
    expect(s.store.tags).toHaveLength(100);
    // an existing name still applies at 100
    const res = await s.writes.addContactTag(WS, ME, c, { name: 'TAG 3' }, 'inbox');
    expect(res.outcome).toBe('recorded');
  });

  it('refuses a 21st tag and rolls back the tag a new name just created (AC-08)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    for (let i = 0; i < 20; i++) s.store.link(WS, c, s.store.addTag(WS, `t${i}`), ME, NOW);
    await expect(
      s.writes.addContactTag(WS, ME, c, { name: 'Kyiv' }, 'inbox'),
    ).rejects.toMatchObject({
      code: 'CONTACT_TAG_LIMIT_REACHED',
      statusCode: 409,
    });
    expect(s.store.tags).toHaveLength(20);
    expect(s.ports.signalLog).toEqual([]);
    const extra = s.store.addTag(WS, 'extra');
    await expect(
      s.writes.addContactTag(WS, ME, c, { tagId: extra }, 'inbox'),
    ).rejects.toMatchObject({ code: 'CONTACT_TAG_LIMIT_REACHED' });
  });

  it('answers NOT_FOUND for a contact of another workspace and rolls a created tag back', async () => {
    const s = await setup();
    const foreign = await s.contact(1, OTHER_WS);
    await expect(
      s.writes.addContactTag(WS, ME, foreign, { name: 'Kyiv' }, 'inbox'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(s.store.tags).toHaveLength(0);
  });

  it('answers TAG_NOT_FOUND for a deleted or foreign tag id (AC-12, AC-14)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const foreignTag = s.store.addTag(OTHER_WS, 'VIP');
    for (const tagId of [foreignTag, newId()]) {
      await expect(s.writes.addContactTag(WS, ME, c, { tagId }, 'inbox')).rejects.toMatchObject({
        code: 'TAG_NOT_FOUND',
        statusCode: 404,
        details: { tag_id: tagId },
      });
    }
    expect(history(s)).toHaveLength(0);
  });

  it('adds a renamed tag under its current name (AC-14)', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const t = s.store.addTag(WS, 'Old');
    s.store.renameTag(WS, t, 'New');
    const res = await s.writes.addContactTag(WS, ME, c, { tagId: t }, 'inbox');
    expect(res.tag.name).toBe('New');
    expect(history(s)[0]?.tagName).toBe('New');
  });

  it('takes the locks in the ADR-0004 order', async () => {
    const s = await setup();
    const c = await s.contact(1);
    await s.writes.addContactTag(WS, ME, c, { name: 'Kyiv' }, 'inbox');
    expect(s.ports.events).toEqual(['lock:tags', 'lock:member-changes', 'lock:key-share']);
  });

  describe('the 60-per-minute member limit (AC-15)', () => {
    it('refuses the 61st change with the time the oldest counted one leaves the window', async () => {
      const s = await setup();
      const c = await s.contact(1);
      const oldest = new Date(NOW.getTime() - 50_000);
      for (let i = 0; i < 60; i++) {
        s.store.history(WS, c, {
          tagId: newId(),
          tagName: 'f',
          kind: 'added',
          mergedInto: null,
          actorAccountId: ME,
          source: 'profile',
          createdAt: i === 0 ? oldest : new Date(NOW.getTime() - 5_000),
        });
      }
      const t = s.store.addTag(WS, 'VIP');
      await expect(s.writes.addContactTag(WS, ME, c, { tagId: t }, 'inbox')).rejects.toMatchObject({
        code: 'TAG_CHANGE_LIMIT_REACHED',
        statusCode: 429,
        headers: { 'Retry-After': '10' },
        details: {
          limit: 60,
          window_seconds: 60,
          retry_at: new Date(oldest.getTime() + 60_000).toISOString(),
        },
      });
      expect(s.store.entries).toHaveLength(60);
    });

    it('does not count an unchanged add, a refusal, another member, an owner entry or another workspace', async () => {
      const s = await setup();
      const c = await s.contact(1);
      const t = s.store.addTag(WS, 'VIP');
      s.store.link(WS, c, t, ME, NOW);
      const entry = (o: Partial<Parameters<typeof s.store.history>[2]>, ws = WS) =>
        s.store.history(ws, c, {
          tagId: t,
          tagName: 'VIP',
          kind: 'added',
          mergedInto: null,
          actorAccountId: ME,
          source: 'inbox',
          createdAt: new Date(NOW.getTime() - 1000),
          ...o,
        });
      for (let i = 0; i < 59; i++) entry({});
      for (let i = 0; i < 30; i++) entry({ kind: 'merged', source: 'settings' });
      for (let i = 0; i < 30; i++) entry({ actorAccountId: newId() });
      for (let i = 0; i < 30; i++) entry({}, OTHER_WS);
      // unchanged: allowed and not recorded
      expect((await s.writes.addContactTag(WS, ME, c, { tagId: t }, 'inbox')).outcome).toBe(
        'unchanged',
      );
      // the 60th recorded change is allowed, the 61st is not
      const u = s.store.addTag(WS, 'Kyiv');
      expect((await s.writes.addContactTag(WS, ME, c, { tagId: u }, 'inbox')).outcome).toBe(
        'recorded',
      );
      const v = s.store.addTag(WS, 'Lviv');
      await expect(s.writes.addContactTag(WS, ME, c, { tagId: v }, 'inbox')).rejects.toMatchObject({
        code: 'TAG_CHANGE_LIMIT_REACHED',
      });
    });

    it('a refused create + add leaves no tag behind', async () => {
      const s = await setup();
      const c = await s.contact(1);
      for (let i = 0; i < 60; i++) {
        s.store.history(WS, c, {
          tagId: newId(),
          tagName: 'f',
          kind: 'added',
          mergedInto: null,
          actorAccountId: ME,
          source: 'profile',
          createdAt: new Date(NOW.getTime() - 1000),
        });
      }
      await expect(
        s.writes.addContactTag(WS, ME, c, { name: 'Kyiv' }, 'inbox'),
      ).rejects.toMatchObject({
        code: 'TAG_CHANGE_LIMIT_REACHED',
      });
      expect(s.store.tags).toHaveLength(0);
      expect(s.ports.signalLog).toEqual([]);
    });
  });

  it('logs the outcome with ids only', async () => {
    const s = await setup();
    const c = await s.contact(1);
    await s.writes.addContactTag(WS, ME, c, { name: 'Secret Name' }, 'inbox');
    await expect(s.writes.addContactTag(WS, ME, c, { name: '' }, 'inbox')).rejects.toBeDefined();
    const outcomes = s.logs.map((l) => (l.obj as { outcome: string }).outcome);
    expect(outcomes).toEqual(['added', 'name_invalid']);
    expect(JSON.stringify(s.logs)).not.toContain('Secret Name');
  });
});

describe('removeContactTag (AC-06, AC-12, AC-15)', () => {
  it('deletes the link, writes one removed entry with the current name and publishes contact.changed', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const a = s.store.addTag(WS, 'Wholesale');
    const b = s.store.addTag(WS, 'VIP');
    s.store.link(WS, c, a, ME, NOW);
    s.store.link(WS, c, b, ME, NOW);
    const res = await s.writes.removeContactTag(WS, ME, c, a, 'profile');
    expect(res).toMatchObject({ workspace_id: WS, contact_id: c, outcome: 'recorded' });
    expect(res.tags.map((t) => t.name)).toEqual(['VIP']);
    expect(history(s)).toHaveLength(1);
    expect(history(s)[0]).toMatchObject({
      kind: 'removed',
      tagName: 'Wholesale',
      source: 'profile',
    });
    expect(s.ports.signalLog).toEqual([`contact.changed:${WS}:${c}`]);
    expect(s.ports.events).toEqual(['lock:member-changes']);
  });

  it('answers unchanged for a tag not carried, deleted or foreign: no entry, nothing published', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const mine = s.store.addTag(WS, 'VIP');
    const foreign = s.store.addTag(OTHER_WS, 'VIP');
    for (const tagId of [mine, foreign, newId()]) {
      const res = await s.writes.removeContactTag(WS, ME, c, tagId, 'inbox');
      expect(res.outcome).toBe('unchanged');
    }
    expect(history(s)).toHaveLength(0);
    expect(s.ports.signalLog).toEqual([]);
  });

  it('answers NOT_FOUND for a contact of another workspace', async () => {
    const s = await setup();
    const foreign = await s.contact(1, OTHER_WS);
    await expect(
      s.writes.removeContactTag(WS, ME, foreign, newId(), 'inbox'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('shares the 60-per-minute budget with adds', async () => {
    const s = await setup();
    const c = await s.contact(1);
    const t = s.store.addTag(WS, 'VIP');
    s.store.link(WS, c, t, ME, NOW);
    for (let i = 0; i < 60; i++) {
      s.store.history(WS, c, {
        tagId: t,
        tagName: 'VIP',
        kind: i % 2 ? 'removed' : 'added',
        mergedInto: null,
        actorAccountId: ME,
        source: 'inbox',
        createdAt: new Date(NOW.getTime() - 20_000),
      });
    }
    await expect(s.writes.removeContactTag(WS, ME, c, t, 'inbox')).rejects.toMatchObject({
      code: 'TAG_CHANGE_LIMIT_REACHED',
      headers: { 'Retry-After': '40' },
    });
    expect(s.store.links).toHaveLength(1);
  });
});
