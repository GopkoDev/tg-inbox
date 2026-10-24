import { test as base, expect } from '@playwright/test';
import { buildApp } from '../../../api/src/app.ts';
import { buildDeps, type Deps } from '../../../api/src/deps.ts';
import {
  Device,
  PASSWORD,
  runCli,
  runHealthTick,
  tokenOf,
  truncateAll,
} from '../../../api/src/e2e/helpers.ts';
import {
  connectFakeTelegram,
  type BotScript,
  type FakeTelegramClient,
} from '../../../api/src/test/fake-telegram.ts';
import { fakeBotToken } from '../../../api/src/test/fixtures/bots.ts';
import {
  signedDelivery,
  telegramMyChatMember,
  telegramUpdate,
} from '../../../api/src/test/fixtures/telegram.ts';
import { e2eConfig } from './config.ts';

export { expect, PASSWORD };

/** Seeding handle: the admin CLI functions and the HTTP API in-process — never the UI under test. */
export interface World {
  /** Creates a workspace and joins its first owner over HTTP; returns the workspace id. */
  workspaceWithOwner(name: string, email: string, displayName?: string): Promise<string>;
  /** An owner-issued invitation link (the link the panel shows once). */
  invite(
    ownerEmail: string,
    workspaceId: string,
    email: string,
    role?: 'owner' | 'operator',
  ): Promise<string>;
  /** Invites and joins a member over HTTP (operator unless `role` says owner); `displayName` is omitted for an existing account. */
  joinOperator(
    ownerEmail: string,
    workspaceId: string,
    email: string,
    displayName?: string,
    role?: 'owner' | 'operator',
  ): Promise<void>;
  /** A visibly fake bot token; pass the same `telegramBotId` for a new token of the same bot. */
  botToken(telegramBotId?: bigint): string;
  /** Scripts the fake Bot API for a token (identity, webhook URL, failures). */
  scriptBot(token: string, script: BotScript): Promise<void>;
  /** A customer's private message posted to the bot's webhook with the secret Telegram was given. */
  customerWrites(token: string, fromId: number, text: string, firstName?: string): Promise<number>;
  /** An owner connects the workspace's bot over HTTP (the inbox flows start from a connected bot). */
  connectBot(ownerEmail: string, workspaceId: string, token: string): Promise<void>;
  /** An owner deactivates the member with this email over HTTP. */
  deactivate(ownerEmail: string, workspaceId: string, memberEmail: string): Promise<void>;
  /** The `sendMessage` calls the fake Bot API has received for a token. */
  sentMessages(token: string): Promise<Record<string, unknown>[]>;
  /** A teammate acts on a conversation (found by its customer's first name) over HTTP, as the member `actor`; `assignee` is a display name. */
  assign(actor: string, workspaceId: string, customer: string, assignee: string): Promise<void>;
  unassign(actor: string, workspaceId: string, customer: string): Promise<void>;
  /** Closes with the confirmation acknowledged (an early close is the point of the seeding, not of the flow). */
  close(actor: string, workspaceId: string, customer: string): Promise<void>;
  /** The id of the conversation of a customer (found by first name) as seen by the member `actor`. */
  conversationId(actor: string, workspaceId: string, customer: string): Promise<string>;
  /** One health-check tick through the app layer, as if run once the bots are due (not waited for). */
  healthTick(): Promise<void>;
  /** `count` customers write one message each, in order (`<prefix>01`, `<prefix>02`, …, ids from `fromId`). */
  customersWrite(token: string, count: number, fromId: number, prefix: string): Promise<void>;
  /** The id of the contact (found by exact first name) as seen by the member `actor`. */
  contactId(actor: string, workspaceId: string, firstName: string): Promise<string>;
  /** `actor` puts the tag `name` (created when new) on a contact found by first name; returns the tag id. */
  tagContact(actor: string, workspaceId: string, firstName: string, name: string): Promise<string>;
  /** An owner deletes a tag over HTTP, confirming its current count. */
  deleteTag(ownerEmail: string, workspaceId: string, tagId: string): Promise<void>;
  /**
   * A private `my_chat_member` update posted to the bot's webhook as Telegram: `kicked` = the
   * customer blocked the bot, `member` = unblocked it (each newer than the last).
   */
  customerBlocksBot(token: string, fromId: number, status?: 'kicked' | 'member'): Promise<void>;
  /**
   * `actor` creates a broadcast draft over HTTP; with `audience`, saves its tag audience ("any of"
   * `tagIds`, leaving out `excludeTagIds`). Returns the broadcast id.
   */
  draftBroadcast(
    actor: string,
    workspaceId: string,
    name: string,
    text: string,
    audience?: { tagIds: string[]; excludeTagIds?: string[] },
  ): Promise<string>;
}

