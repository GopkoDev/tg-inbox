import { describe, expect, it } from 'vitest';
import { getSampleConversation, listSampleConversations } from './sample-source';

describe('sample source (AC-12, AC-17)', () => {
  it('lists at least 8 conversations with the fields the list renders', () => {
    const list = listSampleConversations();
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const c of list) {
      expect(c.id).toEqual(expect.any(String));
      expect(c.id).not.toBe('');
      expect(c.name).toEqual(expect.any(String));
      expect(c.name).not.toBe('');
      expect(c.username).toMatch(/^@\S+$/);
      expect(c.lastMessage).toEqual(expect.any(String));
      expect(c.lastMessage).not.toBe('');
      expect(c.at).toBeDefined();
      expect(Number.isInteger(c.unread)).toBe(true);
      expect(c.unread).toBeGreaterThanOrEqual(0);
      expect(c.unread).toBeLessThanOrEqual(3);
    }
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    expect(new Set(list.map((c) => c.name)).size).toBe(list.length);
    expect(list.some((c) => c.unread > 0)).toBe(true);
  });

  it('returns a thread of at least 3 messages per conversation', () => {
    for (const { id, name, username } of listSampleConversations()) {
      const thread = getSampleConversation(id);
      expect(thread).toBeDefined();
      expect(thread?.id).toBe(id);
      expect(thread?.name).toBe(name);
      expect(thread?.username).toBe(username);
      expect(thread!.messages.length).toBeGreaterThanOrEqual(3);
      for (const m of thread!.messages) {
        expect(['customer', 'operator']).toContain(m.sender);
        expect(m.text).toEqual(expect.any(String));
        expect(m.text).not.toBe('');
        expect(m.at).toBeDefined();
      }
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(getSampleConversation('nope')).toBeUndefined();
  });

  it('takes no workspace argument: identical on every call', () => {
    expect(listSampleConversations.length).toBe(0);
    expect(getSampleConversation.length).toBe(1);
    expect(listSampleConversations()).toEqual(listSampleConversations());
    const id = listSampleConversations()[0]!.id;
    expect(getSampleConversation(id)).toEqual(getSampleConversation(id));
  });
});
