---
id: T13
title: "Expose the auth routes with the session cookie and resolver"
layer: "ports"
deps: ["T2", "T3", "T7", "T8"]
blocks: ["T14"]
acs: ["AC-08", "AC-09", "AC-11", "AC-21", "AC-22"]
files_hint: ["apps/api/src/modules/auth/http/", "apps/api/src/app.ts", "apps/api/package.json"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T13 — Expose the auth routes with the session cookie and resolver

## Place in the sequence

- **Blocked by:** T2 — Add platform primitives: error classes and codes, clock port, link tokens, config keys · T3 — Define the auth and workspaces zod contracts in packages/shared · T7 — Implement the auth credential and session use cases · T8 — Implement the password-reset link use cases · **Blocks:** T14 — Expose the workspace guard and the me / workspaces / enter routes · **Wave:** 5 — first HTTP task; every later route needs the session resolver it exports.
- **Lane:** shares `apps/api/src/app.ts` with T14 → T17 and `apps/api/package.json` with T5, T17, T18 — serialized.

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

This task puts sign-in, sign-out and reset-link redemption on HTTP, sets/clears the session cookie, and exports the session resolver every authenticated route uses.

## Inlined context

> Shape: on sign-in (and on invitation acceptance or password reset, which also sign the device in) the server generates 32 random bytes, sends them base64url-encoded in a cookie that is `HttpOnly`, `Secure` (outside local development), `SameSite=Lax`, `Path=/`, and stores only the SHA-256 hash of the token […]. Each authenticated request looks the hash up; a session idle for more than 30 days is deleted and the request treated as signed out. Only requests triggered by a user action refresh `last_seen_at` — the SPA marks automatic requests with a request header and the server leaves `last_seen_at` alone for them — and the refresh is written at most once a minute per session.
>
> — `adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md §Decision outcome, shape, abridged` · full text: [ADR-0002](../adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md)

> Shape: every feature module's HTTP routes live under `/api/…` (`/health` stays where it is […]). […] Mutating routes accept only `application/json` bodies.
>
> — `adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md §Decision outcome, shape, abridged` · full text: [ADR-0004](../adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md)

> `auth` exposes the session resolver that every authenticated route uses; public routes (sign-in, invitation lookup and acceptance, reset-link redemption) are explicit. […] request logs redact the `cookie` and `set-cookie` headers; passwords, session tokens and link tokens are never logged.
>
> — `sad.md §8, Authentication + Logging rows, abridged` · full text: [sad.md](../sad.md)

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildApp()` constructs deps and registers modules. No self-registration, no globals.
> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod` […].
>
> — `CLAUDE.md §Rules, Module wiring + Contracts, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> QG-2a How verify: with a controllable clock, 10 failures lock the email, an 11th attempt with the correct password is refused, the lock lifts 15 minutes after the 10th failure, and the same sequence on an unknown email produces byte-identical responses; a further test shows that a password reset clears the count.
> QG-2b How verify: with a controllable clock, a session refreshed only by requests marked as background expires after 30 days while one with a user action on day 29 survives; sign-out ends only that session; redeeming a reset link ends every other session of the account and signs in the redeeming device.
>
> — `sad.md §10, QG-2a + QG-2b, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST /api/auth/sign-in` (`signIn`, public) — body `SignIn {email: EmailInput, password (1–1024)}` → `204` + `Set-Cookie: session=<token>; HttpOnly; SameSite=Lax; Path=/; Secure` · errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` («Email or password is incorrect»), `429 TOO_MANY_ATTEMPTS` («Too many failed attempts, try again later»).
- `POST /api/auth/sign-out` (`signOut`, cookie optional) → always `204` + `Set-Cookie: session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`.
- `POST /api/password-reset-links/lookup` (`lookUpPasswordResetLink`, public) — body `{token: LinkToken ^[A-Za-z0-9_-]{43}$}` → `204` · errors: `400`, `404 RESET_LINK_INVALID`.
- `POST /api/password-reset-links/redeem` (`redeemPasswordResetLink`, public) — body `{token, password: Password 10–1024}` → `204` + session cookie (replaces any existing one) · errors: `400 VALIDATION_ERROR` (`details.field: password`), `404 RESET_LINK_INVALID`.
- Shared: any authenticated route with no/expired session → `401 UNAUTHENTICATED` («Sign in to continue»); header `X-Background-Request: 1` = do not extend the idle window.

— `contracts/openapi.yaml, operationIds signIn / signOut / lookUpPasswordResetLink / redeemPasswordResetLink + components SessionCookie, BackgroundRequest, Unauthenticated, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

- [ ] Add `@fastify/cookie` to `apps/api/package.json`; register it in `buildApp()` (`apps/api/src/app.ts`).
- [ ] `apps/api/src/modules/auth/http/cookie.ts` — set/clear the `session` cookie (`Secure` unless `NODE_ENV=development`).
- [ ] `apps/api/src/modules/auth/http/session-resolver.ts` — exported `preHandler`: reads the cookie, calls T7 `resolveSession` with the background flag from `X-Background-Request: 1`, attaches `request.account`, throws `UnauthenticatedError` when absent.
- [ ] `apps/api/src/modules/auth/http/routes.ts` — `registerAuth(app, deps)`: the four routes above with the T3 zod schemas; only `application/json` bodies; never log tokens or passwords.
- [ ] Register `registerAuth` under the `/api` prefix in `buildApp()`; `/health` stays unprefixed.
- [ ] `apps/api/src/modules/auth/http/routes.int.test.ts` — `app.inject()` on `buildApp()`: AC-08 identical body for unknown email and wrong password; QG-2a lockout sequence with a controllable clock (byte-identical for unknown email; reset clears the count); AC-11 sign-out ends only this session; QG-2b idle expiry with background vs user requests; AC-21 redeem signs in and ends other sessions; AC-22 expired / used link → 404.

## Edge cases

| Case | Behaviour |
|---|---|
| Sign-out with no cookie or an expired session | `204`, cookie cleared |
| Email with surrounding spaces / upper case | Treated as the same normalised email |
| Locked-out email with the correct password | `429 TOO_MANY_ATTEMPTS`, identical for an unknown email |
| Request marked `X-Background-Request: 1` | Served, but `last_seen_at` not refreshed |
| Reset link redeemed twice concurrently | One `204`, the other `404 RESET_LINK_INVALID` |
| Redeem with password < 10 chars | `400 VALIDATION_ERROR` `field: password`, nothing written |
| Non-JSON body on a mutating route | Rejected (`400`/`415`), nothing executed |

## Definition of Done

- [ ] `routes.int.test.ts` passes for AC-08, AC-09, AC-11, AC-21, AC-22 and the QG-2a / QG-2b scenarios
- [ ] The cookie attributes match the contract; no token, password or cookie appears in logs
- [ ] `GET /health` still answers 200 (`app.int.test.ts`)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