interface Backend {
  cli: Deps;
  /** The same dependencies under a clock that runs ahead, so every tick finds the bots due. */
  ahead: Deps;
  /** Moves `ahead`'s clock on by one tick step. */
  advance: () => void;
  app: Awaited<ReturnType<typeof buildApp>>;
  fake: FakeTelegramClient;
}

const TICK_STEP_MS = 10 * 60_000;

export const test = base.extend<{ world: World }, { backend: Backend }>({
  backend: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const apiRoot = process.env.E2E_TELEGRAM_API_ROOT!;
      const config = e2eConfig(
        process.env.E2E_DATABASE_URL!,
        Number(process.env.E2E_PORT),
        apiRoot,
      );
      const cli = buildDeps(config);
      let offset = 0;
      const ahead = buildDeps(config, { clock: { now: () => new Date(Date.now() + offset) } });
      const advance = () => {
        offset += TICK_STEP_MS;
      };
      const app = await buildApp({ ...config, WEB_DIST_DIR: undefined });
      await use({ cli, ahead, advance, app, fake: connectFakeTelegram(apiRoot) });
      await app.close();
      await ahead.destroy();
      await cli.destroy();
    },
    { scope: 'worker' },
  ],
  world: async ({ backend }, use) => {
    await truncateAll(backend.cli.db); // reset before each flow
    await backend.fake.reset(); // with the fake Bot API's scripts and calls
    const { cli, ahead, advance, app, fake } = backend;
    let nextBot = 600_000n;
    let nextUpdate = 1;
    let lastBlockDate = 0;
    const messageIds = new Map<number, number>();
    const owners = new Map<string, Device>();
    const members = new Map<string, Device>();

    const deviceOf = async (email: string) => {
      const known = members.get(email) ?? owners.get(email);
      if (known) return known;
      const device = new Device(app);
      const res = await device.signIn(email);
      if (res.statusCode >= 300) throw new Error(`sign-in of ${email} failed: ${res.body}`);
      members.set(email, device);
      return device;
    };
    const stateChange = async (
      actor: string,
      workspaceId: string,
      customer: string,
      path: 'assign' | 'unassign' | 'close',
      assignee?: string,
    ) => {
      const device = await deviceOf(actor);
      const base = `/api/workspaces/${workspaceId}/inbox`;
      let found: { id: string; state_version: number; close_snapshot?: unknown } | undefined;
      for (const status of ['open', 'closed']) {
        const page = await device.get(`${base}/conversations?status=${status}&limit=30`);
        const hit = (page.json().items as { id: string; contact: { first_name: string } }[]).find(
          (c) => c.contact.first_name === customer,
        );
        if (hit) {
          const summary = await device.get(`${base}/conversations/${hit.id}`);
          found = summary.json();
          break;
        }
      }
      if (!found) throw new Error(`no conversation of ${customer}`);
      const body: Record<string, unknown> = { expected_state_version: found.state_version };
      if (path === 'assign') {
        const team = await device.get(`${base}/members`);
        const who = (team.json().items as { account_id: string; display_name: string }[]).find(
          (m) => m.display_name === assignee,
        );
        if (!who) throw new Error(`no active member ${assignee}`);
        body.assignee_account_id = who.account_id;
      }
      if (path === 'close') {
        body.expected_close_snapshot = found.close_snapshot;
        body.confirm_close_reasons = true;
      }
      const res = await device.post(`${base}/conversations/${found.id}/${path}`, body);
      if (res.statusCode !== 200) throw new Error(`${path} failed: ${res.statusCode} ${res.body}`);
    };

    const world: World = {
      async workspaceWithOwner(name, email, displayName = 'Owner') {
        const created = await runCli(
          cli,
          'workspace:create',
          '--name',
          name,
          '--owner-email',
          email,
        );
        if (created.code !== 0) throw new Error(`workspace:create failed: ${created.stderr}`);
        const device = new Device(app);
        const res = await device.post('/api/invitations/accept', {
          token: tokenOf(created.link!),
          password: PASSWORD,
          display_name: displayName,
        });
        if (res.statusCode !== 200) throw new Error(`owner accept failed: ${res.body}`);
        owners.set(email, device);
        return created.workspaceId!;
      },
      async invite(ownerEmail, workspaceId, email, role = 'operator') {
        const device = owners.get(ownerEmail);
        if (!device) throw new Error(`no seeded owner ${ownerEmail}`);
        const res = await device.post(`/api/workspaces/${workspaceId}/invitations`, {
          email,
          role,
        });
        if (res.statusCode !== 201) throw new Error(`invite failed: ${res.statusCode} ${res.body}`);
        return res.json().link as string;
      },
      async joinOperator(ownerEmail, workspaceId, email, displayName, role) {
        const link = await world.invite(ownerEmail, workspaceId, email, role);
        const res = await new Device(app).post('/api/invitations/accept', {
          token: tokenOf(link),
          password: PASSWORD,
          ...(displayName && { display_name: displayName }),
        });
        if (res.statusCode !== 200) throw new Error(`operator accept failed: ${res.body}`);
      },
      botToken(telegramBotId = nextBot++) {
        return fakeBotToken(telegramBotId);
      },
      scriptBot(token, script) {
        return fake.script(token, script);
      },
      async connectBot(ownerEmail, workspaceId, token) {
        const device = owners.get(ownerEmail);
        if (!device) throw new Error(`no seeded owner ${ownerEmail}`);
        const res = await device.post(`/api/workspaces/${workspaceId}/bot/token`, { token });
        if (res.statusCode !== 200) throw new Error(`connect bot failed: ${res.body}`);
      },
      async deactivate(ownerEmail, workspaceId, memberEmail) {
        const device = owners.get(ownerEmail);
        if (!device) throw new Error(`no seeded owner ${ownerEmail}`);
        const list = await device.get(`/api/workspaces/${workspaceId}/memberships`);
        const found = (list.json().items as { id: string; email: string }[]).find(
          (m) => m.email === memberEmail,
        );
        if (!found) throw new Error(`no member ${memberEmail}`);
        const res = await device.post(
          `/api/workspaces/${workspaceId}/memberships/${found.id}/deactivate`,
        );
        if (res.statusCode !== 200) throw new Error(`deactivate failed: ${res.body}`);
      },
      async sentMessages(token) {
        return (await fake.calls(token))
          .filter((c) => c.method === 'sendMessage')
          .map((c) => c.params);
      },
      async customerWrites(token, fromId, text, firstName) {
        const set = (await fake.calls(token)).filter((c) => c.method === 'setWebhook').at(-1);
        if (!set) throw new Error('the bot has no webhook registered');
        const url = String(set.params.url);
        const messageId = (messageIds.get(fromId) ?? 0) + 1;
        messageIds.set(fromId, messageId);
        const res = await signedDelivery(
          app,
          { id: url.slice(url.lastIndexOf('/') + 1), secret: String(set.params.secret_token) },
          telegramUpdate({
            updateId: nextUpdate++,
            messageId,
            date: Math.floor(Date.now() / 1000),
            fromId,
            text,
            ...(firstName && { from: { first_name: firstName } }),
          }),
        );
        return res.statusCode;
      },
      assign: (actor, workspaceId, customer, assignee) =>
        stateChange(actor, workspaceId, customer, 'assign', assignee),
      unassign: (actor, workspaceId, customer) =>
        stateChange(actor, workspaceId, customer, 'unassign'),
      close: (actor, workspaceId, customer) => stateChange(actor, workspaceId, customer, 'close'),
      async conversationId(actor, workspaceId, customer) {
        const device = await deviceOf(actor);
        const page = await device.get(
          `/api/workspaces/${workspaceId}/inbox/conversations?status=open&limit=30`,
        );
        const hit = (page.json().items as { id: string; contact: { first_name: string } }[]).find(
          (c) => c.contact.first_name === customer,
        );
        if (!hit) throw new Error(`no open conversation of ${customer}`);
        return hit.id;
      },
      async healthTick() {
        advance();
        await runHealthTick(ahead);
      },
      async customersWrite(token, count, fromId, prefix) {
        for (let i = 1; i <= count; i++) {
          const name = `${prefix}${String(i).padStart(2, '0')}`;
          const status = await world.customerWrites(token, fromId + i, `Hello from ${name}`, name);
          if (status !== 200) throw new Error(`delivery for ${name} failed: ${status}`);
        }
      },
      async contactId(actor, workspaceId, firstName) {
        const device = await deviceOf(actor);
        const page = await device.get(
          `/api/workspaces/${workspaceId}/contacts?q=${encodeURIComponent(firstName)}`,
        );
        if (page.statusCode !== 200) throw new Error(`contacts read failed: ${page.body}`);
        const hit = (page.json().items as { id: string; first_name: string }[]).find(
          (c) => c.first_name === firstName,
        );
        if (!hit) throw new Error(`no contact ${firstName}`);
        return hit.id;
      },
      async tagContact(actor, workspaceId, firstName, name) {
        const device = await deviceOf(actor);
        const contactId = await world.contactId(actor, workspaceId, firstName);
        const res = await device.post(`/api/workspaces/${workspaceId}/contacts/${contactId}/tags`, {
          name,
          source: 'profile',
        });
        if (res.statusCode !== 200)
          throw new Error(`tagging failed: ${res.statusCode} ${res.body}`);
        return res.json().tag.id as string;
      },
      async deleteTag(ownerEmail, workspaceId, tagId) {
        const device = await deviceOf(ownerEmail);
        const list = await device.get(`/api/workspaces/${workspaceId}/tags`);
        const tag = (list.json().items as { id: string; contact_count: number }[]).find(
          (t) => t.id === tagId,
        );
        if (!tag) throw new Error(`no tag ${tagId}`);
        const res = await device.post(`/api/workspaces/${workspaceId}/tags/${tagId}/delete`, {
          expected_count: tag.contact_count,
        });
        if (res.statusCode !== 200) throw new Error(`delete failed: ${res.statusCode} ${res.body}`);
      },
      async customerBlocksBot(token, fromId, status = 'kicked') {
        const set = (await fake.calls(token)).filter((c) => c.method === 'setWebhook').at(-1);
        if (!set) throw new Error('the bot has no webhook registered');
        const url = String(set.params.url);
        // Unix seconds, strictly after the customer's last message and the previous change.
        lastBlockDate = Math.max(Math.floor(Date.now() / 1000) + 1, lastBlockDate + 1);
        const res = await signedDelivery(
          app,
          { id: url.slice(url.lastIndexOf('/') + 1), secret: String(set.params.secret_token) },
          telegramMyChatMember({ updateId: nextUpdate++, fromId, date: lastBlockDate, status }),
        );
        if (res.statusCode !== 200) throw new Error(`my_chat_member failed: ${res.statusCode}`);
      },
      async draftBroadcast(actor, workspaceId, name, text, audience) {
        const device = await deviceOf(actor);
        const base = `/api/workspaces/${workspaceId}/broadcasts`;
        const created = await device.post(base, { name, text });
        if (created.statusCode !== 201)
          throw new Error(`create draft failed: ${created.statusCode} ${created.body}`);
        const draft = created.json() as { id: string; version: number };
        if (audience) {
          const res = await device.post(`${base}/${draft.id}/audience`, {
            expected_version: draft.version,
            kind: 'tags',
            mode: 'any',
            tag_ids: audience.tagIds,
            exclude_tag_ids: audience.excludeTagIds ?? [],
          });
          if (res.statusCode !== 200)
            throw new Error(`save audience failed: ${res.statusCode} ${res.body}`);
        }
        return draft.id;
      },
    };
    await use(world);
  },
});
