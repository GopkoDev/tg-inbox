import { EmailInput } from '@tg/shared';
import type { Deps } from '../../deps.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { audit, requireFlag, runCommand, type CliIo } from '../io.js';

export function accountIssueResetLink(
  deps: Pick<Deps, 'resetLinkUseCases'>,
  flags: Record<string, string>,
  io: CliIo,
): Promise<number> {
  return runCommand(io, async () => {
    const email = EmailInput.safeParse(requireFlag(flags, 'email'));
    if (!email.success) throw new ValidationError('--email is not a valid email address');
    let issued;
    try {
      issued = await deps.resetLinkUseCases.issueResetLink(email.data);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError('no account with that email');
      throw error;
    }
    audit(io, 'reset_link_issued', {
      account_id: issued.accountId,
      reset_link_id: issued.resetLinkId,
    });
    return {
      link: issued.link,
      summary: `Issued a reset link for account ${issued.accountId}; expires ${issued.expiresAt.toISOString()}`,
    };
  });
}
