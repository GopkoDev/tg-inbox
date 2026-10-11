## Summary

This PR ships roadmap step 2, the root of the dependency graph.

- A platform admin creates each pilot workspace from the admin CLI, together with a single-use, 7-day invitation for the business owner.
- People accept invitations and sign in with email and password. One account can switch between several workspaces.
- Business owners run their own team: invite, revoke, deactivate and reactivate members. Every workspace's data stays isolated to its active members.

See the [spec](docs/features/workspace-operators/spec.md) and the [changelog](docs/features/workspace-operators/_ship/changelog.md).

## Acceptance criteria

- AC-01: the admin creates a workspace and gets an owner invitation link once ✓
- AC-01b: re-issuing the owner invitation supersedes the old link and starts a new 7-day one ✓
- AC-02: an empty name or invalid email creates nothing and names the field ✓
- AC-03: accepting an invitation as a new person creates the account and membership, signs them in and opens the workspace ✓
- AC-04: an existing account confirms its own password, and the new membership is added without touching the others ✓
- AC-04b: an invitation for another email is refused while signed in, with "sign out and reopen" guidance ✓
- AC-05: a password under 10 characters is refused ✓
- AC-05b: each form checks its fields with the server's shared rules and messages before sending (added by fix `2026-10-11-shared-form-validation`) ✓
- AC-06: an expired, used, revoked or replaced invitation is refused, with the right person to ask ✓
- AC-07: sign-in opens the last-used workspace, the only one, or a picker ✓
- AC-08: an unknown email and a wrong password get the same refusal ✓
- AC-09: 10 failures in 15 minutes lock the email for 15 minutes, identically for unknown emails ✓
- AC-10: an account with every membership deactivated sees the no-access screen ✓
- AC-11: sign-out ends the session on that device ✓
- AC-12: switching workspace is per device and is remembered for the next sign-in ✓
- AC-13: a non-member sees "not found" with no existence hints ✓
- AC-14: an owner invites an operator; the invitation is pending for 7 days, the link is shown once and older invitations for that email are superseded ✓
- AC-15: a non-owner cannot manage the team ✓
- AC-16: inviting an existing member is refused ✓
- AC-17: a deactivated member is refused within 5 seconds, moved out of the workspace and keeps their other workspaces ✓
- AC-18: the last active owner cannot be deactivated, including under concurrency ✓
- AC-19: reactivation restores the previous role ✓
- AC-20: the team list shows no links, and revoking an invitation kills its link ✓
- AC-21: an admin reset link sets a new password, ends other sessions and clears the lockout ✓
- AC-22: a reset link older than 24 hours or already used is refused ✓

## Design

- Spec: `docs/features/workspace-operators/spec.md` (with `ux-flows.md`, `screens.md` and `test-plan.md`)
- Architecture: `docs/features/workspace-operators/sad.md`
- Decisions: `docs/features/workspace-operators/adr/`, ADR-0001 to ADR-0005
- Data model and migrations: `docs/features/workspace-operators/data-model.md` (migrations `1791681109972` to `1791681109978`)
- API: `docs/features/workspace-operators/contracts/openapi.yaml`
- Review: `docs/features/workspace-operators/_review/`. Round 11 passed. Round 12 reviewed the post-ship fix and requested changes, fixed in `74bbeab`. Round 13 requested G1–G4, fixed in `e3e1510`; round 14 re-reviews it.
- Fix: `docs/features/workspace-operators/_fixes/2026-10-11-shared-form-validation.md` (adds AC-05b).

## Tasks (SDD-Task trailers)

<details><summary>66 task commits</summary>

