import type { BroadcastRecipient, RecipientState, RecipientTotals } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router';
import { formatBotTime } from '@/features/bot/settings/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatCount } from './AudienceBreakdown';
import { useBroadcastReportStore } from './report-store';

/** Decision 10: the outcome of a recipient in plain words. */
export const OUTCOME_LABELS: Record<RecipientState, string> = {
  waiting: 'Waiting',
  sending: 'Sending…',
  delivered: 'Delivered',
  blocked: 'Blocked the bot',
  failed: 'Failed',
  not_confirmed: 'Not confirmed',
  stopped: 'Not sent — stopped',
};

const REASONS: Record<string, string> = {
  account_gone: 'Account no longer exists',
  chat_not_found: 'Chat not found',
  telegram_error: 'Telegram error',
  text_refused: 'Telegram refused the text',
  bot_stopped: 'The bot stopped working',
};
const NOT_CONFIRMED = 'Not confirmed — Telegram did not answer, not sent again';

const FILTERS: Array<[RecipientState | 'all', string]> = [
  ['all', 'All recipients'],
  ['waiting', 'Waiting'],
  ['delivered', 'Delivered'],
  ['blocked', 'Blocked the bot'],
  ['failed', 'Failed'],
  ['not_confirmed', 'Not confirmed'],
  ['stopped', 'Not sent — stopped'],
];

const reasonOf = (r: BroadcastRecipient) =>
  r.state === 'failed' && r.failure_reason
    ? REASONS[r.failure_reason]
    : r.state === 'not_confirmed'
      ? NOT_CONFIRMED
      : '';

const nameOf = (r: BroadcastRecipient) =>
  [r.contact.first_name, r.contact.last_name].filter(Boolean).join(' ');

function Totals({ totals }: { totals: RecipientTotals }) {
  const blocks: Array<[string, number]> = [
    ['Waiting', totals.waiting + totals.sending],
    ['Delivered', totals.delivered],
    ['Blocked the bot', totals.blocked],
    ['Failed', totals.failed + totals.not_confirmed],
    ...(totals.stopped > 0 ? [['Not sent — stopped', totals.stopped] as [string, number]] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-6">
      {blocks.map(([label, value]) => (
        <div key={label} data-total className="flex flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-lg font-semibold tabular-nums">{formatCount(value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The delivery report (Decision 10, SCR-28): five totals, the outcome filter and the recipients 50
 * at a time from the report store, re-read live in place (ADR-0011).
 */
export function BroadcastReport({
  workspaceId,
  totals,
}: {
  workspaceId: string;
  totals: RecipientTotals;
}) {
  const guard = useShellGuard();
  const filter = useBroadcastReportStore((s) => s.filter);
  const recipients = useBroadcastReportStore((s) => s.recipients);

  return (
    <Card data-testid="broadcast-report">
      <CardHeader>
        <CardTitle>Delivery report</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Totals totals={totals} />
        <Select
          value={filter ?? 'all'}
          onValueChange={(v) =>
            void useBroadcastReportStore
              .getState()
              .setFilter(v === 'all' ? null : (v as RecipientState), guard)
          }
        >
          <SelectTrigger aria-label="Outcome" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {recipients.items.length === 0 && filter ? (
          <p className="text-sm text-muted-foreground">No recipients with this outcome.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="hidden md:table-cell">Reason</TableHead>
                <TableHead className="hidden md:table-cell">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="break-words">
                    <Link
                      className="font-medium hover:underline"
                      to={`/w/${workspaceId}/contacts/${r.contact.id}`}
                    >
                      {nameOf(r)}
                    </Link>
                    <span className="block text-xs text-muted-foreground md:hidden">
                      {reasonOf(r)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.state === 'delivered' ? 'default' : 'outline'}>
                      {OUTCOME_LABELS[r.state]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{reasonOf(r)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {r.outcome_at ? formatBotTime(r.outcome_at) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {recipients.more === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              Couldn&apos;t load more recipients
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void useBroadcastReportStore.getState().showMore(guard)}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : recipients.hasNext ? (
          <Button
            type="button"
            variant="outline"
            className="self-center"
            disabled={recipients.more === 'loading'}
            onClick={() => void useBroadcastReportStore.getState().showMore(guard)}
          >
            {recipients.more === 'loading' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            Show more
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
