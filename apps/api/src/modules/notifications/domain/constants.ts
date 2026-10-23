const MINUTE_MS = 60_000;

/** A customer has waited this long: the assignee, or everyone on an unassigned conversation, is due (AC-07). */
export const WAIT_AFTER_MS = 5 * MINUTE_MS;
/** The rest of the team is due after this long (AC-09). */
export const TEAM_AFTER_MS = 30 * MINUTE_MS;
/** At most one ping per member per workspace in this span (AC-08). */
export const PING_SPACING_MS = 10 * MINUTE_MS;
/** A tab that left the screen still counts as present for this long (D1). */
export const PRESENCE_WINDOW_MS = 10 * MINUTE_MS;
/** A presence lease lasts this long past its last pong; pongs come every 25 s (ADR-0002). */
export const LEASE_MS = 50_000;
/** The per-workspace sweep period (ADR-0005). */
export const SWEEP_EVERY_MS = 20_000;
/**
 * A sweep starts no member send after this long. One send is at most the 10 s Telegram timeout plus
 * pacing, so a sweep ends well before the `send-pings` job expiry (60 s), which the cron would
 * otherwise treat as dead and start a second sweep beside it.
 */
export const SWEEP_SEND_BUDGET_MS = 30_000;
/** At most this many member sends per second per bot (ADR-0006). */
export const SENDS_PER_SECOND = 10;
/** A tab opened within this span of a ping counts as "ping to panel" (spec section 7). */
export const OPENED_AT_WINDOW_MS = 15 * MINUTE_MS;
