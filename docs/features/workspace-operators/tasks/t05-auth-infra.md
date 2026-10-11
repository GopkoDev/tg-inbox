---
id: T5
title: "Build the auth repositories and the argon2id password hasher"
layer: "infra"
deps: ["T1", "T2", "T4"]
blocks: ["T7"]
acs: ["AC-08", "AC-09", "AC-21"]
files_hint: ["apps/api/src/modules/auth/app/ports.ts", "apps/api/src/modules/auth/infra/", "apps/api/src/test/fixtures.ts", "apps/api/package.json"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T5 — Build the auth repositories and the argon2id password hasher

## Place in the sequence

- **Blocked by:** T1 — Promote the seven staged migrations and regenerate DB types, T2 — Add platform primitives, T4 — Implement the auth and workspaces domain rules · **Blocks:** T7 — Implement the auth credential and session use cases · **Wave:** 2 — needs the tables, the `Clock` and the domain types.
- **Lane:** shares `apps/api/src/test/fixtures.ts` with T6 and `apps/api/package.json` with T13, T17, T18 — serialized with them.

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Platform admin
> **I want** to issue a password-reset link for an account on request
> **So that** a person who forgot their password regains access without a self-serve reset flow
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

This task gives `auth` its persistence — the port interfaces in `app/ports.ts` plus their Kysely implementations for accounts, sessions, sign-in failures and reset links — and the password hasher, so the use cases of T7/T8 have something to call.

## Inlined context

> `auth` | accounts, sessions, sign-in failures, password-reset links | Platform-level — no `workspace_id`; repositories are scoped by account or by normalised email
>
> — `sad.md §5, Table ownership, verbatim` · full text: [sad.md](../sad.md)

> argon2id in the self-describing PHC string format (parameters stored with the hash …); built-in `node:crypto` argon2, or `@node-rs/argon2` if the built-in is still experimental on Node 26; a sign-in for an unknown email still runs one hash verification so response time does not reveal whether an account exists
>
> — `sad.md §8, Password storage, abridged` · full text: [sad.md](../sad.md)

> every timestamp … comes from the application's clock port and is passed into SQL as `now` — no `DEFAULT now()`
>
> — `sad.md §8, Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

> **IDs:** UUIDv7 from `newId()` (`src/platform/ids.ts`), never DB defaults. · **DB:** one shared `Kysely<DB>` (`src/platform/db.ts`).
>
> — `CLAUDE.md §Rules, IDs + DB, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> `auth`'s app-layer functions accept an optional transaction handle from the caller, so `workspaces` runs the whole acceptance in one database transaction while each module still writes only its own tables.
>
> — `adr/0005 §Decision outcome, verbatim` · full text: [ADR-0005](../adr/0005-split-identity-into-an-auth-module-and-a-workspaces-module.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Read/write only (tables created by T1):

| Table | Columns used | Access pattern → index |
|---|---|---|
| `accounts` | `id`, `email` (normalised, UNIQUE), `display_name`, `password_hash`, `created_at` | find by email → `accounts_email_key`; by id(s) → PK; update `password_hash` (reset) |
| `sessions` | `id`, `account_id`, `token_hash` (32 B), `created_at`, `last_seen_at` | find / delete by token hash → `sessions_token_hash_key`; delete all of an account → `sessions_account_id_idx`; touch `last_seen_at` |
| `sign_in_failures` | `id`, `email`, `failed_at` | latest failures of an email in the last 30 min; delete all of an email → `sign_in_failures_email_failed_at_idx` |
| `password_reset_links` | `id`, `account_id`, `token_hash`, `state` (`pending`/`used`/`superseded`), `expires_at`, `created_at`, `closed_at` | supersede pending of an account → `…_account_id_idx`; find + conditional consume `UPDATE … SET state='used' WHERE token_hash=$1 AND state='pending' AND expires_at > $now` → `…_token_hash_key` |

— `data-model.md §Entities (aggregate account, sign_in_failures), abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-08 — error

> **Given** a person on the sign-in screen
> **When** they enter an unknown email or a wrong password
> **Then** the system refuses with the same message in both cases, without revealing whether the email has an account
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Port interfaces `AccountRepo`, `SessionRepo`, `SignInFailureRepo`, `ResetLinkRepo`, `PasswordHasher` (every method takes an optional `Transaction`/`Kysely` executor and an explicit `now` where time matters) — `apps/api/src/modules/auth/app/ports.ts`
- [ ] Kysely implementations — `apps/api/src/modules/auth/infra/{account,session,sign-in-failure,reset-link}-repo.ts`; ids from `newId()`
- [ ] argon2id hasher (`hash`, `verify`, `verifyDummy` for unknown emails) in PHC format; add `@node-rs/argon2` to `apps/api/package.json` if `node:crypto` argon2 is experimental — `apps/api/src/modules/auth/infra/password-hasher.ts` + `password-hasher.test.ts` (low-cost test params)
- [ ] Fixtures `insertAccount`, `insertSession` (returns raw token), `insertResetLink` (returns raw token), `insertSignInFailures` — `apps/api/src/test/fixtures.ts` (`@example.test` emails only)
- [ ] Integration tests per repository — `apps/api/src/modules/auth/infra/*.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Two concurrent `insert` of the same normalised email | one succeeds, the other surfaces a unique-violation the app layer maps to a conflict |
| Conditional consume of a reset link already `used` / `superseded` / expired at `now` | returns "not consumed" (0 rows), nothing changes |
| Supersede when the account has no pending link | no-op |
| Failures of email A when listing email B | never returned (scoped by email) |
| Delete sessions of account A | account B's sessions untouched |
| `verifyDummy` for an unknown email | runs one real argon2 verification and returns false |

## Definition of Done

- [ ] integration tests for all four repositories pass against Testcontainers Postgres, each proving its scoping (by account / by email) never touches another account's or email's rows
- [ ] hasher unit test: `verify(hash(p), p)` true, wrong password false, hash is a `$argon2id$` PHC string
- [ ] no `DEFAULT now()` reliance — every insert/compare passes the clock's `now`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
