import type { ThreadActivity } from '@tg/shared';

/** The sentence of one activity entry; names are plain strings, rendered as text. */
export function activityText(a: ThreadActivity): string {
  if (a.cause === 'customer_wrote') return 'reopened — the customer wrote';
  if (a.cause === 'reply_not_delivered') return 'reopened — a reply was not delivered';
  if (a.cause === 'member_deactivated')
    return `unassigned — ${a.previous_assignee?.display_name ?? 'the assignee'} was deactivated`;
  const actor = a.actor?.display_name ?? '';
  switch (a.kind) {
    case 'assigned':
      return `${actor} assigned this to ${a.new_assignee?.display_name ?? ''}`;
    case 'reassigned':
      return `${actor} reassigned this from ${a.previous_assignee?.display_name ?? ''} to ${a.new_assignee?.display_name ?? ''}`;
    case 'unassigned':
      return `${actor} unassigned this`;
    case 'closed':
      return `${actor} closed this`;
    case 'reopened':
      return `${actor} reopened this`;
  }
}

/** SCR-02: a centred muted line among the messages for an assignment or status change. */
export function ActivityLine({ activity, at }: { activity: ThreadActivity; at: string }) {
  return (
    <p data-testid="activity-line" className="text-center text-xs text-muted-foreground">
      {activityText(activity)} · {at}
    </p>
  );
}
