import { userInfo } from 'node:os';
import { ErrorCode } from '@tg/shared';
import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import type { Config } from '../platform/config.js';
import { loggerOptions } from '../platform/logger.js';
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

/**
 * Audit logger on the platform pino options (level, redaction), writing JSON lines to `destination`
 * (stderr in the CLI). The dev pretty-print transport is dropped: it cannot be combined with a stream.
 */
export function createAuditLogger(config: Config, destination: DestinationStream): AuditLogger {
  const options: LoggerOptions & { transport?: unknown } = {
    ...(loggerOptions(config) as LoggerOptions),
  };
  delete options.transport;
  return pino(options, destination);
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
