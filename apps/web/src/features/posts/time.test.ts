import { describe, expect, it } from 'vitest';
import { formatPostTime, localToInstantIn } from './time';

describe('posts time helpers over the shared zone rule', () => {
  it('formats an instant in the workspace zone, naming the zone', () => {
    expect(formatPostTime('2026-11-04T07:00:00.000Z', 'Europe/Kyiv')).toBe(
      'Wed 4 Nov, 09:00 (Europe/Kyiv)',
    );
  });

  it('turns local wall time into an instant, and refuses a skipped time', () => {
    expect(localToInstantIn('2026-11-04T09:00', 'Europe/Kyiv')).toEqual({
      ok: true,
      instant: new Date('2026-11-04T07:00:00.000Z'),
    });
    expect(localToInstantIn('2026-03-29T03:30', 'Europe/Kyiv').ok).toBe(false);
  });
});
