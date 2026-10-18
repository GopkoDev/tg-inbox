import { ErrorCode, ErrorEnvelope } from '@tg/shared';
import type { z } from 'zod';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

/** A failed API call, carrying the envelope's `code` so features can switch on it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/** An unknown code (newer server) degrades to INTERNAL_ERROR rather than breaking the switch. */
function toErrorCode(code: string): ErrorCode {
  return KNOWN_CODES.has(code) ? (code as ErrorCode) : ErrorCode.INTERNAL_ERROR;
}

export interface RequestOptions extends RequestInit {
  /** Automatic request (polling, refetch on focus): must not extend the session's idle window. */
  background?: boolean;
}

/**
 * Typed fetch: every response body is parsed with the same zod schema the api serializes with.
 * Pass `undefined` as the schema for void responses (204).
 */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestOptions,
): Promise<z.infer<S>>;
export async function apiRequest(
  path: string,
  schema: undefined,
  init?: RequestOptions,
): Promise<undefined>;
export async function apiRequest(
  path: string,
  schema: z.ZodType | undefined,
  init: RequestOptions = {},
): Promise<unknown> {
  const { background, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  if (background) headers.set('x-background-request', '1');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorEnvelope.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, toErrorCode(code), message, details);
    }
    throw new ApiError(response.status, ErrorCode.INTERNAL_ERROR, response.statusText);
  }
  return schema ? schema.parse(body) : undefined;
}

/**
 * A binary GET (media): the status is checked before the bytes are used, because a refusal is
 * the JSON error envelope. Same credentials and error mapping as `apiRequest`.
 */
export async function apiBlob(
  path: string,
  init: RequestOptions = {},
): Promise<{ blob: Blob; contentType: string }> {
  const { background, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (background) headers.set('x-background-request', '1');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = ErrorEnvelope.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, toErrorCode(code), message, details);
    }
    throw new ApiError(response.status, ErrorCode.INTERNAL_ERROR, response.statusText);
  }
  const blob = await response.blob();
  return { blob, contentType: response.headers.get('content-type') ?? blob.type };
}
