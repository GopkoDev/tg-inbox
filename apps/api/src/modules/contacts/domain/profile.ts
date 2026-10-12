/**
 * The profile refresh rule (AC-08): a contact's name, username and language are taken from a
 * message strictly newer than the one they were last seen in, so a late redelivery of an older
 * message never rolls a profile back. The contact repository's upsert encodes the same rule.
 */
export function shouldRefreshProfile(profileSeenAt: Date, messageSentAt: Date): boolean {
  return messageSentAt.getTime() > profileSeenAt.getTime();
}
