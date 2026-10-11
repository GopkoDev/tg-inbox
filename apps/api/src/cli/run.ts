import { ErrorCode } from '@tg/shared';
import type { Deps } from '../deps.js';
import { accountIssueResetLink } from './commands/account-issue-reset-link.js';
import { workspaceCreate } from './commands/workspace-create.js';
import { workspaceReissueOwnerInvitation } from './commands/workspace-reissue-owner-invitation.js';
import { EXIT, type CliIo } from './io.js';

type CliDeps = Pick<Deps, 'workspaceAdmin' | 'resetLinkUseCases'>;
type Command = (deps: CliDeps, flags: Record<string, string>, io: CliIo) => Promise<number>;

export const COMMANDS: Record<string, Command> = {
  'workspace:create': workspaceCreate,
  'workspace:reissue-owner-invitation': workspaceReissueOwnerInvitation,
  'account:issue-reset-link': accountIssueResetLink,
};

/** Parses `--flag value` pairs; returns an error message for malformed input. */
export function parseFlags(args: string[]): Record<string, string> | string {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || key.length < 3) return `unexpected argument ${key ?? ''}`;
    if (value === undefined) return `${key} needs a value`;
    flags[key.slice(2)] = value;
  }
  return flags;
}

/** Dispatches `<command> [--flag value]…` and returns the process exit code. */
export async function runAdmin(deps: CliDeps, argv: string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    const known = Object.keys(COMMANDS).join(', ');
    io.stderr.write(
      `error ${ErrorCode.VALIDATION_ERROR}: unknown command ${name ?? '(none)'}; use one of ${known}\n`,
    );
    return EXIT.usage;
  }
  const flags = parseFlags(rest);
  if (typeof flags === 'string') {
    io.stderr.write(`error ${ErrorCode.VALIDATION_ERROR}: ${flags}\n`);
    return EXIT.usage;
  }
  return command(deps, flags, io);
}
