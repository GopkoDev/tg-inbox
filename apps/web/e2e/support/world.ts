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
import { signedDelivery, telegramUpdate } from '../../../api/src/test/fixtures/telegram.ts';
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
  /** One health-check tick through the app layer, as if run once the bots are due (not waited for). */
  healthTick(): Promise<void>;
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
    const messageIds = new Map<number, number>();
    const owners = new Map<string, Device>();

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
      async healthTick() {
        advance();
        await runHealthTick(ahead);
      },
    };
    await use(world);
  },
});
