import { isValidTimeZone } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/features/inbox/StateChangedDialog';
import { ApiError } from '@/shared/api/client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import { schedulePost, setPostingTimeZone } from '../api';
import {
  BLOCKER_TEXT,
  BotSettingsLink,
  ErrorCode,
  ProblemAlert,
  errorCode,
  isAuthError,
  useConfirmation,
} from './shared';

type Problem =
  | { kind: 'range' }
  | { kind: 'missing'; date: string; time: string }
  | { kind: 'zone'; zone: string | null }
  | { kind: 'changed' }
  | { kind: 'bot' }
  | { kind: 'destination' }
  | { kind: 'limit' }
  | { kind: 'zone_invalid' }
  | { kind: 'failed' };

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * SCR-39: choose the moment in the workspace time zone (owner only). The first schedule asks to
 * confirm the zone; the confirmation's version goes with the request (AC-08, AC-09, AC-10).
 */
export function ScheduleDialog({
  workspaceId,
  postId,
  changeTime = false,
  initialLocalTime,
  onClose,
  onDone,
}: {
  workspaceId: string;
  postId: string;
  changeTime?: boolean;
  initialLocalTime?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const { data, setData, failed, reload } = useConfirmation(workspaceId, postId);
  const [date, setDate] = useState(initialLocalTime?.slice(0, 10) ?? '');
  const [time, setTime] = useState(initialLocalTime?.slice(11, 16) ?? '');
  const [zoneInput, setZoneInput] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const inFlight = useRef(false);

  const fail = (error: unknown) => {
    if (isAuthError(error)) {
      onClose();
      void guard(error as ApiError, workspaceId).catch(() => undefined);
      return true;
    }
    return false;
  };

  const saveZone = async () => {
    const zone = zoneInput.trim();
    if (!isValidTimeZone(zone)) {
      setProblem({ kind: 'zone_invalid' });
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const saved = await setPostingTimeZone(workspaceId, { time_zone: zone });
      setData((current) => (current ? { ...current, time_zone: saved.time_zone } : current));
    } catch (error) {
      if (errorCode(error) === ErrorCode.TIME_ZONE_INVALID) setProblem({ kind: 'zone_invalid' });
      else if (!fail(error)) setProblem({ kind: 'failed' });
    } finally {
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!data || !data.time_zone || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await schedulePost(workspaceId, postId, {
        expected_version: data.version,
        local_time: `${date}T${time}`,
        time_zone: data.time_zone,
      });
      onDone();
    } catch (error) {
      const code = errorCode(error);
      if (code === ErrorCode.POST_SCHEDULE_OUT_OF_RANGE) setProblem({ kind: 'range' });
      else if (code === ErrorCode.POST_TIME_DOES_NOT_EXIST)
        setProblem({ kind: 'missing', date, time });
      else if (code === ErrorCode.TIME_ZONE_CHANGED) {
        const zone = (error as ApiError).details as { time_zone?: string } | undefined;
        setProblem({ kind: 'zone', zone: zone?.time_zone ?? null });
        await reload();
      } else if (code === ErrorCode.TIME_ZONE_REQUIRED) {
        setData((current) => (current ? { ...current, time_zone: null } : current));
      } else if (code === ErrorCode.POST_DRAFT_CHANGED) {
        setProblem({ kind: 'changed' });
        await reload();
      } else if (code === ErrorCode.POSTS_NEED_WORKING_BOT) setProblem({ kind: 'bot' });
      else if (code === ErrorCode.DESTINATION_UNAVAILABLE) setProblem({ kind: 'destination' });
      else if (code === ErrorCode.POST_SCHEDULED_LIMIT_REACHED) setProblem({ kind: 'limit' });
      else if (!fail(error)) setProblem({ kind: 'failed' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const needsZone = data !== null && data.time_zone === null;
  const blockers = data?.blockers.filter((b) => b !== 'daily_limit') ?? [];
  const submitLabel = changeTime ? 'Change time' : 'Schedule';

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent
        {...focus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {needsZone
              ? 'Confirm the workspace time zone'
              : changeTime
                ? 'Change the time'
                : 'Schedule the post'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {needsZone
              ? 'Scheduled posts go out at local times in this zone. Every member sees times in it.'
              : 'Pick when the bot should post. You can move it back to a draft until it goes out.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!data ? (
          failed ? (
            <ProblemAlert>Couldn&apos;t load the post</ProblemAlert>
          ) : (
            <div data-testid="publish-skeleton" className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-full" />
            </div>
          )
        ) : needsZone ? (
          <div className="space-y-2">
            <Label htmlFor="schedule-zone">Time zone</Label>
            <Input
              id="schedule-zone"
              value={zoneInput}
              onChange={(e) => setZoneInput(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              {data.destination ? (
                <span className="font-medium">{data.destination.title}</span>
              ) : null}
              <p className="text-muted-foreground line-clamp-2 whitespace-pre-wrap">{data.text}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="schedule-time">Time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              In the workspace time zone: <span className="font-medium">{data.time_zone}</span>
            </p>
            {blockers.map((blocker) => (
              <ProblemAlert key={blocker}>
                {BLOCKER_TEXT[blocker]}
                {blocker === 'bot_not_working' ? (
                  <>
                    {' '}
                    <BotSettingsLink workspaceId={workspaceId} />
                  </>
                ) : null}
              </ProblemAlert>
            ))}
          </div>
        )}

        {problem?.kind === 'range' ? (
          <ProblemAlert>Pick a time between 2 minutes and 90 days from now</ProblemAlert>
        ) : null}
        {problem?.kind === 'missing' ? (
          <ProblemAlert>
            {`${problem.time} doesn't exist on ${dayLabel(problem.date)} in ${data?.time_zone ?? ''} — pick another time`}
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'zone' ? (
          <ProblemAlert>
            {problem.zone
              ? `The workspace time zone changed to ${problem.zone} — check the time`
              : 'The workspace time zone changed — check the time'}
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'changed' ? (
          <ProblemAlert>The draft changed — check it again</ProblemAlert>
        ) : null}
        {problem?.kind === 'bot' ? (
          <ProblemAlert>
            The bot is not working. <BotSettingsLink workspaceId={workspaceId} />
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'destination' ? (
          <ProblemAlert>The bot can&apos;t post in this chat any more</ProblemAlert>
        ) : null}
        {problem?.kind === 'limit' ? (
          <ProblemAlert>
            100 scheduled posts are already waiting — the limit was reached
          </ProblemAlert>
        ) : null}
        {problem?.kind === 'zone_invalid' ? (
          <ProblemAlert>That isn&apos;t a valid time zone</ProblemAlert>
        ) : null}
        {problem?.kind === 'failed' ? (
          <ProblemAlert>Couldn&apos;t schedule the post</ProblemAlert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {needsZone ? (
            <Button type="button" disabled={pending} onClick={() => void saveZone()}>
              {pending ? (
                <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
              ) : null}
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!data || blockers.length > 0 || !date || !time || pending}
              onClick={() => void confirm()}
            >
              {pending ? (
                <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
              ) : null}
              {submitLabel}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
