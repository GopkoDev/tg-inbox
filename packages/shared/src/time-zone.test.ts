import { describe, expect, it } from 'vitest';
import { formatInZone, instantToLocal, isValidTimeZone, localToInstant } from './index.js';

const iso = (r: ReturnType<typeof localToInstant>) => (r.ok ? r.instant.toISOString() : r);

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(isValidTimeZone('Europe/Kyiv')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('localToInstant', () => {
  it('converts a winter wall time (UTC+2)', () => {
    expect(iso(localToInstant('2026-12-01T09:00', 'Europe/Kyiv'))).toBe('2026-12-01T07:00:00.000Z');
  });
  it('converts a summer wall time (UTC+3)', () => {
    expect(iso(localToInstant('2027-06-01T09:00', 'Europe/Kyiv'))).toBe('2027-06-01T06:00:00.000Z');
  });
  it('rejects a time skipped by spring forward', () => {
    expect(localToInstant('2027-03-28T03:30', 'Europe/Kyiv')).toEqual({
      ok: false,
      error: 'does_not_exist',
    });
  });
  it('takes the first occurrence of a repeated time', () => {
    expect(iso(localToInstant('2026-10-25T03:30', 'Europe/Kyiv'))).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('formatInZone / instantToLocal', () => {
  it('names the zone', () => {
    expect(formatInZone(new Date('2026-11-04T07:00:00Z'), 'Europe/Kyiv')).toBe(
      'Wed 4 Nov, 09:00 (Europe/Kyiv)',
    );
  });
  it('gives the local value for prefilling, round-tripping', () => {
    expect(instantToLocal(new Date('2026-11-04T07:00:00Z'), 'Europe/Kyiv')).toBe(
      '2026-11-04T09:00',
    );
  });
});
