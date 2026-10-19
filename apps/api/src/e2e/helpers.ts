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

/**
 * Integrity checks of operator-notifications (test-plan.md §6, SAD §7 run book). Ops queries, not
 * repository reads; each is scoped to one workspace and returns the offending ids.
 */
export const notificationIntegrity = {
  /** 1. Pings whose recipient's membership was not active at the ping's creation. */
  pingsToInactiveMembers: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('pings as p')
      .leftJoin('memberships as m', (j) =>
        j.onRef('m.account_id', '=', 'p.account_id').onRef('m.workspace_id', '=', 'p.workspace_id'),
      )
      .select('p.id')
      .where('p.workspace_id', '=', workspaceId)
      .where((eb) =>
        eb.or([
          eb('m.id', 'is', null),
          eb('p.created_at', '<', eb.ref('m.active_since')),
          eb.and([
            eb('m.state', '=', 'deactivated'),
            eb('m.deactivated_at', '<=', eb.ref('p.created_at')),
          ]),
        ]),
      )
      .execute(),

  /** 2. More than one ledger item per member, conversation and waiting period. */
  duplicateLedgerItems: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('ping_items')
      .select(['account_id', 'conversation_id', 'waiting_since'])
      .where('workspace_id', '=', workspaceId)
      .groupBy(['account_id', 'conversation_id', 'waiting_since'])
      .having((eb) => eb.fn.countAll(), '>', 1)
      .execute(),

  /** 3. Two pings to one member and workspace less than 10 minutes apart. */
  pingsTooClose: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('pings as a')
      .innerJoin('pings as b', (j) =>
        j
          .onRef('b.workspace_id', '=', 'a.workspace_id')
          .onRef('b.account_id', '=', 'a.account_id')
          .on(sql<boolean>`b.created_at > a.created_at`),
      )
      .select(['a.id as first', 'b.id as second'])
      .where('a.workspace_id', '=', workspaceId)
      .where(sql<boolean>`b.created_at - a.created_at < interval '10 minutes'`)
      .execute(),

  /** 4. Contacts whose Telegram id equals a live link's Telegram user id in the same workspace. */
  contactsOfLinkedMembers: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('contacts as c')
      .innerJoin('telegram_links as l', (j) =>
        j
          .onRef('l.workspace_id', '=', 'c.workspace_id')
          .onRef('l.telegram_user_id', '=', 'c.telegram_user_id'),
      )
      .select('c.id')
      .where('c.workspace_id', '=', workspaceId)
      .where('l.removed_at', 'is', null)
      .execute(),

  /** 5. Live links whose Telegram bot id differs from the workspace's current bot. */
  linksOfAnotherBot: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('telegram_links as l')
      .leftJoin('bots as b', 'b.workspace_id', 'l.workspace_id')
      .select('l.id')
      .where('l.workspace_id', '=', workspaceId)
      .where('l.removed_at', 'is', null)
      .where((eb) =>
        eb.or([eb('b.id', 'is', null), eb('b.telegram_bot_id', '!=', eb.ref('l.telegram_bot_id'))]),
      )
      .execute(),

  /** 6. Live links of a member whose membership is not active. */
  liveLinksOfInactiveMembers: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('telegram_links as l')
      .leftJoin('memberships as m', (j) =>
        j.onRef('m.account_id', '=', 'l.account_id').onRef('m.workspace_id', '=', 'l.workspace_id'),
      )
      .select('l.id')
      .where('l.workspace_id', '=', workspaceId)
      .where('l.removed_at', 'is', null)
      .where((eb) => eb.or([eb('m.id', 'is', null), eb('m.state', '!=', 'active')]))
      .execute(),

  /** 7. A link removed by its member that still holds a Telegram user id over an hour after removal. */
  memberRemovedLinksHoldingId: (db: Deps['db'], workspaceId: string, asOf: Date) =>
    db
      .selectFrom('telegram_links')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('removed_reason', '=', 'member')
      .where('telegram_user_id', 'is not', null)
      .where('removed_at', '<', new Date(asOf.getTime() - 3_600_000))
      .execute(),

  /** 8. Open conversations waiting by the shared-inbox marker but with no recorded waiting period. */
  waitingWithoutPeriod: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('status', '=', 'open')
      .where(
        sql<boolean>`(last_reply_sent_at is null or last_message_received_at > last_reply_sent_at)`,
      )
      .where('waiting_since', 'is', null)
      .execute(),
};

/** Every integrity query for each workspace: every list must be empty. `asOf` is the test clock's now. */
export async function integrityViolations(
  db: Deps['db'],
  workspaceIds: string[],
  asOf: Date = new Date(),
) {
  const found: { check: string; workspaceId: string; id: string }[] = [];
  const note = (check: string, workspaceId: string, rows: { id: string }[]) => {
    for (const row of rows) found.push({ check, workspaceId, id: row.id });
  };
  for (const workspaceId of workspaceIds) {
    note('assigned-to-non-member', workspaceId, await assignedToNonMembers(db, workspaceId));
    note('closed-with-later-arrival', workspaceId, await closedWithLaterArrival(db, workspaceId));
    const n = notificationIntegrity;
    note('pings-to-inactive-members', workspaceId, await n.pingsToInactiveMembers(db, workspaceId));
    note(
      'duplicate-ledger-items',
      workspaceId,
      (await n.duplicateLedgerItems(db, workspaceId)).map((r) => ({ id: r.conversation_id })),
    );
    note(
      'pings-less-than-10-min-apart',
      workspaceId,
      (await n.pingsTooClose(db, workspaceId)).map((r) => ({ id: r.second })),
    );
    note(
      'contacts-of-linked-members',
      workspaceId,
      await n.contactsOfLinkedMembers(db, workspaceId),
    );
    note('links-of-another-bot', workspaceId, await n.linksOfAnotherBot(db, workspaceId));
    note(
      'live-links-of-inactive-members',
      workspaceId,
      await n.liveLinksOfInactiveMembers(db, workspaceId),
    );
    note(
      'member-removed-links-holding-id',
      workspaceId,
      await n.memberRemovedLinksHoldingId(db, workspaceId, asOf),
    );
    note('waiting-without-period', workspaceId, await n.waitingWithoutPeriod(db, workspaceId));
  }
  return found;
}
