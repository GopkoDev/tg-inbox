import { formatInZone, localToInstant, type LocalToInstant } from '@tg/shared';

/** `Wed 4 Nov, 09:00 (Europe/Kyiv)` for an ISO instant; always names the workspace zone. */
export const formatPostTime = (iso: string, zone: string): string =>
  formatInZone(new Date(iso), zone);

/** Local wall time `YYYY-MM-DDTHH:mm` in the zone to an instant; a skipped time is refused. */
export const localToInstantIn = (local: string, zone: string): LocalToInstant =>
  localToInstant(local, zone);
