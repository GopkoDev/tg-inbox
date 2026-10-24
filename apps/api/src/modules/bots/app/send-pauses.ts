import type { BotRepo } from './ports.js';

/**
 * The latest send pause of each bot this process has stored (ADR-0008): a broadcast send checks it
 * synchronously right after its pacer slot, so nothing awaits between the slot and the Telegram
 * call. The stored `send_paused_until` stays the source for other processes; this is its echo.
 */
export interface SendPauses {
  note(botId: string, until: Date): void;
  /** The pause noted for the bot, or null. */
  until(botId: string): Date | null;
}

export function createSendPauses(): SendPauses {
  const latest = new Map<string, Date>();
  return {
    note(botId, until) {
      const known = latest.get(botId);
      if (!known || known.getTime() < until.getTime()) latest.set(botId, until);
    },
    until: (botId) => latest.get(botId) ?? null,
  };
}

/** The bot repository with every stored pause also noted in `pauses` (one per process). */
export function withPauseNotes<R extends Pick<BotRepo, 'pauseSends'>>(
  repo: R,
  pauses: SendPauses,
): R {
  return {
    ...repo,
    async pauseSends(workspaceId, botId, until, tx) {
      pauses.note(botId, until);
      return repo.pauseSends(workspaceId, botId, until, tx);
    },
  };
}
