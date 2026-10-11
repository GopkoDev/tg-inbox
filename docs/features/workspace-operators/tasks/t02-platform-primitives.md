---
id: T2
title: "Add platform primitives: error classes and codes, clock port, link tokens, config keys"
layer: "infra"
deps: []
blocks: ["T5", "T6", "T13", "T19"]
acs: ["AC-09", "AC-14", "AC-17"]
files_hint: ["apps/api/src/platform/errors.ts", "packages/shared/src/errors.ts", "apps/api/src/platform/clock.ts", "apps/api/src/platform/tokens.ts", "apps/api/src/platform/config.ts", ".env.example", "apps/api/src/test/postgres.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Add platform primitives: error classes and codes, clock port, link tokens, config keys

## Place in the sequence

- **Blocked by:** — · **Blocks:** T5 — Build the auth repositories and the argon2id password hasher, T6 — Build the workspaces repositories with cross-workspace isolation tests, T13 — Expose the auth routes with the session cookie and resolver, T19 — Lay the web foundation · **Wave:** 1 — pure platform code, no upstream.
- **Lane:** own lane (it is the only task touching `platform/errors.ts`, `clock.ts`, `tokens.ts`, `config.ts` and `packages/shared/src/errors.ts`).

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to invite a person by email as an operator or a business owner
> **So that** my team grows without asking the tg-inbox team
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to deactivate a member who left and reactivate them if they return
> **So that** former staff lose access to our customers at once
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task gives every module the shared building blocks those stories need: the error codes the panel switches on (lockout, access removed), the clock that drives expiry and lockout, the link-token generator and the `PUBLIC_WEB_URL` the links are built from.

## Inlined context

> The existing envelope `{ "error": { "code", "message", "details"? } }`; the platform gains `UnauthenticatedError` (401) and `TooManyRequestsError` (429), and `AppError` subclasses may carry a more specific code (e.g. invalid credentials, link no longer valid, already a member, last active owner, access removed); the exact list is fixed at the `api` stage in `packages/shared/src/errors.ts`
>
> — `sad.md §8, Error handling, verbatim` · full text: [sad.md](../sad.md)

> Each link carries 32 random bytes; only their SHA-256 hash is stored … every timestamp (creation, expiry, failures, session activity) comes from the application's clock port and is passed into SQL as `now` — no `DEFAULT now()` — so the controllable-clock tests of QG-2a/2b drive expiry and lockout
>
> — `sad.md §8, Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

> `PUBLIC_WEB_URL` — the panel's public base URL, used to build invitation and password-reset links in the API and the CLI · `WEB_DIST_DIR` — optional path to the built web panel; when unset (local development) the API serves no static files
>
> — `sad.md §7, Configuration added, abridged` · full text: [sad.md](../sad.md)

> **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` from `src/platform/errors.ts`. … codes are declared in `packages/shared/src/errors.ts`. · **Config:** env vars are parsed only in `src/platform/config.ts`; document every key in `.env.example`. No `process.env` elsewhere.
>
> — `CLAUDE.md §Rules, Errors + Config, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Codes and statuses this task declares (used by every later route):

| Code | HTTP | Class |
|---|---|---|
| `UNAUTHENTICATED` | 401 | `UnauthenticatedError` |
| `INVALID_CREDENTIALS` | 401 | `InvalidCredentialsError` |
| `ACCESS_REMOVED` · `OWNER_ONLY` · `INVITATION_FOR_ANOTHER_EMAIL` | 403 | `AccessRemovedError` · `OwnerOnlyError` · `InvitationForAnotherEmailError` |
| `INVITATION_INVALID` (`details.ask: business_owner \| tg_inbox_team`) · `RESET_LINK_INVALID` | 404 | `InvitationInvalidError` · `ResetLinkInvalidError` |
| `ALREADY_A_MEMBER` · `LAST_ACTIVE_OWNER` · `OWNER_ALREADY_JOINED` | 409 | `AlreadyAMemberError` · `LastActiveOwnerError` · `OwnerAlreadyJoinedError` |
| `TOO_MANY_ATTEMPTS` | 429 | `TooManyRequestsError` |

— `contracts/openapi.yaml, components.schemas.ErrorCode, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add the 11 new codes to `ErrorCode` and extend its unit test — `packages/shared/src/errors.ts`, `packages/shared/src/errors.test.ts`
- [ ] Add `UnauthenticatedError`, `TooManyRequestsError` and the nine specific-code `AppError` subclasses (table above); `InvitationInvalidError` takes `ask` and puts it in `details` — `apps/api/src/platform/errors.ts`
- [ ] Unit-test that the error handler maps each class to its status + envelope — `apps/api/src/platform/errors.test.ts`
- [ ] `Clock` port `{ now(): Date }` with `systemClock` and a controllable `fixedClock(start)` (`set`, `advance(ms)`) for tests — `apps/api/src/platform/clock.ts` + `clock.test.ts`
- [ ] `issueLinkToken()` → `{ token, hash }` (32 random bytes, base64url without padding = 43 chars; SHA-256 `Buffer`) and `hashToken(token)` — `apps/api/src/platform/tokens.ts` + `tokens.test.ts`
- [ ] Config: `PUBLIC_WEB_URL` (required `z.url()`), `WEB_DIST_DIR` (optional string) — `apps/api/src/platform/config.ts`; document both in `.env.example`; add `PUBLIC_WEB_URL` to `testConfig` — `apps/api/src/test/postgres.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `PUBLIC_WEB_URL` missing or not a URL | `loadConfig` throws at boot — the API and CLI refuse to start |
| `WEB_DIST_DIR` unset | config parses; static serving stays off (used by T17) |
| Two `issueLinkToken()` calls | different tokens; token matches `^[A-Za-z0-9_-]{43}$`; `hashToken(token)` equals the returned `hash` (32 bytes) |
| `fixedClock.advance(15 * 60_000)` | `now()` moves exactly 15 minutes — the lockout and expiry tests rely on it |
| An `AppError` subclass thrown in a route | envelope carries its own code (e.g. `ACCESS_REMOVED`), never the generic `FORBIDDEN` |

## Definition of Done

- [ ] unit tests for error mapping, clock and tokens pass
- [ ] `packages/shared` error-code test passes with the 16 codes
- [ ] `.env.example` documents `PUBLIC_WEB_URL` and `WEB_DIST_DIR`; no `process.env` outside `config.ts`
- [ ] the smoke test `apps/api/src/app.int.test.ts` still passes with the new `testConfig`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
