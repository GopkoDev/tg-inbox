import { DisplayName } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  AlreadyAMemberError,
  InvitationForAnotherEmailError,
  InvitationInvalidError,
  ValidationError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { hashToken } from '../../../platform/tokens.js';
import type { AccountUseCases } from '../../auth/app/accounts.js';
import type { CredentialUseCases } from '../../auth/app/credentials.js';
import type { SessionUseCases } from '../../auth/app/sessions.js';
import { askFor, invitationIsUsable } from '../domain/invitation.js';
import type { Role } from '../domain/membership.js';
import type { InvitationRepo, MembershipRepo, UnitOfWork } from './ports.js';

export interface AcceptInvitationDeps {
  uow: UnitOfWork;
  /** Non-transactional reads for the lookup (possession of the link is the scope). */
  invitations: Pick<InvitationRepo, 'findByTokenHash'>;
  memberships: Pick<MembershipRepo, 'hasAnyMember'>;
  accounts: Pick<
    AccountUseCases,
    'findAccountIdByEmail' | 'prepareAccount' | 'insertPreparedAccount'
  >;
  credentials: Pick<CredentialUseCases, 'verifyPassword'>;
  sessions: Pick<SessionUseCases, 'openSession'>;
  clock: Clock;
}

export interface SignedInAccount {
  id: string;
  email: string;
}

export interface InvitationView {
  workspaceName: string;
  email: string;
  role: Role;
  accountExists: boolean;
}

export interface InvitationAccepted {
  workspace: { id: string; name: string; role: Role };
  sessionToken: string;
}

function isEmailTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e.constraint === 'accounts_email_key';
}

/** Thrown inside the transaction (forcing a rollback) when another invitation created the account. */
class EmailTakenRace extends Error {}

const NO_LONGER_VALID = 'This invitation is no longer valid';

export function createAcceptInvitation(deps: AcceptInvitationDeps) {
  const { uow, invitations, memberships, accounts, credentials, sessions, clock } = deps;

  async function lookUp(token: string, signedIn?: SignedInAccount) {
    const invitation = await invitations.findByTokenHash(hashToken(token));
    if (!invitation) throw new InvitationInvalidError(NO_LONGER_VALID, 'business_owner');
    if (!invitationIsUsable(invitation, clock.now())) {
      const ask = askFor(await memberships.hasAnyMember(invitation.workspaceId));
      throw new InvitationInvalidError(NO_LONGER_VALID, ask);
    }
    if (signedIn && signedIn.email.trim().toLowerCase() !== invitation.email) {
      throw new InvitationForAnotherEmailError(
        'This invitation belongs to another email. Sign out and open the link again to accept it',
      );
    }
    const accountId = await accounts.findAccountIdByEmail(invitation.email);
    return { invitation, accountId };
  }

  return {
    async lookUpInvitation(token: string, signedIn?: SignedInAccount): Promise<InvitationView> {
      const { invitation, accountId } = await lookUp(token, signedIn);
      return {
        workspaceName: invitation.workspaceName,
        email: invitation.email,
        role: invitation.role,
        accountExists: accountId !== undefined,
      };
    },

    async acceptInvitation(
      input: { token: string; password: string; displayName?: string },
      signedIn?: SignedInAccount,
    ): Promise<InvitationAccepted> {
      const { invitation, accountId: existingId } = await lookUp(input.token, signedIn);

      let displayName = '';
      if (existingId === undefined) {
        const parsed = DisplayName.safeParse(input.displayName ?? '');
        if (!parsed.success) {
          const reason = parsed.error.issues[0]?.message ?? 'is invalid';
          throw new ValidationError(`display_name: ${reason}`, { field: 'display_name', reason });
        }
        displayName = parsed.data;
      }

      // New account: policy check + argon2 hash outside the transaction (nothing is written, and
      // the workspace row lock is not held while hashing).
      const prepared =
        existingId === undefined
          ? await accounts.prepareAccount({
              email: invitation.email,
              displayName,
              password: input.password,
            })
          : undefined;

      // Existing account: verified outside any transaction so a failure is committed on its own.
      const verifiedId =
        existingId === undefined
          ? undefined
          : await credentials.verifyPassword(invitation.email, input.password);

      const commit = (accountIdVerified: string | undefined) =>
        uow.run(async (repos, tx) => {
          const now = clock.now();
          await repos.workspaces.lockForUpdate(invitation.workspaceId);
          // Consume first: the loser of a race on the same invitation is refused before any insert.
          const consumed = await repos.invitations.consume(
            invitation.workspaceId,
            invitation.tokenHash,
            now,
          );
          if (!consumed) {
            const ask = askFor(await repos.memberships.hasAnyMember(invitation.workspaceId));
            throw new InvitationInvalidError(NO_LONGER_VALID, ask);
          }
          let accountId = accountIdVerified;
          if (accountId === undefined) {
            try {
              accountId = (await accounts.insertPreparedAccount(prepared!, tx)).id;
            } catch (err) {
              // Another invitation for the same new email won the race; roll back (this invitation
              // stays pending) and continue through the existing-account path outside the transaction.
              if (isEmailTaken(err)) throw new EmailTakenRace();
              throw err;
            }
          }
          const existing = await repos.memberships.findByAccount(invitation.workspaceId, accountId);
          if (existing) throw new AlreadyAMemberError('This person is already a member');
          await repos.memberships.insert(invitation.workspaceId, {
            id: newId(),
            accountId,
            role: invitation.role,
            state: 'active',
            lastUsedAt: null,
            deactivatedAt: null,
            createdAt: now,
          });
          const sessionToken = await sessions.openSession(accountId, tx);
          return {
            workspace: {
              id: invitation.workspaceId,
              name: invitation.workspaceName,
              role: invitation.role,
            },
            sessionToken,
          };
        });

      try {
        return await commit(verifiedId);
      } catch (err) {
        if (!(err instanceof EmailTakenRace)) throw err;
        const raced = await credentials.verifyPassword(invitation.email, input.password);
        return commit(raced);
      }
    },
  };
}
