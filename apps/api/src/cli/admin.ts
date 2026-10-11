import { buildDeps } from '../deps.js';
import { loadConfig } from '../platform/config.js';
import { createStderrAuditLogger, EXIT } from './io.js';
import { runAdmin } from './run.js';

const io = {
  stdout: process.stdout,
  stderr: process.stderr,
  logger: createStderrAuditLogger(process.stderr),
};

let code: number = EXIT.internal;
try {
  const deps = buildDeps(loadConfig());
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
