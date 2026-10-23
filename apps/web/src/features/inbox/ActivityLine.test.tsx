import { render, screen } from '@testing-library/react';
import type { ThreadActivity } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { ActivityLine } from './ActivityLine';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ana = { account_id: id(1), display_name: 'Ana Shevchenko' };
const bob = { account_id: id(2), display_name: 'Bob Petrenko' };
const cid = (kind: string) => id(kind.length);

const activity = (over: Partial<ThreadActivity>): ThreadActivity => ({
  type: 'activity',
  id: cid('x'),
  workspace_id: id(10),
  conversation_id: id(11),
  kind: 'closed',
  cause: 'member',
  actor: ana,
  previous_assignee: null,
  new_assignee: null,
  position_at: '2026-10-18T10:01:00.000Z',
  ...over,
});

const line = (a: ThreadActivity) => {
  render(<ActivityLine activity={a} at="10:01" />);
  return screen.getByTestId('activity-line');
};

describe('ActivityLine (AC-09)', () => {
  it('names the actor and the new assignee on assign', () => {
    expect(line(activity({ kind: 'assigned', new_assignee: bob })).textContent).toBe(
      'Ana Shevchenko assigned this to Bob Petrenko · 10:01',
    );
  });

  it('names previous and new on reassign', () => {
    expect(
      line(activity({ kind: 'reassigned', previous_assignee: ana, new_assignee: bob })).textContent,
    ).toBe('Ana Shevchenko reassigned this from Ana Shevchenko to Bob Petrenko · 10:01');
  });

  it('says unassigned / closed / reopened by a member, own changes included (no «you»)', () => {
    expect(line(activity({ kind: 'unassigned', previous_assignee: bob })).textContent).toBe(
      'Ana Shevchenko unassigned this · 10:01',
    );
  });

  it('closed and reopened by a member', () => {
    expect(line(activity({ kind: 'closed' })).textContent).toBe(
      'Ana Shevchenko closed this · 10:01',
    );
  });

  it('reopened by a member', () => {
    expect(line(activity({ kind: 'reopened' })).textContent).toBe(
      'Ana Shevchenko reopened this · 10:01',
    );
  });

  it('reopened because the customer wrote', () => {
    expect(
      line(activity({ kind: 'reopened', cause: 'customer_wrote', actor: null })).textContent,
    ).toBe('reopened — the customer wrote · 10:01');
  });

  it('reopened because a reply was not delivered', () => {
    expect(
      line(activity({ kind: 'reopened', cause: 'reply_not_delivered', actor: null })).textContent,
    ).toBe('reopened — a reply was not delivered · 10:01');
  });

  it('unassigned because the assignee was deactivated, naming them', () => {
    expect(
      line(
        activity({
          kind: 'unassigned',
          cause: 'member_deactivated',
          actor: null,
          previous_assignee: bob,
        }),
      ).textContent,
    ).toBe('unassigned — Bob Petrenko was deactivated · 10:01');
  });

  it('renders names as plain text, never HTML', () => {
    const evil = { account_id: id(3), display_name: '<img src=x onerror=alert(1)>' };
    const el = line(activity({ kind: 'closed', actor: evil }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)> closed this');
  });
});
