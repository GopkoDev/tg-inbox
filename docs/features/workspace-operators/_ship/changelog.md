# Changelog — workspace-operators

## workspace-operators — workspaces, operator accounts and business-owner team management

**What:** tg-inbox now has the idea of a business and a way to sign in to the web panel.

- A platform admin creates a workspace for a pilot business from the server-side admin CLI. The CLI also issues a single-use, 7-day invitation link for the business owner.
- People accept an invitation by setting a password (at least 10 characters), or by confirming the password of the account they already have, and land in that workspace.
- Business owners run their own team in the panel. They can invite operators or owners, revoke pending invitations, deactivate members, reactivate them and see the team list. A workspace always keeps at least one active owner.
- The panel's forms check passwords, names and emails with the same shared rules and messages as the server, before sending anything (AC-05b, added by [fix 2026-10-11](../_fixes/2026-10-11-shared-form-validation.md)).
- One account can belong to several workspaces and switch between them. A workspace's data is visible only to its active members: anyone else gets "not found", and a deactivated member gets "access removed".
- Sign-in uses email and password. The lockout (10 failures in 15 minutes) is identical for unknown and existing emails, so it does not reveal whether an account exists. A forgotten password is handled by an admin-issued, 24-hour, single-use reset link, which ends every other session of that account.

**Why:** Every later capability (bot connection, the shared inbox) belongs to one business and its team, and the platform previously had neither. This step is the root of the roadmap's dependency graph: see [spec](../spec.md) §1–§2. Key decisions:

- [ADR-0001](../adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md): an API, a SPA and a server-side admin CLI; there is no admin UI.
- [ADR-0002](../adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md): opaque cookie sessions stored in Postgres.
- [ADR-0003](../adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md): the active workspace travels in the URL, and membership is checked on every request. This is how a deactivation takes effect immediately.
- [ADR-0004](../adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md): the SPA and the API share one origin, with the API under `/api`.
- [ADR-0005](../adr/0005-split-identity-into-an-auth-module-and-a-workspaces-module.md): identity is split into an `auth` module and a `workspaces` module.

**How to use:** See [openapi.yaml](../contracts/openapi.yaml) for the full API.

```sh
# platform admin, on the server
pnpm admin workspace:create --name "Acme Flowers" --owner-email owner@acme.example
pnpm admin workspace:reissue-owner-invitation --workspace <workspace-id>
pnpm admin account:issue-reset-link --email person@acme.example
```

Each command prints the link once, to stdout, and writes an audit event to stderr. The owner opens the link (`/invite/<token>`), sets a password and then manages the team under *Team* in the panel. The HTTP surface:

- `POST /api/invitations/{lookup,accept}`
- `POST /api/auth/{sign-in,sign-out}`
- `POST /api/password-reset-links/{lookup,redeem}`
- `GET /api/me`, `GET /api/me/workspaces`
- `POST /api/workspaces/:id/enter`
- `GET|POST /api/workspaces/:id/{memberships,invitations}` and their `deactivate` / `reactivate` / `revoke` actions

**Operational notes:**

- **Migration:** adds seven migrations, from `1791681109972_create_accounts` to `1791681109978_create_invitations`. They create `accounts`, `sessions`, `sign_in_failures`, `password_reset_links`, `workspaces`, `memberships` and `invitations`. Run `pnpm db:migrate` on deploy, before the new API starts. Every migration has a working `down`.
- **Config:**
  - `PUBLIC_WEB_URL` is a **new required key** with no default. The API and the CLI refuse to start without it, because it is the base of the invitation and reset links. Existing `.env` files must add it.
  - `DATABASE_POOL_MAX` (default 10) and `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (default 5000) are new and optional.
  - `WEB_DIST_DIR` (optional) makes the API serve the built SPA from the same origin.
  - `VITE_API_URL` should now be empty: the panel calls relative `/api` paths.
- **Feature flag:** none.
- **Rollback:**
  1. Revert the deploy.
  2. Run `pnpm db:rollback` seven times, which drops the seven tables in reverse order.
  3. All accounts, workspaces and sessions created since the deploy are lost. There is no downstream data yet.

**Acceptance criteria delivered:**

| Area | Criteria |
|---|---|
| Workspace creation and owner invitation | AC-01, AC-01b, AC-02 |
| Accepting invitations | AC-03, AC-04, AC-04b, AC-05, AC-05b, AC-06 |
| Sign-in, lockout and sign-out | AC-07, AC-08, AC-09, AC-10, AC-11 |
| Workspace switching and isolation | AC-12, AC-13 |
| Team management | AC-14 to AC-20 |
| Password reset | AC-21, AC-22 |
