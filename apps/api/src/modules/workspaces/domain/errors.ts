import type { MembershipState } from './membership.js';

/** Domain errors are pure; the app layer maps them to the platform ConflictError / API codes. */
export class LastActiveOwnerError extends Error {
  readonly code = 'LAST_ACTIVE_OWNER';
  constructor() {
    super('A workspace must always have at least one active business owner');
    this.name = 'LastActiveOwnerError';
  }
}

export class AlreadyAMemberError extends Error {
  readonly code = 'ALREADY_A_MEMBER';
  constructor(
    readonly membershipId: string,
    readonly state: MembershipState,
  ) {
    super('This person is already a member — reactivate them if they are deactivated');
    this.name = 'AlreadyAMemberError';
  }
}
