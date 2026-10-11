import { ErrorEnvelope } from '@tg/shared';
import type { z } from 'zod';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

/** A failed API call, carrying the envelope's `code` so features can switch on it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Typed fetch: every response body is parsed with the same zod schema the api serializes with. */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorEnvelope.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(response.status, 'INTERNAL_ERROR', response.statusText);
  }
  return schema.parse(body);
}
