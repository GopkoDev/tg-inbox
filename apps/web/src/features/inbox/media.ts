import { ErrorCode, MediaUnavailableReason } from '@tg/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiBlob } from '@/shared/api/client';
import { useInboxStore } from './store';

/** What the panel can show for one message's media (SCR-02 content rows, SCR-03 states). */
export type MediaState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; contentType: string }
  | { status: 'unavailable'; reason: MediaUnavailableReason }
  | { status: 'not_responding' }
  | { status: 'error' };

export interface MediaRef {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

export const UNAVAILABLE_REASON_TEXT: Record<MediaUnavailableReason, string> = {
  bot_not_connected: 'the bot is disconnected',
  bot_not_working: 'the bot is not working — it needs a new token',
  file_too_large: 'the file is too large to open in tg-inbox',
  file_gone: 'Telegram no longer keeps this file',
};

export const mediaPath = ({ workspaceId, conversationId, messageId }: MediaRef) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/media`;

/**
 * Fetch the bytes through the API client; the caller owns (and must revoke) the object URL.
 * `background`: an automatic fetch (inline media on render) that must not extend the session.
 */
export async function fetchMedia(
  ref: MediaRef,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<{ url: string; contentType: string }> {
  const { blob, contentType } = await apiBlob(mediaPath(ref), {
    signal: options.signal,
    ...(options.background ? { background: true } : {}),
  });
  return { url: URL.createObjectURL(blob), contentType };
}

/**
 * Map a failed fetch to the view state of the contract's refusals. A 401/403 goes to the shell
 * guard (which ends the session or shows the access-removed notice); here it is a plain error.
 */
export function failureState(
  error: unknown,
  workspaceId: string,
): Exclude<MediaState, { status: 'ready' | 'loading' }> {
  useInboxStore.getState().reportGuard(error, workspaceId);
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === ErrorCode.MEDIA_UNAVAILABLE) {
      const reason = MediaUnavailableReason.safeParse(
        (error.details as { reason?: unknown } | undefined)?.reason,
      );
      if (reason.success) return { status: 'unavailable', reason: reason.data };
    }
    if (error.status === 503 || error.status === 416) return { status: 'not_responding' };
  }
  return { status: 'error' };
}

/**
 * Load a message's media into an object URL (revoked on unmount / change). The hook is per
 * message: callers mount it keyed by the message, so ids never change under it.
 */
export function useMessageMedia(ref: MediaRef, enabled = true) {
  const { workspaceId, conversationId, messageId } = ref;
  const [state, setState] = useState<MediaState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let url: string | null = null;
    // Only the automatic first fetch is background; a Try again is the member's own action.
    fetchMedia(
      { workspaceId, conversationId, messageId },
      { signal: controller.signal, background: attempt === 0 },
    ).then(
      (media) => {
        if (controller.signal.aborted) URL.revokeObjectURL(media.url);
        else {
          url = media.url;
          setState({ status: 'ready', ...media });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState(failureState(error, workspaceId));
      },
    );
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspaceId, conversationId, messageId, enabled, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
