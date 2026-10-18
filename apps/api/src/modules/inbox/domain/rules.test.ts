import { describe, expect, it } from 'vitest';
import {
  CHAT_PACE_MS,
  LIMIT_WINDOW_MS,
  REPLY_LIMIT,
  REPLY_MAX,
  RETRY_WINDOW_MS,
  REVALIDATE_MS,
  SEND_TIMEOUT_MS,
} from './rules.js';

describe('inbox rule constants', () => {
  it('are fixed by the spec and SAD', () => {
    expect(REPLY_MAX).toBe(4096);
    expect(REPLY_LIMIT).toBe(30);
    expect(LIMIT_WINDOW_MS).toBe(60_000);
    expect(RETRY_WINDOW_MS).toBe(300_000);
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    expect(REVALIDATE_MS).toBe(5_000);
    expect(CHAT_PACE_MS).toBe(1_000);
  });
});
