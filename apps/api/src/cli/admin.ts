import pino from 'pino';
import { buildDeps } from '../deps.js';
import { loadConfig } from '../platform/config.js';
import { createAuditLogger, EXIT } from './io.js';
import { runAdmin } from './run.js';

let code: number = EXIT.internal;
try {
  const config = loadConfig();
  const io = {
    stdout: process.stdout,
    stderr: process.stderr,
    logger: createAuditLogger(config, pino.destination({ dest: 2, sync: true })),
  };
  const deps = buildDeps(config);
  try {
    code = await runAdmin(deps, process.argv.slice(2), io);
  } finally {
    await deps.destroy();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'failed';
  process.stderr.write(`error INTERNAL_ERROR: ${message}\n`);
}
process.exit(code);
