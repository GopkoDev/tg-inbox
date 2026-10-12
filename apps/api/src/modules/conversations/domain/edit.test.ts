import { describe, expect, it } from 'vitest';
import { isLaterEdit } from './edit.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

describe('isLaterEdit (AC-10)', () => {
  it('treats the first edit of an unedited message as later', () => {
    expect(isLaterEdit(null, { editedAt: t(1), updateId: 5n })).toBe(true);
  });

  it('lets a later edit time win', () => {
    expect(
      isLaterEdit({ editedAt: t(1), editUpdateId: 9n }, { editedAt: t(2), updateId: 5n }),
    ).toBe(true);
  });

  it('refuses an earlier edit that arrives late', () => {
    expect(
      isLaterEdit({ editedAt: t(2), editUpdateId: 5n }, { editedAt: t(1), updateId: 9n }),
    ).toBe(false);
  });

  it('breaks an equal edit time by the higher update id', () => {
    expect(
      isLaterEdit({ editedAt: t(2), editUpdateId: 5n }, { editedAt: t(2), updateId: 6n }),
    ).toBe(true);
    expect(
      isLaterEdit({ editedAt: t(2), editUpdateId: 6n }, { editedAt: t(2), updateId: 5n }),
    ).toBe(false);
  });

  it('treats a redelivered edit (same time and update id) as not later', () => {
    expect(
      isLaterEdit({ editedAt: t(2), editUpdateId: 5n }, { editedAt: t(2), updateId: 5n }),
    ).toBe(false);
  });
});