- `179c9d0` feat(workspace-operators): Promote the seven staged migrations and regenerate DB types
- `9240b88` feat(workspace-operators): Add platform primitives: error classes and codes, clock port, link tokens, config keys
- `82171a6` feat(workspace-operators): Define the auth and workspaces zod contracts in packages/shared
- `1d57688` feat(workspace-operators): Implement the auth and workspaces domain rules
- `f00c686` feat(workspace-operators): Build the auth repositories and the argon2id password hasher
- `569b8b9` feat(workspace-operators): Build the workspaces repositories with cross-workspace isolation tests
- `ce2716d` feat(workspace-operators): Lay the web foundation: shadcn primitives, API client, shared guard handling, stores
- `4a32015` feat(workspace-operators): Implement the auth credential and session use cases
- `ba9d180` feat(workspace-operators): Implement create-workspace and re-issue-owner-invitation use cases
- `b8e621b` feat(workspace-operators): Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found
- `ebfcd5b` feat(workspace-operators): Implement the password-reset link use cases
- `3387bf5` feat(workspace-operators): Implement invitation lookup and acceptance
- `4644037` feat(workspace-operators): Implement workspace access: guard check, my workspaces, enter
- `db8bdfc` feat(workspace-operators): Implement the team use cases: invite, revoke, list, deactivate, reactivate
- `7fd4872` feat(workspace-operators): Build SCR-02 accept invitation and SCR-03 link unavailable
- `9dee125` feat(workspace-operators): Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher
- `8c5464e` test(workspace-operators): align T11/T12 unit-of-work fakes with the tx-passing run signature
- `9fb4c71` feat(workspace-operators): Expose the auth routes with the session cookie and resolver
- `3babc5d` feat(workspace-operators): Build SCR-09 set new password
- `8f49246` feat(workspace-operators): Build SCR-07 team screen
- `aea65b2` feat(workspace-operators): Expose the workspace guard and the me / workspaces / enter routes
- `38de9ef` feat(workspace-operators): Build SCR-08 invite member dialog
- `37616a8` feat(workspace-operators): Expose the invitation lookup and acceptance routes
- `5a319c2` feat(workspace-operators): Expose the owner-only team routes
- `f2359ca` feat(workspace-operators): Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs
- `4ed562b` feat(workspace-operators): Build the admin CLI with its three commands
- `b6b9ec7` feat(workspace-operators): Add API-level end-to-end flows for every user story
- `651b296` feat(workspace-operators): Add the six browser end-to-end flows and their CI step
- `a401957` fix(workspace-operators): build the e2e SPA with an empty VITE_API_URL; align .env.example
- `65f355b` fix(workspace-operators): Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice
- `7b3c418` feat(workspace-operators): Shape route validation errors as the contract's field details and accept only JSON on mutating routes
- `49f55b5` feat(workspace-operators): Route the CLI audit through the platform logger, fix the admin script, update the architecture map
- `b99fb4d` feat(workspace-operators): Make the sign-in lockout atomic per email and use the contract's credential message
- `b8c2498` feat(workspace-operators): Align team-route ids, statuses and error messages with the contract
- `a52342e` feat(workspace-operators): Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors
- `a442bf6` feat(workspace-operators): Make concurrent invitation acceptance refuse cleanly instead of failing with 500
- `3a97336` feat(workspace-operators): Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in
- `e4e9341` feat(workspace-operators): Send malformed token links to SCR-03 and align screen copy with the manifest
- `73fa14d` feat(workspace-operators): Exercise last-used workspace and direct Team loads in the browser flows
- `244822e` fix(workspace-operators): End the previous session on reset-link redeem, pin the response schemas with a test, fix the auth map row
- `32ec5c2` feat(workspace-operators): Render page bodies only after the shell entered the workspace; fit SCR-10 inside the shell
- `54ee750` feat(workspace-operators): Bring SCR-02 and SCR-03 copy to the manifest and fix the AC-03 accept test
- `160a0e3` feat(workspace-operators): Keep argon2 out of the sign-in lock transaction and bound the pg pool
- `3ff05a1` feat(workspace-operators): Keep Fastify's own 4xx statuses, refuse untyped bodies, document 415 in the contract
- `d27d3c5` feat(workspace-operators): Let the loser of a same-email acceptance race continue through the existing-account path
- `f0e59e5` feat(workspace-operators): Make Docker-backed tests remove their containers and data, even on failure
- `7e62d0a` feat(workspace-operators): Show role labels, not raw role values, in the picker, switcher and Team; reconcile the manifest
- `3100eee` feat(workspace-operators): Give every framework 4xx a contract code (413 included) and pin the untyped-body hook branch
- `d9459e0` fix(workspace-operators): Remove test containers on every failure path and drop the named-volume loop from the clean script
- `a1be79e` feat(workspace-operators): Show the shell's error row with Retry when the access-removed resolution fails; fix stale SCR-10 comments
- `69228a7` fix(workspace-operators): Keep the workspace name in the access-removed notice after Retry; ignore late failures from a left page
- `703194e` test(workspace-operators): Pin every role label on Team; realign the SCR-04/SCR-07 wireframes
- `4089256` docs(workspace-operators): Declare the malformed-body 400 on the body-less POST operations
- `df55116` fix(workspace-operators): Retry a failed container removal and keep both errors when stop fails twice
- `b17bd3e` fix(workspace-operators): key access-removed notice by workspace, ignore refusals from left pages
- `716d5c0` fix(workspace-operators): route router-level framework errors through the error envelope
- `a02bf61` fix(workspace-operators): scope the shell guard to a shared address workspace
- `18fb2f1` fix(workspace-operators): mask link tokens in request logs and URL errors
- `2d44879` test(workspace-operators): pin the address-workspace reset and owner-only release
- `9ad8366` docs(workspace-operators): flag LOG_LEVEL=trace raw-request logging, fix the req serializer comment
- `b9617de` test(workspace-operators): pin the shell's address release when leaving for a page without a shell
- `728778d` fix(workspace-operators): redact raw request packets and mask non-canonical link paths in logs
- `8bf92ea` fix(workspace-operators): mask link tokens by a normalised path, not a pattern
- `f84f655` fix(workspace-operators): mask link tokens in absolute-form and walk-back urls
- `ba55715` fix(workspace-operators): mask backslash link forms; state which forms no router resolves
- `f37cbae` fix(workspace-operators): mask encoded-backslash link forms

