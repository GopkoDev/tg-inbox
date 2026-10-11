---
id: T7
title: "Implement the auth credential and session use cases"
layer: "app"
deps: ["T5"]
blocks: ["T8", "T10", "T11", "T12", "T13"]
acs: ["AC-08", "AC-09", "AC-11"]
files_hint: ["apps/api/src/modules/auth/app/credentials.ts", "apps/api/src/modules/auth/app/sessions.ts", "apps/api/src/modules/auth/app/accounts.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Implement the auth credential and session use cases

## Place in the sequence

- **Blocked by:** T5 — Build the auth repositories and the argon2id password hasher · **Blocks:** T8 — Implement the password-reset link use cases, T10 — Implement invitation lookup and acceptance, T11 — Implement workspace access: guard check, my workspaces, enter, T12 — Implement the team use cases, T13 — Expose the auth routes with the session cookie and resolver · **Wave:** 3 — needs the auth repository ports and the hasher; every later auth/workspaces use case calls these functions.
- **Lane:** own lane (`auth/app/credentials.ts`, `sessions.ts`, `accounts.ts`); consumes T5's `auth/app/ports.ts` read-only.

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

This task delivers the server-side rules of signing in and out — lockout, no account enumeration, session lifetime — plus the account/session functions the `workspaces` module calls.

## Inlined context

> Auth->>Db: count recent failures for the normalised email
> alt email locked out → too many failed attempts
> else unknown email or wrong password → Auth->>Db: record a failure for the normalised email → invalid credentials (one generic error for both cases)
> else credentials correct → Auth->>Db: clear failures and create a session → session token
>
> — `sad.md §6, critical flow 1 «Sign in and resolve the workspace», auth steps, abridged` · full text: [sad.md](../sad.md)

> A failure log per normalised email in Postgres; 10 failures within 15 minutes lock the email for 15 minutes from the 10th failure; it counts sign-in attempts and existing-password confirmations during invitation acceptance alike, behaves identically for emails without an account, and is cleared by a successful sign-in or a password reset
>
> — `sad.md §8, Brute-force lockout, verbatim` · full text: [sad.md](../sad.md)

> argon2id in the self-describing PHC string format […]; a sign-in for an unknown email still runs one hash verification so response time does not reveal whether an account exists; passwords are 10–1024 characters
>
> — `sad.md §8, Password storage, abridged` · full text: [sad.md](../sad.md)

> Each authenticated request looks the hash up; a session idle for more than 30 days is deleted and the request treated as signed out. Only requests triggered by a user action refresh `last_seen_at` — the SPA marks automatic requests with a request header and the server leaves `last_seen_at` alone for them — and the refresh is written at most once a minute per session.
>
> — `adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md, Decision outcome, abridged` · full text: [ADR-0002](../adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md)

> To keep accepting an invitation atomic — create the account (or verify the existing password), create the membership, consume the invitation, open the session — `auth`'s app-layer functions accept an optional transaction handle from the caller, so `workspaces` runs the whole acceptance in one database transaction while each module still writes only its own tables.
>
> — `adr/0005-split-identity-into-an-auth-module-and-a-workspaces-module.md, Decision outcome, verbatim` · full text: [ADR-0005](../adr/0005-split-identity-into-an-auth-module-and-a-workspaces-module.md)

> For an existing account the password is verified by `auth` before the acceptance transaction opens, exactly as at sign-in — a wrong password is recorded as a failure and committed on its own, so it counts toward the AC-09 lockout, and a locked-out email is refused with the generic credentials error
>
> — `sad.md §6, prose under critical flow 2, abridged` · full text: [sad.md](../sad.md)

> **Hard rule:** Every timestamp (creation, expiry, failures, session activity) comes from the application's clock port and is passed into SQL as `now` — no `DEFAULT now()`
>
> — `sad.md §8, Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

> **Hard rule:** pino through `platform/logger.ts`; request logs redact the `cookie` and `set-cookie` headers; passwords, session tokens and link tokens are never logged
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Reads/writes through T5's ports only:

| Table | Columns used | Change |
|---|---|---|
| `accounts` | `id`, `email` (normalised, UNIQUE), `display_name`, `password_hash` | insert (createAccount), read |
| `sessions` | `account_id`, `token_hash` (32-byte SHA-256, UNIQUE), `created_at`, `last_seen_at` | insert, read, delete, refresh `last_seen_at` |
| `sign_in_failures` | `email` (normalised, no FK), `failed_at` | insert, read last 30 min, delete on success |

— `data-model.md §Entities, accounts / sessions / sign_in_failures, abridged` · full text: [data-model.md](../data-model.md)

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

### AC-11 — happy path

> **Given** a signed-in operator
> **When** they sign out
> **Then** their session ends on that device and opening the web panel again asks them to sign in
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/auth/app/credentials.ts` — `signIn(email, password)`: normalise email (T4 domain), check lockout from failures (T4 window rule) → `TooManyRequestsError`; unknown email → run one dummy hash verification, record failure, `InvalidCredentialsError`; wrong password → record failure, `InvalidCredentialsError`; correct → clear failures, `openSession`, return the raw token.
- [ ] `credentials.ts` — `verifyPassword(email, password)` for invitation acceptance: same lockout + failure recording, committed on its own (outside any caller transaction); locked or wrong → `InvalidCredentialsError`.
- [ ] `apps/api/src/modules/auth/app/sessions.ts` — `openSession(accountId, tx?)` (issueLinkToken → store hash, `created_at = last_seen_at = clock.now()`), `signOut(token)` (delete by hash, no error when absent), `resolveSession(token, { background })` (idle > 30 days → delete + `UnauthenticatedError`; refresh `last_seen_at` only for non-background requests and only when ≥ 1 min old).
- [ ] `apps/api/src/modules/auth/app/accounts.ts` — `createAccount({ email, displayName, password }, tx?)` (password policy from T4, hash, insert), `findAccountIdByEmail`, `getAccount`, `getAccountsByIds`.
- [ ] Unit tests next to each file (`*.test.ts`) with in-memory port fakes and a controllable clock: AC-08 identical error for unknown vs wrong, AC-09 lock at 10th failure / lift 15 min after it / unknown email identical / correct password refused while locked / success clears, AC-11 sign-out ends only that session, idle-expiry and refresh throttling.

## Edge cases

| Case | Behaviour |
|---|---|
| Email ` Bob@x.com` vs `bob@x.com` | Same account, same failure log (normalised before any lookup) |
| Unknown email, 10 failures | Locked exactly like an existing email; responses identical |
| 9 failures then success | Failures cleared; next wrong password starts from 1 |
| 11th attempt 15 min after the 10th failure | Lock lifted; attempt evaluated normally |
| Sign-out with no / expired session | Succeeds silently (nothing to end) |
| Background request on a session idle 29 days | Served, `last_seen_at` unchanged |
| Session idle > 30 days | Row deleted, `UnauthenticatedError` |
| `verifyPassword` wrong while caller holds a transaction | Failure is written outside that transaction, so it survives the caller's rollback |

## Definition of Done

- [ ] Unit tests for `signIn`, `verifyPassword`, `signOut`, `resolveSession`, `createAccount` pass, asserting AC-08, AC-09, AC-11 with a controllable clock
- [ ] No password, session token or hash is logged or returned beyond the raw token handed to the caller
- [ ] `createAccount` and `openSession` accept an optional transaction handle (ADR-0005)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
