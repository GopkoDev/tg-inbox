---
id: T26
title: "Add API-level end-to-end flows for every user story"
layer: "ports"
deps: ["T18"]
blocks: ["T27"]
acs: ["AC-01", "AC-01b", "AC-03", "AC-04", "AC-07", "AC-12", "AC-14", "AC-17", "AC-20", "AC-21"]
files_hint: ["apps/api/src/e2e/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T26 — Add API-level end-to-end flows for every user story

## Place in the sequence

- **Blocked by:** T18 — Build the admin CLI (it needs every route and the CLI commands) · **Blocks:** T27 · **Wave:** after the backend is complete.
- **Lane:** touches only `apps/api/src/e2e/` — no shared file with any other task.

## Why

`test-plan.md` gives every critical user story an `e2e` row: one full flow through its real entry point, where each step uses only what an earlier step returned (the link printed by the CLI, the cookie set by sign-in). The per-route integration tests of T13–T18 prove each piece; these flows prove the pieces compose.

— `test-plan.md §Levels (E2E) + §AC coverage, abridged` · full text: [test-plan.md](../test-plan.md)

## Flows to write (one `*.int.test.ts` scenario each, ephemeral Postgres via `apps/api/src/test/postgres.ts`)

| Flow | Entry points | Asserts |
|---|---|---|
| US-01 create + accept first owner (AC-01, AC-03) | CLI `workspace:create` command function → HTTP invitation lookup + accept | the printed link is the only way in; after accept the owner is signed in and `GET /api/me` / workspaces list the new workspace |
| US-01 re-issue (AC-01b) | CLI create → CLI re-issue → HTTP accept with old link, then new link | old link refused as no longer valid; new link accepted |
| US-02 existing account joins (AC-04) | two workspaces via CLI; accept both invitations for one email | second acceptance asks for the existing password; both memberships active |
| US-03/04 sign in + switch (AC-07, AC-12) | sign in → enter workspace B → sign out → sign in again on a second "device" (separate cookie jar) | next sign-in opens B; the first device stays where it was |
| US-05/07 invite + team list + revoke (AC-14, AC-20) | owner invites → team list → revoke → accept with revoked link | link only in the create response; list never contains a link; revoked link refused |
| US-06 deactivate with two sessions (AC-17) | member signs in on two cookie jars → owner deactivates | next request from each jar to that workspace refused as access removed; member's other workspace still works |
| US-08 reset (AC-21) | CLI `account:issue-reset-link` → HTTP redeem on device A while device B is signed in | A signed in with the new password; B's session refused; link single-use |

## Checklist

- [ ] `apps/api/src/e2e/helpers.ts` — a tiny cookie-jar client over `app.inject()` and a helper that runs a CLI command function with captured stdout to extract the link.
- [ ] `apps/api/src/e2e/*.int.test.ts` — the seven flows above; truncate tables before each flow.
- [ ] No step reads the database directly to fetch a link or token — only CLI output and HTTP responses.

## Definition of Done

- [ ] All seven flows pass against ephemeral Postgres
- [ ] No link or token is read from the database by the tests
- [ ] lint + vet clean (`pnpm lint`)
