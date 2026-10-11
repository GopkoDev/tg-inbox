---
id: T18
title: "Build the admin CLI with its three commands"
layer: "ports"
deps: ["T8", "T9", "T17"]
blocks: []
acs: ["AC-01", "AC-01b", "AC-02", "AC-21"]
files_hint: ["apps/api/src/cli/", "apps/api/package.json", "package.json"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T18 — Build the admin CLI with its three commands

## Place in the sequence

- **Blocked by:** T8 — Implement the password-reset link use cases · T9 — Implement create-workspace and re-issue-owner-invitation use cases · T17 — Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs · **Blocks:** — · **Wave:** 9 — last; needs the shared dependency builder.
- **Lane:** shares `apps/api/package.json` with T5, T13, T17 — serialized.

## Why (user story)

> **As a** Platform admin
> **I want** to create a workspace for a pilot business together with an invitation for its first business owner
> **So that** the business can start using tg-inbox without a self-serve signup
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Platform admin
> **I want** to issue a password-reset link for an account on request
> **So that** a person who forgot their password regains access without a self-serve reset flow
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

This task is the platform admin's only channel: three commands over the same app layer, printing each link once.

## Inlined context

> The CLI (`pnpm admin <command>`, entry under `apps/api/src/cli/`) offers `workspace:create`, `workspace:reissue-owner-invitation` and `account:issue-reset-link`. It builds the same module dependencies as the HTTP app (a shared dependency builder used by both `buildApp()` and the CLI), calls the same app-layer use cases, prints the issued link exactly once to its own stdout, and writes one structured audit log line per action (`event: "admin.<action>"`, the operating-system user, target ids — never the link or its token).
>
> — `adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md §Decision outcome, verbatim` · full text: [ADR-0001](../adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md)

> - Entry: `apps/api/src/cli/admin.ts`. It reads the same configuration as the API (`DATABASE_URL`, `PUBLIC_WEB_URL`, …) through `platform/config.ts` and builds its dependencies with the shared dependency builder that `buildApp()` uses.
> - Flags are long-form only. Values with spaces must be quoted by the shell.
> - Validation is the same as the API's (`packages/shared` zod schemas): emails are trimmed and lower-cased, a workspace name is 1–200 characters after trimming.
>
> — `contracts/cli.md §Invocation, verbatim` · full text: [cli.md](../contracts/cli.md)

> **Config:** env vars are parsed only in `src/platform/config.ts`; document every key in `.env.example`. No `process.env` elsewhere.
>
> — `CLAUDE.md §Rules, Config, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [contracts/cli.md](../contracts/cli.md) ·
[adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

The CLI is this task's external surface (`pnpm admin <command> [--flag value]…`).

| Stream | Content |
|---|---|
| stdout | On success exactly one line, the link (`PUBLIC_WEB_URL/invite/<token>` or `PUBLIC_WEB_URL/reset-password/<token>`); nothing else ever |
| stderr | Success: one summary line; failure: `error <CODE>: <message>` with the API `ErrorCode` |
| audit log | One pino line per **successful** action: `event: "admin.<action>"`, `os_user`, target ids — never the link, token or password |

| Exit | Meaning | Code |
|---|---|---|
| `0` | Success, link printed | — |
| `1` | Unexpected failure, nothing on stdout | `INTERNAL_ERROR` |
| `2` | Usage / validation error, nothing created | `VALIDATION_ERROR` |
| `3` | Target not found | `NOT_FOUND` |
| `4` | Refused by a domain rule | `OWNER_ALREADY_JOINED` |

- `workspace:create --name "<name>" --owner-email <email>` → `0` + invite link; stderr `Created workspace <id> "<name>"; invitation for <email> expires <iso8601>`; name empty/>200 → `2` `--name must be 1–200 characters`; bad email → `2` `--owner-email is not a valid email address`. Audit `admin.workspace_created` (`workspace_id`, `invitation_id`).
- `workspace:reissue-owner-invitation --workspace <id>` → `0` + new invite link; not a UUID → `2`; no workspace → `3` `no workspace with id <id>`; already has members → `4` `the first business owner already joined — business owners invite from the web panel`. Audit `admin.owner_invitation_reissued` (`workspace_id`, `invitation_id`, `superseded_invitation_id`).
- `account:issue-reset-link --email <email>` → `0` + reset link; bad email → `2`; no account → `3` `no account with that email`. Audit `admin.reset_link_issued` (`account_id`, `reset_link_id`). Redemption is the API's `redeemPasswordResetLink` (T13).

— `contracts/cli.md §Output streams + §Exit codes + §Commands, abridged` · full text: [cli.md](../contracts/cli.md)

## Acceptance criteria

### AC-01 — happy path

> **Given** a platform admin and a pilot business named "Acme Flowers" together with its owner's email address
> **When** the platform admin creates the workspace with that name and owner email
> **Then** the workspace exists, awaiting its first business owner, with an invitation carrying the business owner role issued for that email, and the platform admin sees the invitation link once, right after creation, to pass on; until that invitation is accepted nobody can see or act in the workspace
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-01b — happy path

> **Given** a workspace still awaiting its first business owner, whose owner invitation has expired or whose link was lost
> **When** a platform admin re-issues the first business owner invitation for that workspace
> **Then** the earlier invitation stops working, a new 7-day invitation with the business owner role is issued for the same email, and the platform admin sees its link once, right after issuing it
>
> — `spec.md §5, AC-01b, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a platform admin creating a workspace
> **When** the workspace name is empty or the owner email is not a valid email address
> **Then** the system creates nothing and tells the platform admin which field is wrong and why
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/cli/admin.ts` — entry: `loadConfig()`, `buildDeps()` (T17), parse `<command>` + long flags, dispatch, map `AppError` codes to exit codes, always `destroy()` deps.
- [ ] `apps/api/src/cli/commands/workspace-create.ts`, `workspace-reissue-owner-invitation.ts`, `account-issue-reset-link.ts` — validate with the `packages/shared` schemas, call T9 / T8 use cases, print the link to stdout, summary to stderr, audit line via `platform/logger.ts` with `os_user` from `node:os`.
- [ ] Scripts: `"admin": "tsx src/cli/admin.ts"` in `apps/api/package.json`, `"admin": "pnpm --filter @tg/api admin"` in the root `package.json`.
- [ ] `apps/api/src/cli/admin.int.test.ts` — run the command function against Testcontainers with captured stdout/stderr/logger: AC-01 (one stdout line, workspace with no members, owner invitation pending), AC-02 (exit `2`, nothing created, field named), AC-01b (old link → invalid, new link valid, exit `4` once a member exists, `3` for an unknown id), AC-21 issue (link printed, earlier unused link superseded, `3` for unknown email); assert no audit line contains the token.

## Edge cases

| Case | Behaviour |
|---|---|
| Unknown command or missing flag | Exit `2`, `error VALIDATION_ERROR: …`, nothing created |
| Owner email with spaces / upper case | Normalised before storing |
| Database unreachable | Exit `1`, `INTERNAL_ERROR`, stdout empty |
| Re-issue for a workspace that already has members | Exit `4` `OWNER_ALREADY_JOINED` |
| Reset link for an unknown email | Exit `3` (allowed: only server operators see it) |
| Any failure | No audit line, nothing on stdout |

## Definition of Done

- [ ] `admin.int.test.ts` passes for AC-01, AC-01b, AC-02, AC-21 and every exit code in the table
- [ ] `pnpm admin workspace:create …` runs end to end against the local database
- [ ] No link or token is written to the audit log
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
