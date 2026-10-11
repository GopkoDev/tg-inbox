/**
 * The edit rule (AC-10, ADR-0004): an edit replaces the stored text only when it is later — a
 * later Telegram `edit_date`, or an equal one with a higher `update_id`. A redelivered edit (equal
 * both) is not later, so out-of-order and repeated edits converge on the last one. The message
 * repository's conditional UPDATE encodes the same comparison.
 */
export function isLaterEdit(
  stored: { editedAt: Date; editUpdateId: bigint } | null,
  incoming: { editedAt: Date; updateId: bigint },
): boolean {
  if (stored === null) return true;
  const a = stored.editedAt.getTime();
  const b = incoming.editedAt.getTime();
  return b > a || (b === a && incoming.updateId > stored.editUpdateId);
}
