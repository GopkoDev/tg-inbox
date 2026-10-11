import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps, type Deps } from '../deps.js';
import { insertAccount } from '../test/fixtures/auth.js';
import { insertMembership } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { runAdmin } from './run.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const logs: Record<string, unknown>[] = [];
  return {
    out,
    err,
    logs,
    io: {
      stdout: { write: (s: string) => out.push(s) },
      stderr: { write: (s: string) => err.push(s) },
      logger: { info: (fields: Record<string, unknown>) => logs.push(fields) },
    },
  };
}

const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);

describe('admin CLI (postgres)', () => {
  let database: TestDatabase;
  let deps: Deps;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url));
  });

  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  async function run(...argv: string[]) {
    const c = capture();
    const code = await runAdmin(deps, argv, c.io);
    return { code, ...c };
  }

  async function createWorkspace(name = 'Acme Flowers', email = 'owner@example.test') {
    const r = await run('workspace:create', '--name', name, '--owner-email', email);
    const id = /Created workspace (\S+) /.exec(r.err.join(''))?.[1] ?? '';
    return { ...r, id };
  }

  it('AC-01: creates a workspace with a pending owner invitation, link once on stdout', async () => {
    const r = await createWorkspace('  Acme Flowers ', '  Owner@Example.TEST ');
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(/^http:\/\/localhost:5173\/invite\/[^/\s]+\n$/);
    expect(r.err.join('')).toContain('invitation for owner@example.test expires');
    const ws = await deps.db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', r.id)
      .executeTakeFirstOrThrow();
    expect(ws.name).toBe('Acme Flowers');
    const members = await deps.db
      .selectFrom('memberships')
      .selectAll()
      .where('workspace_id', '=', r.id)
      .execute();
    expect(members).toHaveLength(0);
    const inv = await deps.db
      .selectFrom('invitations')
      .selectAll()
      .where('workspace_id', '=', r.id)
      .execute();
    expect(inv).toMatchObject([{ email: 'owner@example.test', role: 'owner', state: 'pending' }]);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toMatchObject({
      event: 'admin.workspace_created',
      workspace_id: r.id,
      invitation_id: inv[0]!.id,
    });
    expect(r.logs[0]!.os_user).toEqual(expect.any(String));
    expect(JSON.stringify(r.logs)).not.toContain(tokenOf(r.out[0]!.trim()));
    expect(JSON.stringify(r.logs)).not.toContain('/invite/');
  });

  it('AC-02: invalid name or email exits 2, names the field, creates nothing', async () => {
    const before = await deps.db.selectFrom('workspaces').select('id').execute();
    const a = await run('workspace:create', '--name', '   ', '--owner-email', 'a@b.test');
    expect(a.code).toBe(2);
    expect(a.err.join('')).toContain('error VALIDATION_ERROR: --name must be 1–200 characters');
    const b = await run('workspace:create', '--name', 'X'.repeat(201), '--owner-email', 'a@b.test');
    expect(b.code).toBe(2);
    const c = await run('workspace:create', '--name', 'X', '--owner-email', 'nope');
    expect(c.code).toBe(2);
    expect(c.err.join('')).toContain(
      'error VALIDATION_ERROR: --owner-email is not a valid email address',
    );
    for (const r of [a, b, c]) {
      expect(r.out).toEqual([]);
      expect(r.logs).toEqual([]);
    }
    expect(await deps.db.selectFrom('workspaces').select('id').execute()).toHaveLength(
      before.length,
    );
  });

  it('usage errors: unknown command and missing flag exit 2', async () => {
    const a = await run('nope');
    expect(a.code).toBe(2);
    expect(a.err.join('')).toContain('error VALIDATION_ERROR');
    const b = await run('workspace:create', '--name', 'X');
    expect(b.code).toBe(2);
    expect(b.out).toEqual([]);
  });

  it('AC-01b: re-issue supersedes the old link; 3 for unknown, 2 for non-uuid, 4 once a member exists', async () => {
    const created = await createWorkspace('Reissue Co', 'reissue@example.test');
    const oldLink = created.out[0]!.trim();
    const r = await run('workspace:reissue-owner-invitation', '--workspace', created.id);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    const newLink = r.out[0]!.trim();
    expect(newLink).not.toBe(oldLink);
    expect(r.err.join('')).toContain('for reissue@example.test');
    const invs = await deps.db
      .selectFrom('invitations')
      .select(['id', 'state'])
      .where('workspace_id', '=', created.id)
      .execute();
    expect(invs.map((i) => i.state).sort()).toEqual(['pending', 'superseded']);
    await expect(deps.acceptInvitation.lookUpInvitation(tokenOf(oldLink))).rejects.toMatchObject({
      code: 'INVITATION_INVALID',
    });
    await expect(deps.acceptInvitation.lookUpInvitation(tokenOf(newLink))).resolves.toBeDefined();
    expect(r.logs[0]).toMatchObject({
      event: 'admin.owner_invitation_reissued',
      workspace_id: created.id,
    });
    expect(r.logs[0]!.superseded_invitation_id).toEqual(expect.any(String));
    expect(JSON.stringify(r.logs)).not.toContain(tokenOf(newLink));

    const unknown = await run(
      'workspace:reissue-owner-invitation',
      '--workspace',
      '01920000-0000-7000-8000-0000000000ff',
    );
    expect(unknown.code).toBe(3);
    expect(unknown.err.join('')).toContain('error NOT_FOUND: no workspace with id ');
    const bad = await run('workspace:reissue-owner-invitation', '--workspace', 'abc');
    expect(bad.code).toBe(2);
    expect(bad.err.join('')).toContain('--workspace must be a workspace id');

    await insertMembership(deps.db, created.id, { role: 'owner' });
    const joined = await run('workspace:reissue-owner-invitation', '--workspace', created.id);
    expect(joined.code).toBe(4);
    expect(joined.err.join('')).toContain('error OWNER_ALREADY_JOINED');
    expect(joined.out).toEqual([]);
    expect(joined.logs).toEqual([]);
  });

  it('AC-21: issues a reset link, supersedes the earlier one; 3 for unknown email, 2 for bad email', async () => {
    await insertAccount(deps.db, { email: 'forgot@example.test' });
    const first = await run('account:issue-reset-link', '--email', ' Forgot@Example.test ');
    expect(first.code).toBe(0);
    expect(first.out[0]).toMatch(/^http:\/\/localhost:5173\/reset-password\/[^/\s]+\n$/);
    const second = await run('account:issue-reset-link', '--email', 'forgot@example.test');
    expect(second.code).toBe(0);
    await expect(
      deps.resetLinkUseCases.lookUpResetLink(tokenOf(first.out[0]!.trim())),
    ).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });
    await expect(
      deps.resetLinkUseCases.lookUpResetLink(tokenOf(second.out[0]!.trim())),
    ).resolves.toBeUndefined();
    expect(first.logs[0]).toMatchObject({ event: 'admin.reset_link_issued' });
    expect(first.logs[0]!.account_id).toEqual(expect.any(String));
    expect(first.logs[0]!.reset_link_id).toEqual(expect.any(String));
    expect(JSON.stringify(first.logs)).not.toContain(tokenOf(first.out[0]!.trim()));

    const unknown = await run('account:issue-reset-link', '--email', 'ghost@example.test');
    expect(unknown.code).toBe(3);
    expect(unknown.err.join('')).toContain('error NOT_FOUND: no account with that email');
    const bad = await run('account:issue-reset-link', '--email', 'x');
    expect(bad.code).toBe(2);
    expect(bad.out).toEqual([]);
  });

  it('exits 1 with INTERNAL_ERROR and empty stdout on an unexpected failure', async () => {
    const c = capture();
    const broken = {
      workspaceAdmin: {
        createWorkspaceWithOwnerInvitation: () => Promise.reject(new Error('db down')),
      },
    } as unknown as Deps;
    const code = await runAdmin(
      broken,
      ['workspace:create', '--name', 'X', '--owner-email', 'a@b.test'],
      c.io,
    );
    expect(code).toBe(1);
    expect(c.out).toEqual([]);
    expect(c.err.join('')).toContain('error INTERNAL_ERROR');
    expect(c.logs).toEqual([]);
  });
});
