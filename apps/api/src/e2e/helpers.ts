import type { FastifyInstance, InjectOptions } from 'fastify';
import { expect } from 'vitest';
import { sql } from 'kysely';
import type { Deps } from '../deps.js';
import { runAdmin } from '../cli/run.js';
import { SESSION_COOKIE } from '../platform/session-cookie.js';
import type { FakeTelegram } from '../test/fake-telegram.js';

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
  await sql`TRUNCATE messages, conversations, contacts, bots, invitations, memberships, sessions, password_reset_links, sign_in_failures, workspaces, accounts RESTART IDENTITY CASCADE`.execute(
    db,
  );
}

/** A bot's webhook as Telegram knows it: read from the fake's last recorded `setWebhook` call. */
export interface RegisteredWebhook {
  /** The bot row id at the end of the webhook URL. */
  id: string;
  url: string;
  secret: string;
}

export function registeredWebhook(fake: FakeTelegram, token: string): RegisteredWebhook {
  const set = fake
    .calls(token)
    .filter((c) => c.method === 'setWebhook')
    .at(-1);
  expect(set, 'setWebhook was called for this token').toBeDefined();
  const url = String(set!.params.url);
  return { id: url.slice(url.lastIndexOf('/') + 1), url, secret: String(set!.params.secret_token) };
}

/**
 * One cron tick of the health check, inline (no pg-boss, no sleeping): the bots due now under the
 * deps' clock are each checked once — what `bots.schedule-health-checks` + `bots.check-health` do.
 */
export async function runHealthTick(deps: Deps): Promise<number> {
  const due = await deps.bots.healthCheck.scheduleChecks();
  for (const { workspaceId, botId } of due) {
    await deps.bots.healthCheck.checkOne(workspaceId, botId);
  }
  return due.length;
}
