import { describe, expect, it } from 'vitest';
import { formatWait, pingText, type PingTextInput } from './ping-text.js';

const base: PingTextInput = {
  workspaceName: 'Acme Flowers',
  workspaceId: 'ws-1',
  panelUrl: 'https://app.example.test',
  mine: 0,
  unassigned: 0,
  teammate: 0,
  longestWaitMinutes: 5,
};
const withCounts = (o: Partial<PingTextInput>): PingTextInput => ({ ...base, ...o });

describe('formatWait (decision 9)', () => {
  it.each([
    [0, '0 min'],
    [5, '5 min'],
    [12, '12 min'],
    [59, '59 min'],
    [60, '1 h'],
    [65, '1 h 5 min'],
    [120, '2 h'],
    [125, '2 h 5 min'],
  ])('%i minutes reads %s', (minutes, text) => {
    expect(formatWait(minutes)).toBe(text);
  });
});

describe('pingText, one conversation (AC-07, AC-09)', () => {
  it('mine, with the conversation link', () => {
    expect(pingText(withCounts({ mine: 1, conversationId: 'c-1' }))).toEqual({
      text: 'Acme Flowers: 1 customer is waiting for your reply (5 min)',
      url: 'https://app.example.test/w/ws-1/inbox/c-1',
    });
  });

  it('unassigned', () => {
    expect(pingText(withCounts({ unassigned: 1, conversationId: 'c-1' }))).toEqual({
      text: 'Acme Flowers: an unassigned customer is waiting for a reply (5 min)',
      url: 'https://app.example.test/w/ws-1/inbox/c-1',
    });
  });

  it("a teammate's, without the teammate's name", () => {
    expect(
      pingText(withCounts({ teammate: 1, longestWaitMinutes: 31, conversationId: 'c-1' })),
    ).toEqual({
      text: "Acme Flowers: a teammate's customer is waiting for a reply (31 min)",
      url: 'https://app.example.test/w/ws-1/inbox/c-1',
    });
  });

  it('falls back to the open lens when the single conversation id is missing', () => {
    expect(pingText(withCounts({ mine: 1 })).url).toBe('https://app.example.test/w/ws-1/inbox');
  });
});

describe('pingText, several conversations (AC-08)', () => {
  it('all mine links to the mine lens', () => {
    expect(pingText(withCounts({ mine: 4, longestWaitMinutes: 12 }))).toEqual({
      text: 'Acme Flowers: 4 customers are waiting for your reply, the longest 12 min',
      url: 'https://app.example.test/w/ws-1/inbox?assignee=mine',
    });
  });

  it('all unassigned links to the unassigned lens', () => {
    expect(pingText(withCounts({ unassigned: 4, longestWaitMinutes: 12 }))).toEqual({
      text: 'Acme Flowers: 4 unassigned customers are waiting, the longest 12 min',
      url: 'https://app.example.test/w/ws-1/inbox?assignee=unassigned',
    });
  });

  it("all teammates' links to the open lens", () => {
    expect(pingText(withCounts({ teammate: 3, longestWaitMinutes: 34 }))).toEqual({
      text: "Acme Flowers: 3 of your teammates' customers are waiting for a reply, the longest 34 min",
      url: 'https://app.example.test/w/ws-1/inbox',
    });
  });

  it('mixed lists the parts in order and links to the open lens', () => {
    expect(
      pingText(withCounts({ mine: 2, unassigned: 1, teammate: 1, longestWaitMinutes: 65 })),
    ).toEqual({
      text: "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 1 h 5 min",
      url: 'https://app.example.test/w/ws-1/inbox',
    });
  });

  it('mixed lists only the non-zero parts', () => {
    expect(pingText(withCounts({ mine: 2, teammate: 1, longestWaitMinutes: 8 })).text).toBe(
      "Acme Flowers: 3 customers are waiting for a reply (2 yours, 1 a teammate's), the longest 8 min",
    );
    expect(pingText(withCounts({ unassigned: 1, teammate: 2, longestWaitMinutes: 8 })).text).toBe(
      "Acme Flowers: 3 customers are waiting for a reply (1 unassigned, 2 a teammate's), the longest 8 min",
    );
  });

  it('a mixed set with one conversation of each kind never links to one conversation', () => {
    const r = pingText(withCounts({ mine: 1, unassigned: 1, conversationId: 'c-1' }));
    expect(r.url).toBe('https://app.example.test/w/ws-1/inbox');
  });
});

describe('pingText, edges', () => {
  it('rejects an empty set', () => {
    expect(() => pingText(base)).toThrow();
  });

  it('drops a trailing slash of the panel url', () => {
    expect(pingText(withCounts({ mine: 2, panelUrl: 'https://app.example.test/' })).url).toBe(
      'https://app.example.test/w/ws-1/inbox?assignee=mine',
    );
  });

  it('is plain text: the workspace name is passed through untouched', () => {
    expect(pingText(withCounts({ mine: 2, workspaceName: '<b>*Acme*_' })).text).toMatch(
      /^<b>\*Acme\*_: 2 customers/,
    );
  });

  it('has no field for message text, contact names or teammate names (spec section 6)', () => {
    // The type is closed: these keys are compile errors, and ignored at runtime.
    const sneaky = {
      ...withCounts({ mine: 2 }),
      messageText: 'I want 40 roses',
      contactName: 'Olena Test',
      teammateName: 'Test Mate',
    } as unknown as PingTextInput;
    const r = pingText(sneaky);
    expect(`${r.text} ${r.url}`).not.toMatch(/roses|Olena|Mate/);
    // @ts-expect-error no message text field
    const a: PingTextInput = { ...base, mine: 1, messageText: 'x' };
    // @ts-expect-error no contact name field
    const b: PingTextInput = { ...base, mine: 1, contactName: 'x' };
    // @ts-expect-error no teammate name field
    const c: PingTextInput = { ...base, mine: 1, teammateName: 'x' };
    expect([a, b, c]).toHaveLength(3);
  });
});
