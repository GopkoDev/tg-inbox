import { describe, expect, it } from 'vitest';
import { POST_STATES, canEdit, canTransition, needsAttention } from './post.js';

describe('post states (AC-08, AC-11)', () => {
  it('has the eight states', () => {
    expect([...POST_STATES].sort()).toEqual(
      [
        'deleted',
        'draft',
        'failed',
        'missed',
        'not_confirmed',
        'published',
        'scheduled',
        'sending',
      ].sort(),
    );
  });

  it.each([
    ['draft', 'scheduled'],
    ['scheduled', 'sending'],
    ['scheduled', 'draft'],
    ['sending', 'published'],
    ['sending', 'failed'],
    ['sending', 'not_confirmed'],
    ['scheduled', 'missed'],
    ['scheduled', 'failed'],
    ['published', 'deleted'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['published', 'draft'],
    ['sending', 'draft'],
    ['failed', 'draft'],
    ['missed', 'draft'],
    ['not_confirmed', 'draft'],
    ['not_confirmed', 'sending'],
    ['missed', 'sending'],
    ['draft', 'sending'],
    ['draft', 'published'],
    ['deleted', 'published'],
    ['published', 'scheduled'],
  ] as const)('refuses %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only a draft is edited in place; a scheduled post must first go back to draft', () => {
    expect(canEdit('draft')).toBe(true);
    for (const s of POST_STATES.filter((x) => x !== 'draft')) expect(canEdit(s)).toBe(false);
  });

  it('failed, missed and not confirmed need attention', () => {
    expect(POST_STATES.filter((s) => needsAttention(s)).sort()).toEqual([
      'failed',
      'missed',
      'not_confirmed',
    ]);
  });
});