</details>

Fix commits (`SDD-Fix: 2026-10-11-shared-form-validation`):

- `61ec6be` fix: workspace-operators web forms validate with the shared zod schemas
- `74bbeab` fix: workspace-operators make AC-05b hold on every form and endpoint
- `e3e1510` fix: workspace-operators existing-account password on accept is bound-only

## Verification

All checks ran on Node 26.11.1. The live run below was at `d36f22b`; tests and lint were re-run at `e3e1510`.

- **Tests:** `pnpm test` passed: 70 files and 545/545 tests across api, shared and web, including the Testcontainers integration suites.
- **Lint and types:** `pnpm lint` (eslint, prettier and tsc for api, web and e2e) is clean.
- **Live run:** I ran the API (`src/main.ts`) against a throwaway Postgres 16 with all 8 migrations applied, and drove it with the admin CLI and curl. What I observed:
  - AC-01: `workspace:create` printed the invite link once. AC-02: a bad `--owner-email` gave exit 2 with `VALIDATION_ERROR` naming the field.
  - AC-01b: `workspace:reissue-owner-invitation` issued a new 7-day owner invitation. That the old link stops working is covered by `admin.int.test.ts`; I did not re-observe it live.
  - AC-05: a short password returned 400 with `details.field=password`. AC-03: accept returned 200 with the workspace and the owner role.
  - AC-06: reusing the same link returned 404 `INVITATION_INVALID`.
  - AC-14: an owner invited an operator and got 201 with the link once. AC-16: inviting the owner's own email returned 409 `ALREADY_A_MEMBER`.
  - AC-08: a wrong password and an unknown email both returned an identical 401 `INVALID_CREDENTIALS`.
  - AC-13: Acme's owner probing Bolt's id and a random id got an identical 404. AC-15: an operator inviting got 403 `OWNER_ONLY`.
  - AC-04 and AC-04b:
    - Anonymous lookup returned `account_exists:true`.
    - A different signed-in account got 403 `INVITATION_FOR_ANOTHER_EMAIL` on both lookup and accept.
    - Accepting with the existing password added Bolt; `/me/workspaces` then listed both workspaces.
  - AC-12: `enter` Bolt set `last_used_workspace_id` to Bolt.
  - AC-18: the last owner deactivating themselves got 409 `LAST_ACTIVE_OWNER`.
  - AC-17: after the operator was deactivated in Acme, Acme returned 403 `ACCESS_REMOVED` while Bolt still returned 200. AC-19: reactivation restored the operator role and Acme returned 200.
  - AC-20: the pending list carried no link. After revoke the list was empty and the link lookup returned 404.
  - AC-09: after 10 failures the correct password got 429 `TOO_MANY_ATTEMPTS`, and the same happened for an email with no account.
  - AC-21: redeeming the reset link returned 204. The old session then got 401, and signing in with the new password worked despite the earlier lockout. AC-22: reusing the link returned 404 `RESET_LINK_INVALID`.
  - AC-11: sign-out returned 204, and `/me` then returned 401.
- **Not re-run live:**
  - The panel-side outcomes: the AC-07 workspace picker, the AC-10 no-access screen and the AC-17 on-screen move. They are covered by the web Testing Library suites and by `apps/web/e2e/flows.spec.ts` (Playwright).
  - The 24-hour and 7-day expiry clocks, which are covered with a fake clock in unit tests.

## Operational notes

- **Migration:** run `pnpm db:migrate` on deploy, before the API starts. It adds 7 reversible migrations. To roll back, run `pnpm db:rollback` seven times and revert the deploy.
- **Config:**
  - **`PUBLIC_WEB_URL` is a new required key.** The API and the CLI exit at startup without it. Add it to every environment's `.env`.
  - `DATABASE_POOL_MAX` and `DATABASE_POOL_CONNECTION_TIMEOUT_MS` are optional.
  - `WEB_DIST_DIR` is optional and makes the API serve the SPA from the same origin.
  - `VITE_API_URL` should now be empty.
- **Feature flag:** none.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
