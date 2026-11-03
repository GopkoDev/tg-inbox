import { describe, expect, it } from 'vitest';
import { checkDuplicateChoice, duplicateName, type DuplicateChoice } from './duplicate.js';

describe('duplicate audience choices (AC-07, AC-13, AC-18)', () => {
  type Row = [
    string,
    'draft' | 'sending' | 'sent' | 'stopped',
    'tags' | 'group',
    DuplicateChoice,
    string,
  ];
  it.each<Row>([
    ['same for a draft', 'draft', 'tags', 'same', 'ok'],
    ['same for a group draft', 'draft', 'group', 'same', 'ok'],
    ['same for a launched one', 'sent', 'tags', 'same', 'invalid'],
    ['same tags for a draft', 'draft', 'tags', 'same_tags', 'invalid'],
    ['same tags for a sending tag audience', 'sending', 'tags', 'same_tags', 'ok'],
    ['same tags for a sent tag audience', 'sent', 'tags', 'same_tags', 'ok'],
    ['same tags for a launched group', 'sent', 'group', 'same_tags', 'invalid'],
    ['all recipients for a draft', 'draft', 'group', 'all_recipients', 'invalid'],
    ['all recipients while sending', 'sending', 'group', 'all_recipients', 'ok'],
    ['all recipients once stopped', 'stopped', 'tags', 'all_recipients', 'ok'],
    ['not reached for a draft', 'draft', 'tags', 'not_reached', 'invalid'],
    ['not reached while sending', 'sending', 'tags', 'not_reached', 'not_ended'],
    ['not reached once sent', 'sent', 'group', 'not_reached', 'ok'],
    ['not reached once stopped', 'stopped', 'tags', 'not_reached', 'ok'],
  ])('%s', (_name, status, kind, choice, expected) => {
    const result = checkDuplicateChoice({ status, audienceKind: kind, choice });
    expect(result.ok ? 'ok' : result.error).toBe(expected);
  });
});

describe('duplicate name (AC-07)', () => {
  it('is "Copy of …" cut to 80 graphemes by the shared rule', () => {
    expect(duplicateName('Spring prices')).toBe('Copy of Spring prices');
    expect(duplicateName('x'.repeat(80))).toBe(`Copy of ${'x'.repeat(72)}`);
  });
});
