import { LIMIT_WINDOW_MS, REPLY_LIMIT } from './rules.js';

export const isOverLimit = (count: number): boolean => count >= REPLY_LIMIT;

export const limitRetryAt = (oldestCountedAt: Date): Date =>
  new Date(oldestCountedAt.getTime() + LIMIT_WINDOW_MS);
