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

/**
 * Integrity check (sad.md §7): conversations of the workspace assigned to an account that is not
 * an active member of it. An ops query, not a repository read; scoped to one workspace.
 */
export function assignedToNonMembers(db: Deps['db'], workspaceId: string) {
  return db
    .selectFrom('conversations as c')
    .leftJoin('memberships as m', (j) =>
      j
        .onRef('m.account_id', '=', 'c.assignee_account_id')
        .onRef('m.workspace_id', '=', 'c.workspace_id'),
    )
    .select('c.id')
    .where('c.workspace_id', '=', workspaceId)
    .where('c.assignee_account_id', 'is not', null)
    .where((eb) => eb.or([eb('m.id', 'is', null), eb('m.state', '!=', 'active')]))
    .execute();
}

/**
 * Integrity check (spec §6, lost customers): closed conversations of the workspace whose newest
 * customer arrival is later than their latest `closed` entry. Scoped to one workspace.
 */
export function closedWithLaterArrival(db: Deps['db'], workspaceId: string) {
  return db
    .selectFrom('conversations as c')
    .select('c.id')
    .where('c.workspace_id', '=', workspaceId)
    .where('c.status', '=', 'closed')
    .where(
      sql<boolean>`(select max(m.received_at) from messages m
          where m.conversation_id = c.id and m.workspace_id = c.workspace_id)
        > coalesce((select max(a.position_at) from conversation_activities a
          where a.conversation_id = c.id and a.workspace_id = c.workspace_id and a.kind = 'closed'),
          '-infinity'::timestamptz)`,
    )
    .execute();
}

/** Both integrity queries for each workspace: every list must be empty. */
export async function integrityViolations(db: Deps['db'], workspaceIds: string[]) {
  const found: { check: string; workspaceId: string; conversationId: string }[] = [];
  for (const workspaceId of workspaceIds) {
    for (const row of await assignedToNonMembers(db, workspaceId))
      found.push({ check: 'assigned-to-non-member', workspaceId, conversationId: row.id });
    for (const row of await closedWithLaterArrival(db, workspaceId))
      found.push({ check: 'closed-with-later-arrival', workspaceId, conversationId: row.id });
  }
  return found;
}
