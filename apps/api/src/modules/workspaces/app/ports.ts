import type { MembershipState, Role } from '../domain/membership.js';

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'superseded';

/** Cursor paging over ids (UUIDv7, so id order is creation order). */
export interface PageQuery {
  after?: string;
  before?: string;
  limit: number;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: Date;
}

export interface MembershipRecord {
  id: string;
  workspaceId: string;
  accountId: string;
  role: Role;
  state: MembershipState;
  lastUsedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
}

export interface ActiveMembershipOfAccount extends MembershipRecord {
  workspaceName: string;
}

export interface InvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  tokenHash: Buffer;
  state: InvitationState;
  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
}

export interface InvitationWithWorkspace extends InvitationRecord {
  workspaceName: string;
}

export interface WorkspaceRepo {
  insert(workspace: WorkspaceRecord): Promise<void>;
  findById(workspaceId: string): Promise<WorkspaceRecord | null>;
  /** `SELECT … FOR UPDATE` — serialises team-changing commands of one workspace for the transaction. */
  lockForUpdate(workspaceId: string): Promise<boolean>;
}

export interface MembershipRepo {
  /** Violates the unique (workspace, account) key when a membership exists — the AC-16 backstop. */
  insert(workspaceId: string, membership: Omit<MembershipRecord, 'workspaceId'>): Promise<void>;
  findById(workspaceId: string, membershipId: string): Promise<MembershipRecord | null>;
  findByAccount(workspaceId: string, accountId: string): Promise<MembershipRecord | null>;
  list(workspaceId: string, page: PageQuery): Promise<MembershipRecord[]>;
  countActiveOwners(workspaceId: string): Promise<number>;
  hasAnyMember(workspaceId: string): Promise<boolean>;
  /** Returns whether a row of this workspace was changed. */
  setState(
    workspaceId: string,
    membershipId: string,
    state: MembershipState,
    deactivatedAt: Date | null,
  ): Promise<boolean>;
  touchLastUsed(workspaceId: string, accountId: string, at: Date): Promise<boolean>;

  // Controlled exceptions to the tenancy rule (sad.md §5): they produce the workspace id.
  /** Scoped by the signed-in account id. Ordered by last use, most recent first. */
  listActiveOfAccount(accountId: string): Promise<ActiveMembershipOfAccount[]>;
  /** Scoped by (account id, workspace id from the URL). */
  findForGuard(accountId: string, workspaceId: string): Promise<MembershipRecord | null>;
}

export interface InvitationRepo {
  insert(workspaceId: string, invitation: Omit<InvitationRecord, 'workspaceId'>): Promise<void>;
  /** Single-use consume: succeeds only while pending and unexpired. */
  consume(workspaceId: string, tokenHash: Buffer, now: Date): Promise<boolean>;
  supersedePending(workspaceId: string, email: string, now: Date): Promise<number>;
  listPending(workspaceId: string, now: Date, page: PageQuery): Promise<InvitationRecord[]>;
  findLatest(workspaceId: string): Promise<InvitationRecord | null>;
  /** Revokes while pending; false when it is not found in this workspace or not pending. */
  revoke(workspaceId: string, invitationId: string, now: Date): Promise<boolean>;

  // Controlled exception to the tenancy rule: scoped by possession of the secret link.
  findByTokenHash(tokenHash: Buffer): Promise<InvitationWithWorkspace | null>;
}

export interface WorkspaceRepos {
  workspaces: WorkspaceRepo;
  memberships: MembershipRepo;
  invitations: InvitationRepo;
}

/** Runs `fn` in one transaction; all repos handed to it share that transaction. */
export interface UnitOfWork {
  run<T>(fn: (repos: WorkspaceRepos) => Promise<T>): Promise<T>;
}
