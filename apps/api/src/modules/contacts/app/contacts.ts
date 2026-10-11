import type { Clock } from '../../../platform/clock.js';
import type { ContactProfile, ContactRepo, Executor, UpsertResult } from './ports.js';

export interface ContactsDeps {
  repo: ContactRepo;
  clock: Clock;
}

/** The contacts app layer — what `conversations` (capture) and `bots` (settings) call. */
export interface Contacts {
  /** Called inside the capture transaction (`tx`) with the message's time as `seenAt`. */
  upsertFromProfile(
    workspaceId: string,
    profile: ContactProfile,
    seenAt: Date,
    tx?: Executor,
  ): Promise<UpsertResult>;
  countContacts(workspaceId: string): Promise<number>;
}

export function createContacts({ repo, clock }: ContactsDeps): Contacts {
  return {
    upsertFromProfile: (workspaceId, profile, seenAt, tx) =>
      repo.upsertFromProfile(workspaceId, profile, seenAt, clock.now(), tx),
    countContacts: (workspaceId) => repo.count(workspaceId),
  };
}
