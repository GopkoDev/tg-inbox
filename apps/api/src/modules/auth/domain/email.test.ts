import { describe, expect, it } from 'vitest';
import { normaliseEmail } from './email.js';

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Anna@Example.COM \n')).toBe('anna@example.com');
  });
});
