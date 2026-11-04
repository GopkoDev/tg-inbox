import {
  DestinationProblem,
  ErrorCode,
  type PublishBlocker,
  type PublishConfirmation,
} from '@tg/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { getPublishConfirmation } from '../api';

export const KIND_LABEL = { channel: 'Channel', group: 'Group' } as const;

export const BLOCKER_TEXT: Record<PublishBlocker, string> = {
  text_empty: 'The post has no text',
  no_destination: 'Pick where the post goes first',
  destination_unavailable: 'The bot can no longer post in this chat — connect it again',
  bot_not_working: 'The bot is not working',
  daily_limit: 'The daily posting limit was reached',
  not_a_draft: 'This post is no longer a draft',
};

/** SCR-33 plain texts for why the bot cannot post in a chat. */
export const DESTINATION_PROBLEM_TEXT: Record<DestinationProblem, string> = {
  no_post_right: "The bot can't post there. Give it the right to post, then try again.",
  not_member: 'The bot is no longer in this channel or group.',
  chat_gone: 'This channel or group no longer exists.',
  not_current_bot: 'This destination was connected with another bot. Connect it again.',
};

/** The refusal's `details.problem` as plain text; the generic line when it is missing. */
export function destinationProblemText(error: unknown): string | null {
  const details =
    error instanceof ApiError ? (error.details as { problem?: unknown } | undefined) : undefined;
  const parsed = DestinationProblem.safeParse(details?.problem);
  return parsed.success ? DESTINATION_PROBLEM_TEXT[parsed.data] : null;
}

/** Reads the confirmation (SCR-38 / SCR-39); `reload` re-reads without dropping the content. */
export function useConfirmation(workspaceId: string, postId: string) {
  const [data, setData] = useState<PublishConfirmation | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await getPublishConfirmation(workspaceId, postId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [workspaceId, postId]);

  useEffect(() => {
    let live = true;
    getPublishConfirmation(workspaceId, postId).then(
      (value) => live && setData(value),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [workspaceId, postId]);

  return { data, setData, failed, reload };
}

export function BotSettingsLink({ workspaceId }: { workspaceId: string }) {
  return (
    <Link className="underline" to={`/w/${workspaceId}/settings/bot`}>
      Open bot settings
    </Link>
  );
}

export function ProblemAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : null);

export const isAuthError = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export { ErrorCode };
