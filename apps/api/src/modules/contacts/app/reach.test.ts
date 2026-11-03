import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createContacts } from './contacts.js';
import { fakeContactRepo, fakeReachRepo, fakeReachSignals } from './fakes.js';
import type { ContactProfile, Executor } from './ports.js';
import { createContactReach } from './reach.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const BOT = 9201n;
const OTHER_BOT = 9202n;
const tx = {} as Executor;

const profile = (o: Partial<ContactProfile> = {}): ContactProfile => ({
  telegramUserId: 700101n,
  firstName: 'Test User',
  lastName: null,
  username: null,
  languageCode: 'en',
  ...o,
});

function setup() {
  const repo = fakeContactRepo();
  const reach = fakeReachRepo();
  const signals = fakeReachSignals();
  const clock = fixedClock(at(1000));
  const contacts = createContacts({ repo, reach, signals, clock });
  const contactReach = createContactReach({
    transaction: (fn) => fn(tx),
    contacts: repo,
    reach,
    signals,
  });
  return { repo, reach, signals, contacts, contactReach };
}

describe('contacts reach (ADR-0002, AC-10, AC-14)', () => {
  it('capture writes "wrote" for the receiving Telegram bot and signals nothing on a first message', async () => {
    const { reach, signals, contacts } = setup();
    const { contactId } = await contacts.upsertFromProfile('ws-a', profile(), at(10), BOT, tx);
    expect(reach.rows).toEqual([
      {
        workspaceId: 'ws-a',
        contactId,
        telegramBotId: BOT,
        wroteAt: at(10),
        blockedAt: null,
        changedAt: at(10),
      },
    ]);
    expect(signals.log).toEqual([]);
  });

  it('a refused send blocks at whole-second precision: a message of the same second (Telegram dates are whole seconds) clears it', async () => {
    const { reach, contacts, contactReach } = setup();
    const { contactId } = await contacts.upsertFromProfile('ws-a', profile(), at(10), BOT, tx);
    // Our clock at 20.700 s; the customer unblocks and writes within that second (date 20 s).
    const refusedAt = new Date(at(20).getTime() + 700);
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, true, refusedAt)).toBe(true);
    expect(reach.rows.find((r) => r.contactId === contactId)).toMatchObject({
      blockedAt: at(20),
      changedAt: at(20),
    });
    await contacts.upsertFromProfile('ws-a', profile(), at(20), BOT, tx);
    expect(reach.rows.find((r) => r.contactId === contactId)?.blockedAt).toBeNull();
  });

  it('a newer message clears a block and publishes contact.changed reach; an older one does not', async () => {
    const { signals, contacts, contactReach } = setup();
    const { contactId } = await contacts.upsertFromProfile('ws-a', profile(), at(10), BOT, tx);
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, true, at(20))).toBe(true);
    expect(signals.log).toEqual([`contact.changed:reach:ws-a:${contactId}`]);

    await contacts.upsertFromProfile('ws-a', profile(), at(15), BOT, tx);
    expect(signals.log).toHaveLength(1);

    await contacts.upsertFromProfile('ws-a', profile(), at(25), BOT, tx);
    expect(signals.log).toEqual([
      `contact.changed:reach:ws-a:${contactId}`,
      `contact.changed:reach:ws-a:${contactId}`,
    ]);
  });

  it('recordBlockChange publishes only when the mark changed', async () => {
    const { signals, contacts, contactReach } = setup();
    await contacts.upsertFromProfile('ws-a', profile(), at(10), BOT, tx);
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, true, at(20))).toBe(true);
    // Already blocked.
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, true, at(21))).toBe(false);
    // Older than the newest fact.
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, false, at(5))).toBe(false);
    expect(signals.log).toHaveLength(1);
    expect(await contactReach.recordBlockChange('ws-a', BOT, 700101n, false, at(30))).toBe(true);
    expect(signals.log).toHaveLength(2);
  });

  it('a fact for an unknown Telegram user (a linked member, not a contact) is a no-op', async () => {
    const { reach, signals, contactReach } = setup();
    expect(await contactReach.recordBlockChange('ws-a', BOT, 999n, true, at(20))).toBe(false);
    expect(reach.rows).toEqual([]);
    expect(signals.log).toEqual([]);
  });

  it('marks are per Telegram bot and per workspace', async () => {
    const { reach, contacts, contactReach } = setup();
    const a = await contacts.upsertFromProfile('ws-a', profile(), at(10), BOT, tx);
    await contacts.upsertFromProfile('ws-b', profile(), at(10), BOT, tx);
    await contactReach.recordBlockChange('ws-a', OTHER_BOT, 700101n, true, at(20));
    expect(
      reach.rows
        .filter((r) => r.blockedAt !== null)
        .map((r) => [r.workspaceId, r.contactId, r.telegramBotId]),
    ).toEqual([['ws-a', a.contactId, OTHER_BOT]]);
  });
});
