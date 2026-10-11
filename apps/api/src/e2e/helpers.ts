import type { FastifyInstance, InjectOptions } from 'fastify';
import { sql } from 'kysely';
import type { Deps } from '../deps.js';
import { runAdmin } from '../cli/run.js';
import { SESSION_COOKIE } from '../platform/session-cookie.js';

export const PASSWORD = 'correct horse battery';

/** One "device": a cookie jar over `app.inject()`. */
export class Device {
  private cookies: Record<string, string> = {};

  constructor(private readonly app: FastifyInstance) {}

  get session(): string | undefined {
    return this.cookies[SESSION_COOKIE];
  }

  async request(method: 'GET' | 'POST', url: string, payload?: object) {
    const options: InjectOptions = { method, url, cookies: { ...this.cookies } };
    if (payload) options.payload = payload;
    const res = await this.app.inject(options);
    for (const c of res.cookies) {
      if (c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }

  get(url: string) {
    return this.request('GET', url);
  }

  post(url: string, payload?: object) {
    return this.request('POST', url, payload);
  }

  signIn(email: string, password = PASSWORD) {
    return this.post('/api/auth/sign-in', { email, password });
  }
}

export const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);

export interface CliRun {
  code: number;
  stdout: string[];
  stderr: string;
  /** The single link the command printed on stdout (undefined when it printed nothing). */
  link: string | undefined;
  /** Workspace id announced on stderr by `workspace:create`. */
  workspaceId: string | undefined;
}

/** Runs the admin CLI in-process, capturing stdout/stderr. Links come only from stdout. */
export async function runCli(deps: Deps, ...argv: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAdmin(deps, argv, {
    stdout: { write: (s) => stdout.push(s) },
    stderr: { write: (s) => stderr.push(s) },
    logger: { info: () => undefined },
  });
  const err = stderr.join('');
  return {
    code,
    stdout,
    stderr: err,
    link: stdout[0]?.trim(),
    workspaceId: /Created workspace (\S+) /.exec(err)?.[1],
  };
}

/** Wipes every table between flows (test-owned reset; never used to read links or tokens). */
export async function truncateAll(db: Deps['db']): Promise<void> {
  await sql`TRUNCATE invitations, memberships, sessions, password_reset_links, sign_in_failures, workspaces, accounts RESTART IDENTITY CASCADE`.execute(
    db,
  );
}
