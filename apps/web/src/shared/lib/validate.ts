import type { z } from 'zod';

/** Runs the server's own rule from `@tg/shared`: the first issue message, or null when valid. */
export function firstIssue(schema: z.ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid value');
}
