import { userInfo } from 'node:os';
import { ErrorCode } from '@tg/shared';
import {
  AppError,
  NotFoundError,
  OwnerAlreadyJoinedError,
  ValidationError,
} from '../platform/errors.js';

/** Minimal structured logger (pino-shaped call); the CLI writes JSON lines to stderr. */
export interface AuditLogger {
  info(fields: Record<string, unknown>, message?: string): void;
}

export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  logger: AuditLogger;
}

export const EXIT = { ok: 0, internal: 1, usage: 2, notFound: 3, refused: 4 } as const;

export function createStderrAuditLogger(stderr: CliIo['stderr']): AuditLogger {
  return {
    info(fields, message) {
      const line = { level: 30, time: Date.now(), ...fields, ...(message && { msg: message }) };
      stderr.write(`${JSON.stringify(line)}\n`);
    },
  };
}

function osUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

/** Audit line for a successful action. Callers pass ids only — never a link or token. */
export function audit(io: CliIo, action: string, ids: Record<string, unknown>): void {
  io.logger.info({ event: `admin.${action}`, os_user: osUser(), ...ids }, `admin.${action}`);
}

function fail(io: CliIo, exit: number, error: AppError): number {
  io.stderr.write(`error ${error.code}: ${error.message}\n`);
  return exit;
}

/** Runs a command body, printing its link on success and mapping failures to exit codes. */
export async function runCommand(
  io: CliIo,
  body: () => Promise<{ link: string; summary: string }>,
): Promise<number> {
  try {
    const { link, summary } = await body();
    io.stdout.write(`${link}\n`);
    io.stderr.write(`${summary}\n`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof ValidationError) return fail(io, EXIT.usage, error);
    if (error instanceof NotFoundError) return fail(io, EXIT.notFound, error);
    if (error instanceof OwnerAlreadyJoinedError) return fail(io, EXIT.refused, error);
    const message = error instanceof Error ? error.message : 'failed';
    io.stderr.write(`error ${ErrorCode.INTERNAL_ERROR}: ${message}\n`);
    return EXIT.internal;
  }
}

export function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined) throw new ValidationError(`--${name} is required`);
  return value;
}
