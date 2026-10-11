import { z } from 'zod';

/**
 * Error codes carried in the API error envelope. The api maps its AppError subclasses to these;
 * the web panel switches on them.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCESS_REMOVED: 'ACCESS_REMOVED',
  OWNER_ONLY: 'OWNER_ONLY',
  INVITATION_FOR_ANOTHER_EMAIL: 'INVITATION_FOR_ANOTHER_EMAIL',
  INVITATION_INVALID: 'INVITATION_INVALID',
  RESET_LINK_INVALID: 'RESET_LINK_INVALID',
  ALREADY_A_MEMBER: 'ALREADY_A_MEMBER',
  LAST_ACTIVE_OWNER: 'LAST_ACTIVE_OWNER',
  OWNER_ALREADY_JOINED: 'OWNER_ALREADY_JOINED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** `{ "error": { "code", "message", "details"? } }` — the one error shape every endpoint returns. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
