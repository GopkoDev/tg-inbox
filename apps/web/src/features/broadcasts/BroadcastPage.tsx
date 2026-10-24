import type { LaunchedBroadcast } from '@tg/shared';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { formatBotTime } from '@/features/bot/settings/format';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { audienceText } from './audience-text';
import { AudienceBreakdown } from './AudienceBreakdown';
import { BroadcastReport } from './BroadcastReport';
import { DuplicateBroadcastDialog } from './DuplicateBroadcastDialog';
import { StatusBadge } from './BroadcastsTable';
import { useBroadcastReportStore } from './report-store';
import { StopBroadcastDialog } from './StopBroadcastDialog';

const ENDED_EARLY: Record<string, { alert: string; note: string }> = {
  text_refused: {
    alert: 'Sending ended early: Telegram refused the text.',
    note: '— ended early: Telegram refused the text',
  },
  bot_stopped: {
    alert: 'Sending ended early: the bot stopped working.',
    note: '— ended early: the bot stopped working',
  },
};

/** Who launched it and when, in every status (AC-11), then how it ended once it did. */
function whenLines(b: LaunchedBroadcast): string[] {
  const lines = [`Launched by ${b.launched_by.display_name} · ${formatBotTime(b.launched_at)}`];
  if (b.status === 'stopped' && b.stopped_by && b.stopped_at) {
    lines.push(`Stopped by ${b.stopped_by.display_name} · ${formatBotTime(b.stopped_at)}`);
  } else if (b.status === 'sent' && b.ended_at) lines.push(`Finished ${formatBotTime(b.ended_at)}`);
  return lines;
}

/**
 * SCR-28, the read-only broadcast page (AC-11, AC-12, AC-18): the message, the audience as defined
 * with the frozen breakdown, the live delivery report, and Stop for a business owner while it sends
 * (SCR-29), and Duplicate (SCR-30) for any member.
 */
export function BroadcastPage({
  workspaceId,
  broadcastId,
  notice,
  onDuplicate,
}: {
  workspaceId: string;
  broadcastId: string;
  /** A one-line notice above the page (e.g. launched while the draft was open). */
  notice?: ReactNode;
  /** Replaces the page's own SCR-30 opener (tests, another host). */
  onDuplicate?: () => void;
}) {
  const guard = useShellGuard();
  const role = useWorkspaceStore((s) => s.current?.role ?? 'operator');
  const status = useBroadcastReportStore((s) =>
    s.broadcastId === broadcastId ? s.status : 'idle',
  );
  const broadcast = useBroadcastReportStore((s) =>
    s.broadcastId === broadcastId ? s.broadcast : null,
  );
  const [stopping, setStopping] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [unchanged, setUnchanged] = useState(false);

  useEffect(() => {
    const store = useBroadcastReportStore.getState();
    void store.open(workspaceId, broadcastId, guard);
    const stop = store.watch(workspaceId, guard);
    return () => {
      stop();
      useBroadcastReportStore.getState().close();
    };
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, broadcastId]);

  if (status === 'not_found') return <NotFoundCard />;
  if (status === 'error')
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load this broadcast
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void useBroadcastReportStore.getState().open(workspaceId, broadcastId, guard)
            }
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!broadcast || broadcast.status === 'draft')
    return (
      <section data-testid="broadcast-launched-view" className="flex flex-col gap-4">
        {notice}
        <div className="flex flex-col gap-4" data-testid="report-skeleton">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
          <Card>
            <CardContent className="flex flex-col gap-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} data-testid="recipient-skeleton" className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    );

  const b = broadcast;
  const openDuplicate = onDuplicate ?? (() => setDuplicating(true));
  const early = b.status === 'sent' && b.end_reason ? ENDED_EARLY[b.end_reason] : undefined;
  const canStop = role === 'owner' && !ownersOnly && b.status === 'sending';

  return (
    <section data-testid="broadcast-launched-view" className="flex flex-col gap-4">
      {notice}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold break-words">{b.name}</h1>
        <StatusBadge status={b.status} />
        {early ? <span className="text-sm text-muted-foreground">{early.note}</span> : null}
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <Button type="button" variant="outline" onClick={openDuplicate}>
            Duplicate
          </Button>
          {canStop ? (
            <Button
              type="button"
              variant="outline"
              className="border-destructive text-destructive"
              onClick={() => setStopping(true)}
            >
              Stop
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
        {whenLines(b).map((line) => (
          <Fragment key={line}>
            <span>{line}</span>
            <span aria-hidden>·</span>
          </Fragment>
        ))}
        <span>Read-only — a launched broadcast can&apos;t be changed.</span>
      </div>
      {unchanged ? (
        <Alert>
          <AlertDescription>
            Nothing was waiting any more — the broadcast had already finished.
          </AlertDescription>
        </Alert>
      ) : null}
      {early ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>{early.alert}</span>
            <span>
              You can duplicate it, fix the text or the bot, and send the copy to the recipients it
              did not reach.
            </span>
            <Button type="button" size="sm" className="self-start" onClick={openDuplicate}>
              Duplicate
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="broadcast-text" className="text-sm whitespace-pre-wrap break-words">
              {b.text}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audience</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm break-words">{audienceText(b.audience)}</p>
            <AudienceBreakdown breakdown={b.launch_breakdown} reachLabel="Sent to" />
          </CardContent>
        </Card>
      </div>
      <BroadcastReport workspaceId={workspaceId} totals={b.totals} />
      <DuplicateBroadcastDialog
        workspaceId={workspaceId}
        broadcast={duplicating ? b : null}
        onClose={() => setDuplicating(false)}
      />
      <StopBroadcastDialog
        workspaceId={workspaceId}
        broadcastId={broadcastId}
        waiting={b.totals.waiting}
        open={stopping}
        onClose={() => setStopping(false)}
        onAnswered={(answer) => {
          setStopping(false);
          setUnchanged(answer.outcome === 'unchanged');
          useBroadcastReportStore.setState({ broadcast: answer.broadcast });
        }}
        onOwnerOnly={() => {
          setStopping(false);
          setOwnersOnly(true);
        }}
      />
    </section>
  );
}
