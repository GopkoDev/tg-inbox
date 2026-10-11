import { test as base, expect } from '@playwright/test';
import { buildApp } from '../../../api/src/app.ts';
import { buildDeps, type Deps } from '../../../api/src/deps.ts';
import { Device, PASSWORD, runCli, tokenOf, truncateAll } from '../../../api/src/e2e/helpers.ts';
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
}

interface Backend {
  cli: Deps;
  app: Awaited<ReturnType<typeof buildApp>>;
}

export const test = base.extend<{ world: World }, { backend: Backend }>({
  backend: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const config = e2eConfig(process.env.E2E_DATABASE_URL!, Number(process.env.E2E_PORT));
      const cli = buildDeps(config);
      const app = await buildApp({ ...config, WEB_DIST_DIR: undefined });
      await use({ cli, app });
      await app.close();
      await cli.destroy();
    },
    { scope: 'worker' },
  ],
  world: async ({ backend }, use) => {
    await truncateAll(backend.cli.db); // reset before each flow
    const { cli, app } = backend;
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
    };
    await use(world);
  },
});
