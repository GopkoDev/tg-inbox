import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
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

  async request(
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ): Promise<LightMyRequestResponse> {
    const options: InjectOptions = { method, url, cookies: { ...this.cookies } };
    if (payload) options.payload = payload;
    const res = await this.app.inject(options);
    for (const c of res.cookies) {
      if (c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }

  get(url: string): Promise<LightMyRequestResponse> {
    return this.request('GET', url);
  }

  post(url: string, payload?: object): Promise<LightMyRequestResponse> {
    return this.request('POST', url, payload);
  }

  signIn(email: string, password = PASSWORD): Promise<LightMyRequestResponse> {
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

/**
 * Integrity queries of contacts (sad.md §7, run book). Ops queries, not repository reads; each is
 * scoped to one workspace and returns the offending ids.
 */
export const contactIntegrity = {
  /** 1. Two tags of a workspace with the same name key (the unique index forbids it). */
  duplicateTagKeys: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('tags')
      .select('name_key')
      .where('workspace_id', '=', workspaceId)
      .groupBy('name_key')
      .having((eb) => eb.fn.countAll(), '>', 1)
      .execute(),

  /** 2. A workspace over 100 tags. */
  tagsOverLimit: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('tags')
      .select('workspace_id as id')
      .where('workspace_id', '=', workspaceId)
      .groupBy('workspace_id')
      .having((eb) => eb.fn.countAll(), '>', 100)
      .execute(),

  /** 2b. A contact over 20 tags. */
  contactsOverTagLimit: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('contact_tags')
      .select('contact_id as id')
      .where('workspace_id', '=', workspaceId)
      .groupBy('contact_id')
      .having((eb) => eb.fn.countAll(), '>', 20)
      .execute(),

  /** 3. Links whose tag or contact belongs to another workspace (the composite FKs forbid it). */
  linksAcrossWorkspaces: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('contact_tags as l')
      .leftJoin('tags as t', 't.id', 'l.tag_id')
      .leftJoin('contacts as c', 'c.id', 'l.contact_id')
      .select('l.tag_id as id')
      .where('l.workspace_id', '=', workspaceId)
      .where((eb) =>
        eb.or([
          eb('t.workspace_id', 'is distinct from', workspaceId),
          eb('c.workspace_id', 'is distinct from', workspaceId),
        ]),
      )
      .execute(),

  /**
   * 4. Links with no history entry on that contact that is `added` with the link's tag id or
   * `merged` into it (matched on ids, so renames and re-pointed merges never trip it).
   */
  linksWithoutHistory: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('contact_tags as l')
      .select('l.tag_id as id')
      .where('l.workspace_id', '=', workspaceId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('contact_tag_history as h')
              .select('h.id')
              .whereRef('h.workspace_id', '=', 'l.workspace_id')
              .whereRef('h.contact_id', '=', 'l.contact_id')
              .where((eb) =>
                eb.or([
                  eb.and([eb('h.kind', '=', 'added'), eb('h.tag_id', '=', eb.ref('l.tag_id'))]),
                  eb.and([
                    eb('h.kind', '=', 'merged'),
                    eb('h.merged_into_tag_id', '=', eb.ref('l.tag_id')),
                  ]),
                ]),
              ),
          ),
        ),
      )
      .execute(),
};

/** A recipient's id carries its creation time (UUIDv7, ms); the launch makes them right after `launched_at`. */
const RECIPIENT_CREATED_AT = sql<Date>`to_timestamp(('x' || substr(replace(r.id::text, '-', ''), 1, 12))::bit(48)::bigint / 1000.0)`;
/** Slack for the launch's own work between `launched_at` and the ids it mints (a bulk insert, ms). */
const LAUNCH_SLACK = sql`interval '1 second'`;

/**
 * Integrity queries of broadcasts (sad.md §8 run book, test-plan §NFR checks, data-model audit).
 * Ops queries, not repository reads; each is scoped to one workspace and returns offending ids.
 */
export const broadcastIntegrity = {
  /** 1. Recipients still `sending` while no `broadcasts.send` link of their workspace is queued or running. */
  sendingWithoutLink: async (db: Deps['db'], workspaceId: string) => {
    const { rows } = await sql<{
      queue: string | null;
    }>`select to_regclass('pgboss.job')::text as queue`.execute(db);
    const linkAlive =
      rows[0]?.queue == null
        ? sql<boolean>`false`
        : sql<boolean>`exists (select 1 from pgboss.job j
            where j.name = 'broadcasts.send' and j.singleton_key = r.workspace_id::text
              and j.state in ('created', 'retry', 'active'))`;
    return db
      .selectFrom('broadcast_recipients as r')
      .select('r.id')
      .where('r.workspace_id', '=', workspaceId)
      .where('r.state', '=', 'sending')
      .where(sql<boolean>`not ${linkAlive}`)
      .execute();
  },

  /** 2. Recipients with more than one broadcast item (the unique key forbids it; a smoke check). */
  recipientsWithTwoItems: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcast_recipients as r')
      .innerJoin('conversations as c', (j) =>
        j.onRef('c.workspace_id', '=', 'r.workspace_id').onRef('c.contact_id', '=', 'r.contact_id'),
      )
      .innerJoin('broadcast_items as i', (j) =>
        j
          .onRef('i.workspace_id', '=', 'r.workspace_id')
          .onRef('i.broadcast_id', '=', 'r.broadcast_id')
          .onRef('i.conversation_id', '=', 'c.id'),
      )
      .select('r.id')
      .where('r.workspace_id', '=', workspaceId)
      .groupBy('r.id')
      .having((eb) => eb.fn.countAll(), '>', 1)
      .execute(),

  /** 3. Launched broadcasts holding a recipient created after the launch (by the id's time). */
  recipientsAfterLaunch: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcast_recipients as r')
      .innerJoin('broadcasts as b', (j) =>
        j.onRef('b.workspace_id', '=', 'r.workspace_id').onRef('b.id', '=', 'r.broadcast_id'),
      )
      .select('b.id')
      .distinct()
      .where('r.workspace_id', '=', workspaceId)
      .where(sql<boolean>`${RECIPIENT_CREATED_AT} > b.launched_at + ${LAUNCH_SLACK}`)
      .execute(),

  /** 4. More than 10 launches of the workspace in any 24 hours (returns the 11th launch onwards). */
  launchesOverCap: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcasts as b')
      .select('b.id')
      .where('b.workspace_id', '=', workspaceId)
      .where('b.launched_at', 'is not', null)
      .where(
        sql<boolean>`(select count(*) from broadcasts o
          where o.workspace_id = b.workspace_id and o.launched_at is not null
            and o.launched_at > b.launched_at - interval '24 hours'
            and o.launched_at <= b.launched_at) > 10`,
      )
      .execute(),

  /** 5. Launched broadcasts whose frozen `recipient_count` differs from their recipient rows. */
  recipientCountMismatch: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcasts as b')
      .select('b.id')
      .where('b.workspace_id', '=', workspaceId)
      .where('b.status', '!=', 'draft')
      .where(
        sql<boolean>`b.recipient_count is distinct from (select count(*)::int from broadcast_recipients r
          where r.workspace_id = b.workspace_id and r.broadcast_id = b.id)`,
      )
      .execute(),

  /** 6. Recipients or group rows whose contact belongs to another workspace (the composite keys forbid it). */
  contactsAcrossWorkspaces: async (db: Deps['db'], workspaceId: string) => [
    ...(await db
      .selectFrom('broadcast_recipients as r')
      .leftJoin('contacts as c', 'c.id', 'r.contact_id')
      .select('r.id')
      .where('r.workspace_id', '=', workspaceId)
      .where('c.workspace_id', 'is distinct from', workspaceId)
      .execute()),
    ...(await db
      .selectFrom('broadcast_group_contacts as g')
      .leftJoin('contacts as c', 'c.id', 'g.contact_id')
      .select('g.contact_id as id')
      .where('g.workspace_id', '=', workspaceId)
      .where('c.workspace_id', 'is distinct from', workspaceId)
      .execute()),
  ],

  /**
   * 7. Delivered or not confirmed recipients with no broadcast item of their broadcast on their
   * contact's conversation (joined through `conversations_contact_id_key`).
   */
  outcomesWithoutItem: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcast_recipients as r')
      .select('r.id')
      .where('r.workspace_id', '=', workspaceId)
      .where('r.state', 'in', ['delivered', 'not_confirmed'])
      .where(
        sql<boolean>`not exists (select 1 from conversations c
          join broadcast_items i on i.workspace_id = c.workspace_id and i.conversation_id = c.id
          where c.workspace_id = r.workspace_id and c.contact_id = r.contact_id
            and i.broadcast_id = r.broadcast_id)`,
      )
      .execute(),

  /**
   * 8. Broadcast items that do not match their recipient's outcome: no recipient, or one that is
   * not delivered / not confirmed, or in the other of the two states (AC-16).
   */
  itemsWithoutOutcome: (db: Deps['db'], workspaceId: string) =>
    db
      .selectFrom('broadcast_items as i')
      .innerJoin('conversations as c', (j) =>
        j.onRef('c.workspace_id', '=', 'i.workspace_id').onRef('c.id', '=', 'i.conversation_id'),
      )
      .leftJoin('broadcast_recipients as r', (j) =>
        j
          .onRef('r.workspace_id', '=', 'i.workspace_id')
          .onRef('r.broadcast_id', '=', 'i.broadcast_id')
          .onRef('r.contact_id', '=', 'c.contact_id'),
      )
      .select('i.id')
      .where('i.workspace_id', '=', workspaceId)
      .where('r.state', 'is distinct from', sql<string>`i.state`)
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
    const c = contactIntegrity;
    note(
      'duplicate-tag-keys',
      workspaceId,
      (await c.duplicateTagKeys(db, workspaceId)).map((r) => ({ id: r.name_key })),
    );
    note('tags-over-limit', workspaceId, await c.tagsOverLimit(db, workspaceId));
    note('contacts-over-tag-limit', workspaceId, await c.contactsOverTagLimit(db, workspaceId));
    note('links-across-workspaces', workspaceId, await c.linksAcrossWorkspaces(db, workspaceId));
    note('links-without-history', workspaceId, await c.linksWithoutHistory(db, workspaceId));
    const b = broadcastIntegrity;
    note(
      'broadcast-sending-without-link',
      workspaceId,
      await b.sendingWithoutLink(db, workspaceId),
    );
    note(
      'broadcast-recipient-with-two-items',
      workspaceId,
      await b.recipientsWithTwoItems(db, workspaceId),
    );
    note(
      'broadcast-recipients-after-launch',
      workspaceId,
      await b.recipientsAfterLaunch(db, workspaceId),
    );
    note('broadcast-launches-over-cap', workspaceId, await b.launchesOverCap(db, workspaceId));
    note(
      'broadcast-recipient-count-mismatch',
      workspaceId,
      await b.recipientCountMismatch(db, workspaceId),
    );
    note(
      'broadcast-contacts-across-workspaces',
      workspaceId,
      await b.contactsAcrossWorkspaces(db, workspaceId),
    );
    note(
      'broadcast-outcomes-without-item',
      workspaceId,
      await b.outcomesWithoutItem(db, workspaceId),
    );
    note(
      'broadcast-items-without-outcome',
      workspaceId,
      await b.itemsWithoutOutcome(db, workspaceId),
    );
  }
  return found;
}
