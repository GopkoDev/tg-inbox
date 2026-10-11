---
id: T32
title: "Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in"
layer: "ports"
deps: ["T29", "T30"]
blocks: []
acs: ["AC-11", "AC-07", "AC-12", "AC-03"]
files_hint: ["apps/api/src/modules/auth/http/cookie.ts", "apps/api/src/modules/auth/http/routes.ts", "apps/api/src/modules/auth/http/routes.int.test.ts", "apps/api/src/modules/auth/http/session-resolver.ts", "apps/api/src/platform/session-cookie.ts", "apps/api/src/modules/workspaces/http/invitation-routes.ts", "apps/api/src/modules/workspaces/http/invitation-routes.int.test.ts", "apps/api/src/modules/workspaces/http/routes.ts", "apps/api/src/modules/workspaces/http/routes.int.test.ts", "apps/api/src/deps.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
source: "review-2026-10-11"
status: "done"
---

# T32 — Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in

## Place in the sequence

- **Blocked by:** T29 — Make the sign-in lockout atomic per email and use the contract's credential message, T30 — Shape route validation errors as the contract's field details and accept only JSON on mutating routes · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #9 (stage-2, low) — `workspaces/http/invitation-routes.ts:7` imports `SESSION_COOKIE` / `setSessionCookie` from `modules/auth/http/cookie.ts` and re-implements optional session resolution at lines 36-46 (CLAUDE.md cross-module rule: call the other module's app layer only).
- #10 (stage-2, low) — no zod `response` schema on `/me`, `/me/workspaces`, `…/enter` (`workspaces/http/routes.ts:31,43,60`), `/invitations/lookup`, `/invitations/accept` (`invitation-routes.ts:48,61`).
- #11 (stage-2, low) — sign-in overwrites the cookie but leaves the session row the old cookie pointed at valid for 30 days (`auth/http/routes.ts:27-36`); accept already ends it (`invitation-routes.ts:65-66`).

## Acceptance criteria

### AC-11 — happy path

> **Given** a signed-in operator
> **When** they sign out
> **Then** their session ends on that device and opening the web panel again asks them to sign in
>
> — `spec.md §5, AC-11 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** an operator with an active account and at least one active membership
> **When** they sign in with the correct email and password
> **Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one
>
> — `spec.md §5, AC-07 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-03 — happy path

> **Given** a valid, unused invitation for a person whose email has no account yet
> **When** the person opens the invitation link, enters their name and a password, and confirms
> **Then** the system creates their account, gives them an active membership with the invited role, signs them in and opens that workspace
>
> — `spec.md §5, AC-03 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Move the cookie name + set/clear helpers to `platform/` (e.g. `platform/session-cookie.ts`) and import them from both modules; have auth expose an optional-session resolver that the composition root injects into the workspaces routes instead of the hand-rolled one.
- [x] Add `response: { 200: … }` with the shared zod schemas (`Me`, `WorkspaceSummaryPage`, `WorkspaceSummary`, `InvitationPreview`, the accept response) — import them from `@tg/shared`.
- [x] On a successful sign-in, if a session cookie came with the request, end that session (`sessionUseCases.signOut(previous)`) before setting the new cookie.
- [x] Tests: after sign-in with an old cookie the old token is rejected (401 on `/api/me`); response bodies carry no extra fields; `workspaces` no longer imports anything under `modules/auth/http`.

## Edge cases

| Case | Behaviour |
|---|---|
| Sign in again on a device with a live session | Old session invalid, new one works |
| Accept invitation while signed in | Unchanged behaviour (previous session ended) |

## Definition of Done

- [x] `grep -r "auth/http" apps/api/src/modules/workspaces` is empty
- [x] All five routes have response schemas
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
