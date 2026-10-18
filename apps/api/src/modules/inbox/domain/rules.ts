export const REPLY_MAX = 4096;
export const REPLY_LIMIT = 30;
export const LIMIT_WINDOW_MS = 60_000;
export const RETRY_WINDOW_MS = 300_000;
export const SEND_TIMEOUT_MS = 10_000;
export const REVALIDATE_MS = 5_000;
export const CHAT_PACE_MS = 1_000;
/** Back-off of a not-accepted send that carries no `retry_after`. */
export const DEFAULT_BACKOFF_MS = 5_000;
/** Wall time one drain run may start attempts for; well under the job's 60 s expiry (ADR-0004). */
export const DRAIN_BUDGET_MS = 40_000;
