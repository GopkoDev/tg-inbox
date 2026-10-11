---
id: T8
title: "Implement the password-reset link use cases"
layer: "app"
deps: ["T7"]
blocks: ["T13", "T18"]
acs: ["AC-21", "AC-22"]
files_hint: ["apps/api/src/modules/auth/app/reset-links.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Implement the password-reset link use cases

## Place in the sequence

- **Blocked by:** T7 — Implement the auth credential and session use cases · **Blocks:** T13 — Expose the auth routes with the session cookie and resolver, T18 — Build the admin CLI with its three commands · **Wave:** 4 — redeeming a link reuses T7's session opening and failure clearing.
- **Lane:** own lane (`auth/app/reset-links.ts`).

## Why (user story)

> **As a** Platform admin
> **I want** to issue a password-reset link for an account on request
> **So that** a person who forgot their password regains access without a self-serve reset flow
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

This task delivers issuing, checking and redeeming reset links in the `auth` app layer; the CLI (T18) and the routes (T13) call it.

## Inlined context

> A->>D: read account by normalised email
> alt no account for that email → account not found
> else account found → A->>D: begin, mark the account's unused reset links superseded → insert a reset link with token hash and 24-hour expiry, commit → reset link
>
> — `sad.md §6, flow 11 «Issue a password-reset link», abridged` · full text: [sad.md](../sad.md)

> A->>D: read the reset link by token hash
> alt unknown, older than 24 hours, used or superseded → link no longer valid
> else valid → (redeem) alt password shorter than 10 characters → validation error
> else valid password → A->>D: begin, consume the link only while unused and unexpired
> alt consumed or expired in the meantime → link no longer valid
> else consumed → store the new password hash → delete every session of the account → clear the sign-in failures of the email → insert a session for this device, commit → session token
>
> — `sad.md §6, flow 12 «Set a new password through a reset link», abridged` · full text: [sad.md](../sad.md)

> Each link carries 32 random bytes; only their SHA-256 hash is stored; the link is shown exactly once […]; single use through a conditional update that succeeds only while the link is pending and unexpired; […] reset links 24 hours; issuing a new one […] (or for the same account) supersedes the earlier one; every timestamp […] comes from the application's clock port and is passed into SQL as `now` — no `DEFAULT now()`
>
> — `sad.md §8, Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

> `PUBLIC_WEB_URL` — the panel's public base URL, used to build invitation and password-reset links in the API and the CLI
>
> — `sad.md §7, Configuration added, verbatim` · full text: [sad.md](../sad.md)

> | Link | SPA route |
> | `PUBLIC_WEB_URL/reset-password/<token>` | `/reset-password/:token` |
>
> — `contracts/cli.md §Web panel paths the links point at, abridged` · full text: [cli.md](../contracts/cli.md)

> **Hard rule:** passwords, session tokens and link tokens are never logged
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Uses through T5's ports:

| Column | Type | Constraints | Change |
|---|---|---|---|
| `password_reset_links.token_hash` | bytea | NOT NULL, UNIQUE, CHECK 32 bytes | insert, lookup |
| `password_reset_links.state` | text | CHECK IN (`pending`, `used`, `superseded`); expired stays `pending` | `pending` → `used` / `superseded` |
| `password_reset_links.expires_at` | timestamptz | `created_at` + 24 h | insert, compared with `now` |
| `password_reset_links.closed_at` | timestamptz | `(state = 'pending') = (closed_at IS NULL)` | set on use / supersede |
| `accounts.password_hash` | text | argon2id PHC | updated on redeem |
| `sessions` (all of the account) / `sign_in_failures` (the email) | — | — | deleted on redeem |

Consume: `UPDATE … SET state='used' WHERE token_hash=$1 AND state='pending' AND expires_at > $now`.

— `data-model.md §Entities, password_reset_links + access patterns, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21, verbatim` · full text: [spec.md](../spec.md)

### AC-22 — domain invariant

> **Given** a password-reset link that is older than 24 hours or was already used
> **When** a person opens it
> **Then** the system refuses it and explains that the reset link is no longer valid
>
> — `spec.md §5, AC-22, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/auth/app/reset-links.ts` — `issueResetLink(email)`: normalise, find account (none → `NotFoundError`), in one transaction supersede the account's pending links and insert a new one (`issueLinkToken()`, `expires_at = now + 24 h`); return `{ accountId, resetLinkId, link: PUBLIC_WEB_URL + '/reset-password/' + token, expiresAt }`.
- [ ] `lookUpResetLink(token)`: hash, find; unknown / not `pending` / `expires_at ≤ now` → `ResetLinkInvalidError`; never reveals the account.
- [ ] `redeemResetLink(token, password)`: password policy (T4) first → `ValidationError` with `details.field = 'password'` before any write; one transaction: conditional consume (0 rows → `ResetLinkInvalidError`), store new hash, delete all account sessions, clear the email's failures, `openSession(accountId, tx)` (T7); return the raw session token.
- [ ] Unit tests `reset-links.test.ts` with port fakes + controllable clock: supersede on re-issue, 24 h expiry, used link refused, short password rejected with no writes.
- [ ] Integration test `reset-links.int.test.ts`: two concurrent redeems of one link → exactly one succeeds; other sessions of the account gone after redeem; failures cleared.

## Edge cases

| Case | Behaviour |
|---|---|
| No account for the email (issue) | `NotFoundError` — only the CLI sees it (not public enumeration) |
| Second issue for the same account | Earlier pending link → `superseded`, its token refused |
| Link 24 h + 1 s old | `ResetLinkInvalidError` |
| Link redeemed twice / concurrently | Second → `ResetLinkInvalidError` (conditional consume) |
| Password of 9 characters | `ValidationError` field `password`; link stays pending, nothing written |
| Account locked out (AC-09) before redeem | Failures cleared; next sign-in evaluated fresh |

## Definition of Done

- [ ] Unit + integration tests for issue / lookup / redeem pass, asserting AC-21 and AC-22
- [ ] Only the SHA-256 hash of the link token is stored; the link appears only in the return value of `issueResetLink`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
