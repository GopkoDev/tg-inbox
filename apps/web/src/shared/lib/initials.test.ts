import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
  it('takes the first letter of up to two words, uppercased', () => {
    expect(initials('mira voloshyna')).toBe('MV');
    expect(initials('Ada Augusta King')).toBe('AA');
    expect(initials('  tomas  ')).toBe('T');
  });

  it('falls back to ? when there is no word', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });

  it('keeps a whole character when a word starts with an emoji', () => {
    expect(initials('🌸 Flowers')).toBe('🌸F');
  });
});
