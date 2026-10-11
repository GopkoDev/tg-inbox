import { EmailInput, WorkspaceName } from '@tg/shared';
import type { Deps } from '../../deps.js';
import { ValidationError } from '../../platform/errors.js';
import { audit, requireFlag, runCommand, type CliIo } from '../io.js';

export function workspaceCreate(
  deps: Pick<Deps, 'workspaceAdmin'>,
  flags: Record<string, string>,
  io: CliIo,
): Promise<number> {
  return runCommand(io, async () => {
    const name = WorkspaceName.safeParse(requireFlag(flags, 'name'));
    if (!name.success) throw new ValidationError('--name must be 1–200 characters');
    const email = EmailInput.safeParse(requireFlag(flags, 'owner-email'));
    if (!email.success) throw new ValidationError('--owner-email is not a valid email address');
    const created = await deps.workspaceAdmin.createWorkspaceWithOwnerInvitation({
      name: name.data,
      ownerEmail: email.data,
    });
    audit(io, 'workspace_created', {
      workspace_id: created.workspaceId,
      invitation_id: created.invitationId,
    });
    return {
      link: created.link,
      summary: `Created workspace ${created.workspaceId} "${name.data}"; invitation for ${created.email} expires ${created.expiresAt.toISOString()}`,
    };
  });
}
