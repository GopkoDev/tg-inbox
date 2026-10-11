import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { audit, requireFlag, runCommand, type CliIo } from '../io.js';

export function workspaceReissueOwnerInvitation(
  deps: Pick<Deps, 'workspaceAdmin'>,
  flags: Record<string, string>,
  io: CliIo,
): Promise<number> {
  return runCommand(io, async () => {
    const id = z.uuid().safeParse(requireFlag(flags, 'workspace'));
    if (!id.success) throw new ValidationError('--workspace must be a workspace id');
    const workspaceId = id.data;
    let issued;
    try {
      issued = await deps.workspaceAdmin.reissueOwnerInvitation(workspaceId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError(`no workspace with id ${workspaceId}`);
      }
      throw error;
    }
    audit(io, 'owner_invitation_reissued', {
      workspace_id: workspaceId,
      invitation_id: issued.invitationId,
      superseded_invitation_id: issued.supersededInvitationId,
    });
    return {
      link: issued.link,
      summary: `Re-issued the owner invitation of workspace ${workspaceId} for ${issued.email}; expires ${issued.expiresAt.toISOString()}`,
    };
  });
}
