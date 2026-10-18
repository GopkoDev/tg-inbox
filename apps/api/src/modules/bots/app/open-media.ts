import type { Readable } from 'node:stream';
import { MAX_DOWNLOAD_BYTES, type BotRepo, type TelegramGateway } from './ports.js';
import type { MarkNeedsToken } from './mark-needs-token.js';

export interface OpenMediaDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
}

export interface OpenMediaRequest {
  workspaceId: string;
  /** The Telegram `file_id` captured with the message. */
  fileReference: string;
  /** The captured size in bytes; null when Telegram did not say. */
  fileSize: bigint | number | null;
  /** A single `Range` request header value, forwarded as is. */
  range?: string | undefined;
}

export type UnavailableReason =
  'bot_not_connected' | 'bot_not_working' | 'file_too_large' | 'file_gone';

export type OpenMediaResult =
  | {
      outcome: 'stream';
      body: Readable;
      status: 200 | 206;
      contentLength: number | null;
      contentRange?: string;
    }
  | { outcome: 'unavailable'; reason: UnavailableReason }
  | { outcome: 'telegram_unavailable' }
  | { outcome: 'range_not_satisfiable' };

export interface OpenMedia {
  /**
   * Streams a customer's file through the workspace's own bot. Nothing but the typed result leaves
   * `bots`: no token, no download URL. A rejected token flips the bot to `needs_token`.
   */
  openMedia(request: OpenMediaRequest): Promise<OpenMediaResult>;
}

const unavailable = (reason: UnavailableReason): OpenMediaResult => ({
  outcome: 'unavailable',
  reason,
});

export function createOpenMedia({ bots, telegram, markNeedsToken }: OpenMediaDeps): OpenMedia {
  return {
    async openMedia({ workspaceId, fileReference, fileSize, range }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || bot.state === 'disconnected') return unavailable('bot_not_connected');
      if (bot.state === 'needs_token') return unavailable('bot_not_working');
      if (fileSize !== null && BigInt(fileSize) > BigInt(MAX_DOWNLOAD_BYTES)) {
        return unavailable('file_too_large');
      }
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return unavailable('bot_not_connected');
      // The key that encrypted the token is gone: the owner pastes the token again.
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return unavailable('bot_not_working');
      }
      const fetched = await telegram.openFile(found.token, fileReference, range);
      switch (fetched.outcome) {
        case 'stream':
          return fetched;
        case 'too_large':
          return unavailable('file_too_large');
        case 'gone':
          return unavailable('file_gone');
        case 'unauthorized':
          await markNeedsToken(workspaceId);
          return unavailable('bot_not_working');
        case 'unavailable':
          return { outcome: 'telegram_unavailable' };
        case 'range_not_satisfiable':
          return fetched;
      }
    },
  };
}
