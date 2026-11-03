import type { DraftBreakdown, LaunchBreakdown } from '@tg/shared';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';

const numbers = new Intl.NumberFormat();
export const formatCount = (n: number) => numbers.format(n);
export const contactsText = (n: number) =>
  `${numbers.format(n)} ${n === 1 ? 'contact' : 'contacts'}`;

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-line className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The count breakdown (screens.md Decision 7) on SCR-25 (live draft numbers), SCR-27 (the
 * confirmation) and SCR-28 (frozen at launch): the audience, who is left out and why, and who it
 * reaches. A draft with no bot shows only the audience size.
 */
export function AudienceBreakdown({
  breakdown,
  reachLabel = 'Would reach',
  botSettingsHref,
}: {
  breakdown: DraftBreakdown | LaunchBreakdown;
  reachLabel?: 'Would reach' | 'Sent to';
  /** The owner's way to the bot settings when reach is unknown (no bot). */
  botSettingsHref?: string;
}) {
  const reach =
    'reach' in breakdown
      ? breakdown.reach && {
          blocked: breakdown.reach.blocked_count,
          neverWrote: breakdown.reach.never_wrote_count,
          reachable: breakdown.reach.reachable_count,
        }
      : {
          blocked: breakdown.blocked_count,
          neverWrote: breakdown.never_wrote_count,
          reachable: breakdown.recipient_count,
        };
  return (
    <dl className="flex flex-col gap-1.5" aria-label="Count breakdown">
      <Line label="Audience">{contactsText(breakdown.audience_size)}</Line>
      {reach ? (
        <>
          <Line label="Left out — blocked the bot">{formatCount(reach.blocked)}</Line>
          <Line label="Left out — never wrote to the current bot">
            {formatCount(reach.neverWrote)}
          </Line>
          <Separator className="my-1" />
          <Line label={reachLabel}>
            <strong className="text-base font-semibold text-foreground">
              {formatCount(reach.reachable)}
            </strong>
          </Line>
        </>
      ) : (
        <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
          <p>Reach is known once a bot is connected.</p>
          {botSettingsHref ? (
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to={botSettingsHref}>Open bot settings</Link>
            </Button>
          ) : null}
        </div>
      )}
    </dl>
  );
}
