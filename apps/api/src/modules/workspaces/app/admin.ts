import type { z } from 'zod';
import { EmailInput, WorkspaceName } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  NotFoundError,
  OwnerAlreadyJoinedError,
  ValidationError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { issueLinkToken } from '../../../platform/tokens.js';
import { INVITATION_TTL } from '../domain/invitation.js';
import type { UnitOfWork, WorkspaceRepos } from './ports.js';

export interface WorkspaceAdminDeps {
  uow: UnitOfWork;
  clock: Clock;
  /** PUBLIC_WEB_URL from config, injected by the composition root. */
  publicWebUrl: string;
}

export interface OwnerInvitationIssued {
  invitationId: string;
  email: string;
  expiresAt: Date;
  /** Shown once to the platform admin; only its hash is stored. */
  link: string;
}

export interface WorkspaceCreated extends OwnerInvitationIssued {
  workspaceId: string;
}

export interface OwnerInvitationReissued extends OwnerInvitationIssued {
  supersededInvitationId: string | null;
}

function field<T>(schema: z.ZodType<T>, name: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? 'is invalid';
    throw new ValidationError(`${name}: ${reason}`, { field: name, reason });
  }
  return parsed.data;
}

export function createWorkspaceAdmin(deps: WorkspaceAdminDeps) {
  const { uow, clock } = deps;
  const base = deps.publicWebUrl.replace(/\/+$/, '');

  async function issueOwnerInvitation(
    repos: WorkspaceRepos,
    workspaceId: string,
    email: string,
    now: Date,
  ): Promise<OwnerInvitationIssued> {
    const { token, hash } = issueLinkToken();
    const invitationId = newId();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL);
    await repos.invitations.insert(workspaceId, {
      id: invitationId,
      email,
      role: 'owner',
      tokenHash: hash,
      state: 'pending',
      expiresAt,
      createdAt: now,
      closedAt: null,
    });
    return { invitationId, email, expiresAt, link: `${base}/invite/${token}` };
  }

  return {
    async createWorkspaceWithOwnerInvitation(input: {
      name: string;
      ownerEmail: string;
    }): Promise<WorkspaceCreated> {
      const name = field(WorkspaceName, 'name', input.name);
      const email = field(EmailInput, 'ownerEmail', input.ownerEmail);
      return uow.run(async (repos) => {
        const now = clock.now();
        const workspaceId = newId();
        await repos.workspaces.insert({ id: workspaceId, name, createdAt: now });
        const issued = await issueOwnerInvitation(repos, workspaceId, email, now);
        return { workspaceId, ...issued };
      });
    },

    async reissueOwnerInvitation(workspaceId: string): Promise<OwnerInvitationReissued> {
      return uow.run(async (repos) => {
        if (!(await repos.workspaces.lockForUpdate(workspaceId))) {
          throw new NotFoundError('Workspace not found');
        }
        if (await repos.memberships.hasAnyMember(workspaceId)) {
          throw new OwnerAlreadyJoinedError(
            'The first business owner already joined — business owners invite from the web panel',
          );
        }
        const latest = await repos.invitations.findLatest(workspaceId);
        if (!latest) throw new NotFoundError('Workspace has no owner invitation to re-issue');
        const now = clock.now();
        const supersededInvitationId = latest.state === 'pending' ? latest.id : null;
        await repos.invitations.supersedePending(workspaceId, latest.email, now);
        const issued = await issueOwnerInvitation(repos, workspaceId, latest.email, now);
        return { ...issued, supersededInvitationId };
      });
    },
  };
}
