/** Mirrors `bots_state_check`. */
export const BOT_STATES = ['connected', 'needs_token', 'taken_over', 'disconnected'] as const;

export type BotState = (typeof BOT_STATES)[number];

/** A live row holds a token, a webhook secret and a capture epoch; only `disconnected` drops them. */
export function isLive(state: BotState): boolean {
  return state !== 'disconnected';
}

export type PasteDecision =
  | { action: 'connect' }
  | { action: 'connectAgain' }
  | { action: 'rotate' }
  | { action: 'refuse'; reason: 'connected' | 'history' };

/**
 * What pasting a token of `pastedBotId` does to the workspace's bot row (flow 1):
 * no row → connect; same bot disconnected → connect again (new capture epoch); same bot live →
 * rotate the token (epoch kept); a different bot → refuse (AC-05): `connected` while the row is
 * live, `history` once it was kept after a disconnect because customers wrote to it.
 */
export function decidePaste(
  row: { state: BotState; telegramBotId: bigint } | null,
  pastedBotId: bigint,
): PasteDecision {
  if (row === null) return { action: 'connect' };
  if (row.telegramBotId !== pastedBotId) {
    return { action: 'refuse', reason: isLive(row.state) ? 'connected' : 'history' };
  }
  return isLive(row.state) ? { action: 'rotate' } : { action: 'connectAgain' };
}
