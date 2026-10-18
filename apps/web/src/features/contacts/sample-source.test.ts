import { describe, expect, it } from 'vitest';
import { getSampleContact, listSampleContacts } from './sample-source';

describe('contacts sample source (AC-15, AC-17)', () => {
  it('lists at least 10 contacts with the fields the table renders', () => {
    const list = listSampleContacts();
    expect(list.length).toBeGreaterThanOrEqual(10);
    for (const c of list) {
      expect(c.id).toEqual(expect.any(String));
      expect(c.id).not.toBe('');
      expect(c.name).toEqual(expect.any(String));
      expect(c.name).not.toBe('');
      expect(c.username).toMatch(/^@\S+$/);
      expect(Array.isArray(c.tags)).toBe(true);
      for (const t of c.tags) expect(t).toEqual(expect.any(String));
      expect(c.language).toEqual(expect.any(String));
      expect(c.language).not.toBe('');
      expect(c.firstMessageAt).toBeDefined();
      expect(c.lastMessageAt).toBeDefined();
    }
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    expect(new Set(list.map((c) => c.name)).size).toBe(list.length);
    expect(new Set(list.flatMap((c) => c.tags)).size).toBeGreaterThanOrEqual(3);
  });

  it('returns the contact with a non-empty history', () => {
    for (const c of listSampleContacts()) {
      const full = getSampleContact(c.id);
      expect(full).toBeDefined();
      expect(full).toMatchObject({ id: c.id, name: c.name, username: c.username, tags: c.tags });
      expect(full!.history.length).toBeGreaterThanOrEqual(1);
      for (const h of full!.history) {
        expect(h.at).toBeDefined();
        expect(['in', 'out']).toContain(h.direction);
        expect(h.text).toEqual(expect.any(String));
        expect(h.text).not.toBe('');
      }
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(getSampleContact('nope')).toBeUndefined();
  });

  it('takes no workspace argument: identical on every call', () => {
    expect(listSampleContacts.length).toBe(0);
    expect(getSampleContact.length).toBe(1);
    expect(listSampleContacts()).toEqual(listSampleContacts());
    const id = listSampleContacts()[0]!.id;
    expect(getSampleContact(id)).toEqual(getSampleContact(id));
  });
});
