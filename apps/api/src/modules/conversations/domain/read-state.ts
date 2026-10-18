/** Advance the arrival watermark: never lower, never beyond the newest arrival. */
export function raise(current: Date | null, proposed: Date, newestArrival: Date): Date {
  const higher = current && current.getTime() > proposed.getTime() ? current : proposed;
  return higher.getTime() > newestArrival.getTime() ? newestArrival : higher;
}

/** Messages that arrived after this instant are unread for the member. */
export function unreadFloor(mark: Date | null, activeSince: Date): Date {
  return mark && mark.getTime() > activeSince.getTime() ? mark : activeSince;
}
