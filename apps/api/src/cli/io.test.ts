import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Config } from '../platform/config.js';
import { audit, createAuditLogger, type CliIo } from './io.js';

const config: Config = {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  DATABASE_POOL_MAX: 10,
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: 5000,
  PUBLIC_WEB_URL: 'http://localhost:5173',
};

function sink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, stream };
}

describe('CLI audit logger', () => {
  it('writes a pino JSON line with the audit fields and no link or token', () => {
    const { lines, stream } = sink();
    const io: CliIo = {
      stdout: { write: () => true },
      stderr: { write: () => true },
      logger: createAuditLogger(config, stream),
    };
    audit(io, 'workspace.create', { workspace_id: 'w1', invitation_id: 'i1' });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 30,
      event: 'admin.workspace.create',
      msg: 'admin.workspace.create',
      workspace_id: 'w1',
      invitation_id: 'i1',
    });
    expect(typeof line.os_user).toBe('string');
    expect(typeof line.time).toBe('number');
    expect(lines[0]).not.toMatch(/https?:\/\/|\/invite\/|token/i);
  });

  it('applies the platform redaction rules and level', () => {
    const { lines, stream } = sink();
    const quiet = createAuditLogger({ ...config, LOG_LEVEL: 'warn' }, stream);
    quiet.info({ event: 'x' }, 'x');
    expect(lines).toHaveLength(0);
    const verbose = createAuditLogger(config, stream);
    verbose.info({ event: 'y', ctx: { token: 'secret-token' } }, 'y');
    expect(lines.join('')).not.toContain('secret-token');
  });
});
