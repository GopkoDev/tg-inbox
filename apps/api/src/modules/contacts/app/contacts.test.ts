import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createContacts } from './contacts.js';
import { fakeContactRepo, fakeReachRepo, fakeReachSignals } from './fakes.js';
import type { ContactProfile, Executor } from './ports.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const BOT = 9001n;
const tx = {} as Executor;

const profile = (o: Partial<ContactProfile> = {}): ContactProfile => ({
  telegramUserId: 700001n,
  firstName: 'Test User',
  lastName: null,
  username: 'test_user_1',
  languageCode: 'en',
  ...o,
});

function setup() {
  const repo = fakeContactRepo();
  const clock = fixedClock(at(100));
  return {
    repo,
    clock,
    contacts: createContacts({ repo, reach: fakeReachRepo(), signals: fakeReachSignals(), clock }),
  };
}

describe('contacts use cases', () => {
  it('creates a contact from the first profile with the clock time (AC-07)', async () => {
    const { repo, contacts } = setup();
    const result = await contacts.upsertFromProfile('ws-a', profile(), at(1), BOT, tx);
    expect(result.created).toBe(true);
    expect(repo.rows).toEqual([
      expect.objectContaining({
        id: result.contactId,
        workspaceId: 'ws-a',
        telegramUserId: 700001n,
        firstName: 'Test User',
        profileSeenAt: at(1),
        createdAt: at(100),
      }),
    ]);
  });

  it('refreshes the profile from a newer message, keeping one contact (AC-08)', async () => {
    const { repo, contacts } = setup();
    const first = await contacts.upsertFromProfile('ws-a', profile(), at(1), BOT, tx);
    const second = await contacts.upsertFromProfile(
      'ws-a',
      profile({ firstName: 'Renamed', username: 'renamed', languageCode: 'uk', lastName: 'Last' }),
      at(2),
      BOT,
      tx,
    );
    expect(second).toEqual({ contactId: first.contactId, created: false });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      firstName: 'Renamed',
      lastName: 'Last',
      username: 'renamed',
      languageCode: 'uk',
      profileSeenAt: at(2),
    });
  });

  it('keeps the profile when an older message arrives late', async () => {
    const { repo, contacts } = setup();
    await contacts.upsertFromProfile('ws-a', profile({ firstName: 'Current' }), at(5), BOT, tx);
    const late = await contacts.upsertFromProfile(
      'ws-a',
      profile({ firstName: 'Old' }),
      at(3),
      BOT,
      tx,
    );
    expect(late.created).toBe(false);
    expect(repo.rows[0]).toMatchObject({ firstName: 'Current', profileSeenAt: at(5) });
  });

  it('keeps one contact per workspace for the same person and counts per workspace (AC-13)', async () => {
    const { contacts } = setup();
    const a = await contacts.upsertFromProfile('ws-a', profile(), at(1), BOT, tx);
    const b = await contacts.upsertFromProfile('ws-b', profile(), at(1), BOT, tx);
    expect(a.contactId).not.toBe(b.contactId);
    await contacts.upsertFromProfile('ws-a', profile({ telegramUserId: 700002n }), at(1), BOT, tx);
    expect(await contacts.countContacts('ws-a')).toBe(2);
    expect(await contacts.countContacts('ws-b')).toBe(1);
    expect(await contacts.countContacts('ws-c')).toBe(0);
  });

  it('searches contact ids and reads summaries per workspace (AC-02)', async () => {
    const { contacts } = setup();
    const a = await contacts.upsertFromProfile(
      'ws-a',
      profile({ firstName: 'Олена' }),
      at(1),
      BOT,
      tx,
    );
    await contacts.upsertFromProfile('ws-b', profile({ firstName: 'Олена' }), at(1), BOT, tx);
    expect(await contacts.searchContactIds('ws-a', ' олЕНА ')).toEqual([a.contactId]);
    expect(await contacts.searchContactIds('ws-a', ' @ ')).toBeNull();
    expect(await contacts.contactsByIds('ws-a', [a.contactId])).toEqual([
      { id: a.contactId, firstName: 'Олена', lastName: null, username: 'test_user_1' },
    ]);
  });
});
