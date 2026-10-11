import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IssuedInvitation, PendingInvitationPage, WorkspaceSummaryPage } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { fixedClock, type FixedClock } from '../platform/clock.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { Device, PASSWORD, runCli, tokenOf, truncateAll } from './helpers.js';

const NEW_PASSWORD = 'a brand new password';

describe('API end-to-end flows (postgres)', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let cli: Deps;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await startTestDatabase();
    clock = fixedClock(new Date('2026-03-01T10:00:00Z'));
    const config = testConfig(database.url);
    cli = buildDeps(config, { clock });
    app = await buildApp(config, { clock });
  });
  afterAll(async () => {
    await app?.close();
    await cli?.destroy();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(cli.db);
  });

  const device = () => new Device(app);

  /** CLI create + HTTP accept as a brand-new owner; returns the workspace id and a signed-in device. */
  async function onboardOwner(name: string, email: string) {
    const created = await runCli(cli, 'workspace:create', '--name', name, '--owner-email', email);
    expect(created.code).toBe(0);
    const d = device();
    const accept = await d.post('/api/invitations/accept', {
      token: tokenOf(created.link!),
      password: PASSWORD,
      display_name: 'Owner',
    });
    expect(accept.statusCode).toBe(200);
    return { workspaceId: created.workspaceId!, device: d };
  }

  it('US-01 AC-01, AC-03: the printed link is the only way in; accept signs the owner in', async () => {
    const created = await runCli(
      cli,
      'workspace:create',
      '--name',
      'Acme Flowers',
      '--owner-email',
      'owner@example.test',
    );
    expect(created.code).toBe(0);
    expect(created.stdout).toHaveLength(1);
    const token = tokenOf(created.link!);

    const anonymous = device();
    expect((await anonymous.get('/api/me')).statusCode).toBe(401);
    const lookup = await anonymous.post('/api/invitations/lookup', { token });
    expect(lookup.json()).toEqual({
      workspace_name: 'Acme Flowers',
      email: 'owner@example.test',
      role: 'owner',
      account_exists: false,
    });
    const guessed = await anonymous.post('/api/invitations/lookup', { token: 'x'.repeat(43) });
    expect(guessed.json().error.code).toBe('INVITATION_INVALID');

    const accepted = await anonymous.post('/api/invitations/accept', {
      token,
      password: PASSWORD,
      display_name: 'Olga',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      id: created.workspaceId,
      name: 'Acme Flowers',
      role: 'owner',
    });
    expect(anonymous.session).toBeDefined();

    const me = await anonymous.get('/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().account).toMatchObject({ email: 'owner@example.test', display_name: 'Olga' });
    const list = WorkspaceSummaryPage.parse((await anonymous.get('/api/me/workspaces')).json());
    expect(list.items).toEqual([{ id: created.workspaceId, name: 'Acme Flowers', role: 'owner' }]);

    const again = await device().post('/api/invitations/accept', {
      token,
      password: PASSWORD,
      display_name: 'Olga',
    });
    expect(again.json().error.code).toBe('INVITATION_INVALID');
  });

  it('US-01 AC-01b: re-issue supersedes the old link; the new one works', async () => {
    const created = await runCli(
      cli,
      'workspace:create',
      '--name',
      'Reissue Co',
      '--owner-email',
      'owner@example.test',
    );
    const reissued = await runCli(
      cli,
      'workspace:reissue-owner-invitation',
      '--workspace',
      created.workspaceId!,
    );
    expect(reissued.code).toBe(0);
    expect(reissued.link).not.toBe(created.link);

    const d = device();
    const old = await d.post('/api/invitations/accept', {
      token: tokenOf(created.link!),
      password: PASSWORD,
      display_name: 'Olga',
    });
    expect(old.statusCode).toBe(404);
    expect(old.json().error.code).toBe('INVITATION_INVALID');
    expect(d.session).toBeUndefined();

    const fresh = await d.post('/api/invitations/accept', {
      token: tokenOf(reissued.link!),
      password: PASSWORD,
      display_name: 'Olga',
    });
    expect(fresh.statusCode).toBe(200);
    expect(d.session).toBeDefined();
  });

  it('US-02 AC-04: an existing account confirms its password to join a second workspace', async () => {
    const first = await onboardOwner('First Co', 'both@example.test');
    const second = await runCli(
      cli,
      'workspace:create',
      '--name',
      'Second Co',
      '--owner-email',
      'both@example.test',
    );
    const token = tokenOf(second.link!);
    const d = device();
    const lookup = await d.post('/api/invitations/lookup', { token });
    expect(lookup.json().account_exists).toBe(true);

    const wrong = await d.post('/api/invitations/accept', { token, password: 'not the password' });
    expect(wrong.statusCode).toBe(401);
    expect(d.session).toBeUndefined();

    const ok = await d.post('/api/invitations/accept', { token, password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    const list = WorkspaceSummaryPage.parse((await d.get('/api/me/workspaces')).json());
    expect(list.items.map((w) => w.id).sort()).toEqual(
      [first.workspaceId, second.workspaceId!].sort(),
    );
    expect(list.items.every((w) => w.role === 'owner')).toBe(true);
  });

  it('US-03/04 AC-07, AC-12: next sign-in opens the last workspace; other devices are untouched', async () => {
    const a = await onboardOwner('Alpha', 'multi@example.test');
    const secondLink = await runCli(
      cli,
      'workspace:create',
      '--name',
      'Beta',
      '--owner-email',
      'multi@example.test',
    );
    const joiner = device();
    const joined = await joiner.post('/api/invitations/accept', {
      token: tokenOf(secondLink.link!),
      password: PASSWORD,
    });
    expect(joined.statusCode).toBe(200);
    const b = secondLink.workspaceId!;

    const phone = device();
    const laptop = device();
    expect((await phone.signIn('multi@example.test')).statusCode).toBe(204);
    expect((await laptop.signIn('multi@example.test')).statusCode).toBe(204);
    expect((await phone.get('/api/me')).json().last_used_workspace_id).toBeNull();

    clock.advance(60_000);
    expect((await laptop.post(`/api/workspaces/${a.workspaceId}/enter`)).statusCode).toBe(200);
    clock.advance(60_000);
    const entered = await laptop.post(`/api/workspaces/${b}/enter`);
    expect(entered.json()).toEqual({ id: b, name: 'Beta', role: 'owner' });
    expect((await laptop.post('/api/auth/sign-out')).statusCode).toBe(204);
    expect((await laptop.get('/api/me')).statusCode).toBe(401);

    const fresh = device();
    await fresh.signIn('multi@example.test');
    expect((await fresh.get('/api/me')).json().last_used_workspace_id).toBe(b);

    // The phone never switched: still signed in, and free to open workspace A.
    expect((await phone.get('/api/me')).statusCode).toBe(200);
    expect((await phone.post(`/api/workspaces/${a.workspaceId}/enter`)).json().id).toBe(
      a.workspaceId,
    );
  });

  it('US-05/07 AC-14, AC-20: invite link is shown once; list has no link; revoked link is refused', async () => {
    const { workspaceId, device: owner } = await onboardOwner('Team Co', 'boss@example.test');
    const base = `/api/workspaces/${workspaceId}`;
    const invite = await owner.post(`${base}/invitations`, {
      email: 'hire@example.test',
      role: 'operator',
    });
    expect(invite.statusCode).toBe(201);
    const issued = IssuedInvitation.parse(invite.json());
    const token = tokenOf(issued.link);

    const listRes = await owner.get(`${base}/invitations`);
    const page = PendingInvitationPage.parse(listRes.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.email).toBe('hire@example.test');
    expect(listRes.body).not.toContain(token);
    expect(listRes.body).not.toContain('link');

    const revoke = await owner.post(`${base}/invitations/${page.items[0]!.id}/revoke`);
    expect(revoke.statusCode).toBe(204);
    const after = PendingInvitationPage.parse((await owner.get(`${base}/invitations`)).json());
    expect(after.items).toHaveLength(0);

    const hire = device();
    const refused = await hire.post('/api/invitations/accept', {
      token,
      password: PASSWORD,
      display_name: 'Hire',
    });
    expect(refused.json().error.code).toBe('INVITATION_INVALID');
    expect(hire.session).toBeUndefined();
  });

  it('US-06 AC-17: deactivation cuts every session from that workspace, not the other one', async () => {
    const shop = await onboardOwner('Shop', 'boss@example.test');
    const other = await onboardOwner('Other Shop', 'boss2@example.test');
    const base = `/api/workspaces/${shop.workspaceId}`;
    const otherBase = `/api/workspaces/${other.workspaceId}`;

    const invite = IssuedInvitation.parse(
      (
        await shop.device.post(`${base}/invitations`, {
          email: 'op@example.test',
          role: 'operator',
        })
      ).json(),
    );
    const first = device();
    const accepted = await first.post('/api/invitations/accept', {
      token: tokenOf(invite.link),
      password: PASSWORD,
      display_name: 'Op',
    });
    expect(accepted.statusCode).toBe(200);

    // The same person also works in the other business; that membership must survive.
    const invite2 = IssuedInvitation.parse(
      (
        await other.device.post(`${otherBase}/invitations`, {
          email: 'op@example.test',
          role: 'operator',
        })
      ).json(),
    );
    const joined = await first.post('/api/invitations/accept', {
      token: tokenOf(invite2.link),
      password: PASSWORD,
    });
    expect(joined.statusCode).toBe(200);
    const second = device();
    expect((await second.signIn('op@example.test')).statusCode).toBe(204);

    for (const d of [first, second]) {
      expect((await d.post(`${base}/enter`)).statusCode).toBe(200);
    }

    const members = (await shop.device.get(`${base}/memberships`)).json().items as {
      id: string;
      email: string;
    }[];
    const opMembership = members.find((m) => m.email === 'op@example.test')!;
    const off = await shop.device.post(`${base}/memberships/${opMembership.id}/deactivate`);
    expect(off.statusCode).toBe(200);

    for (const d of [first, second]) {
      const res = await d.post(`${base}/enter`);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ACCESS_REMOVED');
      expect((await d.post(`${otherBase}/enter`)).statusCode).toBe(200);
    }
  });

  it('US-08 AC-21: redeeming a reset link signs out other devices; the link is single-use', async () => {
    await onboardOwner('Reset Co', 'forgot@example.test');
    const deviceB = device();
    expect((await deviceB.signIn('forgot@example.test')).statusCode).toBe(204);
    expect((await deviceB.get('/api/me')).statusCode).toBe(200);

    const issued = await runCli(cli, 'account:issue-reset-link', '--email', 'forgot@example.test');
    expect(issued.code).toBe(0);
    const token = tokenOf(issued.link!);

    const deviceA = device();
    const lookup = await deviceA.post('/api/password-reset-links/lookup', { token });
    expect(lookup.statusCode).toBe(204);
    const redeem = await deviceA.post('/api/password-reset-links/redeem', {
      token,
      password: NEW_PASSWORD,
    });
    expect(redeem.statusCode).toBe(204);
    expect((await deviceA.get('/api/me')).statusCode).toBe(200);
    expect((await deviceB.get('/api/me')).statusCode).toBe(401);

    const fresh = device();
    expect((await fresh.signIn('forgot@example.test', PASSWORD)).statusCode).toBe(401);
    expect((await fresh.signIn('forgot@example.test', NEW_PASSWORD)).statusCode).toBe(204);

    const reuse = await device().post('/api/password-reset-links/redeem', {
      token,
      password: 'yet another password',
    });
    expect(reuse.json().error.code).toBe('RESET_LINK_INVALID');
  });
});
