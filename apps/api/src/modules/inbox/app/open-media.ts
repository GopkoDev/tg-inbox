import type { Readable } from 'node:stream';
import {
  MediaUnavailableError,
  NotFoundError,
  TelegramUnavailableError,
} from '../../../platform/errors.js';
import type { OpenMedia } from '../../bots/app/open-media.js';
import type { InboxReads } from '../../conversations/app/inbox-reads.js';

export interface OpenMessageMediaDeps {
  conversations: Pick<InboxReads, 'messageMedia'>;
  bots: { openMedia: OpenMedia['openMedia'] };
}

export type OpenedMedia =
  | {
      outcome: 'stream';
      status: 200 | 206;
      body: Readable;
      contentType: string;
      contentDisposition: string;
      contentLength: number | null;
      contentRange: string | undefined;
    }
  | { outcome: 'range_not_satisfiable' };

// The only types ever served as themselves, by kind family (ADR-0006). Telegram's declared type is a
// hint: it is used when it is on this list for the kind, never otherwise.
const IMAGE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO = ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm'];

const BY_KIND: Record<string, { allowed: string[]; fallback: string }> = {
  photo: { allowed: IMAGE, fallback: 'image/jpeg' },
  sticker: { allowed: IMAGE, fallback: 'image/webp' },
  video: { allowed: VIDEO, fallback: 'video/mp4' },
  animation: { allowed: VIDEO, fallback: 'video/mp4' },
  video_note: { allowed: VIDEO, fallback: 'video/mp4' },
  voice: { allowed: AUDIO, fallback: 'audio/ogg' },
  audio: { allowed: AUDIO, fallback: 'audio/mpeg' },
};

/** RFC 5987 `value-chars`: everything but the attr-chars is percent-encoded. */
const encodeFileName = (name: string) =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function responseTypeFor(
  kind: string,
  mimeType: string | null,
  fileName: string | null,
): { contentType: string; contentDisposition: string } {
  const policy = BY_KIND[kind];
  if (!policy) {
    return {
      contentType: 'application/octet-stream',
      contentDisposition: `attachment; filename*=UTF-8''${encodeFileName(fileName || 'file')}`,
    };
  }
  const declared = mimeType?.toLowerCase().split(';')[0]?.trim();
  return {
    contentType: declared && policy.allowed.includes(declared) ? declared : policy.fallback,
    contentDisposition: 'inline',
  };
}

/** Flow 3: the media of one message, through the workspace's own bot (ADR-0006). */
export function createOpenMessageMedia({ conversations, bots }: OpenMessageMediaDeps) {
  return {
    async openMessageMedia(
      workspaceId: string,
      conversationId: string,
      messageId: string,
      range?: string,
    ): Promise<OpenedMedia> {
      const media = await conversations.messageMedia(workspaceId, conversationId, messageId);
      if (!media) throw new NotFoundError('Not found');
      const opened = await bots.openMedia({
        workspaceId,
        fileReference: media.fileReference,
        fileSize: media.fileSize,
        range,
      });
      switch (opened.outcome) {
        case 'unavailable':
          throw new MediaUnavailableError(opened.reason);
        case 'telegram_unavailable':
          throw new TelegramUnavailableError();
        case 'range_not_satisfiable':
          return opened;
        case 'stream':
          return {
            outcome: 'stream',
            status: opened.status,
            body: opened.body,
            contentLength: opened.contentLength,
            contentRange: opened.contentRange,
            ...responseTypeFor(media.kind, media.mimeType, media.fileName),
          };
      }
    },
  };
}

export type OpenMessageMedia = ReturnType<typeof createOpenMessageMedia>;
