import { ErrorCode, type LaunchBreakdown } from '@tg/shared';
import { Link } from 'react-router';
import { formatBotTime } from '@/features/bot/settings/format';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { AudienceBreakdown, formatCount } from './AudienceBreakdown';

// The launch pre-check refusals (SCR-25 refusal rows), shown on the draft (SCR-25) and in the
// launch confirmation when they come at confirm time (SCR-27).

export const BOT_REFUSALS: Record<string, string> = {
  not_connected: 'Launching needs a connected bot.',
  needs_token: "Your bot's token stopped working — replace it to launch.",
  taken_over: 'Your bot is connected elsewhere — reconnect it to launch.',
};

export type LaunchRefusal =
  | { kind: 'bot'; state: string }
  | { kind: 'too_large'; size: number }
  | { kind: 'unreachable'; breakdown: LaunchBreakdown }
  | { kind: 'limit'; next: string }
  | { kind: 'duplicate_failed' };

/** A launch pre-check refusal in an API answer; null for any other error. */
export function launchRefusalOf(error: unknown): LaunchRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as Record<string, unknown> | undefined;
  switch (error.code) {
    case ErrorCode.BROADCAST_NEEDS_WORKING_BOT:
      return { kind: 'bot', state: String(details?.bot_state) };
    case ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE:
      return { kind: 'too_large', size: Number(details?.audience_size) };
    case ErrorCode.BROADCAST_NO_REACHABLE_CONTACT:
      return { kind: 'unreachable', breakdown: details?.breakdown as LaunchBreakdown };
    case ErrorCode.BROADCAST_LAUNCH_LIMIT_REACHED:
      return { kind: 'limit', next: String(details?.next_launch_at) };
    default:
      return null;
  }
}

export function RefusalAlert({
  refusal,
  botSettingsHref,
}: {
  refusal: LaunchRefusal;
  botSettingsHref: string;
}) {
  switch (refusal.kind) {
    case 'bot':
      return (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {BOT_REFUSALS[refusal.state] ?? BOT_REFUSALS.not_connected}
            <Button asChild size="sm" variant="outline">
              <Link to={botSettingsHref}>Open bot settings</Link>
            </Button>
          </AlertDescription>
        </Alert>
      );
    case 'too_large':
      return (
        <Alert>
          <AlertDescription>
            {`A broadcast's audience can hold at most ${formatCount(10_000)} contacts — this one holds ${formatCount(refusal.size)}.`}
          </AlertDescription>
        </Alert>
      );
    case 'unreachable':
      return (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>This audience has no reachable contact.</span>
            <AudienceBreakdown breakdown={refusal.breakdown} />
          </AlertDescription>
        </Alert>
      );
    case 'limit':
      return (
        <Alert>
          <AlertDescription>
            {`A workspace can launch at most 10 broadcasts in 24 hours. The next launch is possible at ${formatBotTime(refusal.next)}.`}
          </AlertDescription>
        </Alert>
      );
    case 'duplicate_failed':
      return (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t duplicate the broadcast</AlertDescription>
        </Alert>
      );
  }
}
