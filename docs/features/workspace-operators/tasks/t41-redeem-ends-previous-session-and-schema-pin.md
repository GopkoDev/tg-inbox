---
id: T41
title: "End the previous session on reset-link redeem, pin the response schemas with a test, fix the auth map row"
layer: "ports"
deps: []
blocks: []
acs: ["AC-21", "AC-07", "AC-12", "AC-03"]
files_hint: ["apps/api/src/modules/auth/http/routes.ts", "apps/api/src/modules/auth/http/routes.int.test.ts", "apps/api/src/modules/workspaces/http/routes.int.test.ts", "apps/api/src/modules/workspaces/http/invitation-routes.int.test.ts", "apps/api/src/modules/workspaces/http/response-schemas.test.ts", "docs/architecture-map.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "todo"
---

# T41 — End the previous session on reset-link redeem, pin the response schemas with a test, fix the auth map row

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R4 (stage-2, low) — `auth/http/routes.ts:51-58`: redeem sets the new session cookie but leaves the session the device's previous cookie pointed at valid for 30 days; openapi.yaml:138 says "A session cookie already on this device is replaced". Sign-in and accept already end it.
- R5 (stage-1, low; closes round-1 #10) — no test fails if `response: { 200: … }` is removed from `workspaces/http/routes.ts:31,47,65` or `invitation-routes.ts:42,59`; `routes.int.test.ts:97-98` checks keys a handler already builds exactly.
- R6 (stage-2, low) — `docs/architecture-map.md:69` says auth's routes are under `/api/auth`, but auth also registers `/api/password-reset-links/lookup|redeem`.

## Acceptance criteria

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21 (US-08), verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Redeem: if a session cookie came with the request, end that session (`sessionUseCases.signOut(previous)`) after a successful redeem and before setting the new cookie — same pattern as sign-in (`routes.ts:27-29`).
- [ ] Pin the response schemas: e.g. a test that builds the app, walks the registered routes (`app.printRoutes` / `onRoute` hook capture) and asserts each of the five routes has a `response[200]` schema equal to the shared one; or inject a stub use case that returns an extra field (e.g. `passwordHash`) and assert it never reaches the body. It must fail when a `response` entry is removed.
- [ ] architecture-map auth row: routes under `/api/auth` and `/api/password-reset-links`.
- [ ] Integration test: redeem with another account's live cookie → that old session is rejected afterwards (401 on `/api/me`), the new one works.

## Edge cases

| Case | Behaviour |
|---|---|
| Redeem with another account's cookie on the device | Old session ended, new session for the reset account |
| Redeem with no cookie | Unchanged |

## Definition of Done

- [ ] Redeem, sign-in and accept all replace the device session the same way
- [ ] Removing any response schema turns a test red
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
