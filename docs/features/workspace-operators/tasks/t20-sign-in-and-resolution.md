---
id: T20
title: "Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found"
layer: "ui"
deps: ["T19"]
blocks: ["T21", "T23"]
acs: ["AC-07", "AC-08", "AC-09", "AC-10", "AC-13"]
files_hint: ["apps/web/src/app/routes.tsx", "apps/web/src/features/auth/sign-in/", "apps/web/src/features/workspaces/resolve.ts", "apps/web/src/pages/SignInPage.tsx", "apps/web/src/pages/NoAccessPage.tsx", "apps/web/src/pages/NotFoundPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T20 — Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found

## Place in the sequence

- **Blocked by:** T19 — Lay the web foundation: shadcn primitives, API client, shared guard handling, stores · **Blocks:** T21 — Build SCR-02 accept invitation and SCR-03 link unavailable, T23 — Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher · **Wave:** 3 — runs alongside the backend app layer; it needs only T19's client and the shared schemas.
- **Lane:** owns `apps/web/src/app/routes.tsx`. This task writes the **full** route table — public `/sign-in`, `/invite/:token`, `/reset-password/:token`; signed-in `/workspaces`, `/no-access`; workspace area `/w/:workspaceId`, `/w/:workspaceId/team`; catch-all → SCR-10 — with stub pages `AcceptInvitationPage`, `ResetPasswordPage`, `WorkspacesPage`, `WorkspaceHomePage`, `TeamPage` that T21–T24 replace, so no later UI task touches `routes.tsx`.

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to switch between the workspaces I am a member of
> **So that** I can work for several businesses with one account while seeing only one business's data at a time
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task delivers the sign-in screen, the AC-07 "where do I land" resolution every entry point reuses, and the two terminal screens (no access, not found).

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Public routes (sign-in, accept invitation, set new password) live outside `/w/<workspaceId>/…`; workspace screens live inside it.
>
> — `sad.md §4, Supporting choices — UI architecture, abridged` · full text: [sad.md](../sad.md)

> **Posture:** responsive-both — every screen works at phone width (≥ 360 px, 16 px gutter) and desktop width. **Copy:** the panel shows the server message for errors and does not invent its own wording for them.
>
> — `screens.md §Source, Posture + Copy, abridged` · full text: [screens.md](../screens.md)

**SCR-01 — Sign-in** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | App boot: `getMe` in flight to find out whether a session already exists | Card, shadcn:skeleton |
> | default | No session (`getMe` → 401) or after sign-out | Card, shadcn:input, shadcn:label, Button |
> | submitting | `signIn` in flight — fields and button disabled, button shows a spinner | Button (disabled + lucide `Loader2`) |
> | validation | `400 VALIDATION_ERROR` (email not a valid address after trimming) — message under the email field; empty fields are blocked client-side by `required` | shadcn:input (`aria-invalid`), shadcn:label |
> | error: invalid credentials | `401 INVALID_CREDENTIALS` — «Email or password is incorrect», same for an unknown email and a wrong password; password field cleared | shadcn:alert (destructive) |
> | error: locked out | `429 TOO_MANY_ATTEMPTS` — «Too many failed attempts, try again later»; also for emails without an account | shadcn:alert (destructive) |
> | session-ended | Arrived through the shared `401` handler from a workspace screen — neutral notice «Sign in to continue» above the form; after sign-in the panel continues to the remembered address | shadcn:alert (default) |
> | success | `204` → AC-07 resolution: return address (if one) → `last_used_workspace_id` → the only workspace → SCR-04 (several) → SCR-05 (none) | — (navigation) |
>
> The «Forgot your password?» line is static help text (no link): reset links come only from a platform admin.
>
> — `screens.md §SCR-01, state table + note, abridged` · full text: [screens.md](../screens.md)

**SCR-05 — No access:** `default` — «You no longer have access to any workspace»; signed-in email and **Sign out**; no workspace data (Card, Button). `access-removed` — adds «Your access to Acme Flowers was removed» above the text (shadcn:alert default).

— `screens.md §SCR-05, state table, abridged` · full text: [screens.md](../screens.md)

**SCR-10 — Not found:** `default` — the guard answered `404 NOT_FOUND` for `/w/<workspaceId>/…` (never a member, unknown or malformed id) — «Page not found», no workspace name, no hint the workspace or item exists; **Go to my workspace** runs the AC-07 resolution (Card, Button). Unknown non-workspace addresses reuse this screen.

— `screens.md §SCR-10, state table + sources, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T13/T14):

- `POST /api/auth/sign-in` (`signIn`) — body `{ email, password }` → `204` + session cookie · errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS`.
- `GET /api/me` (`getMe`) → `200 Me { account, last_used_workspace_id }` · `401 UNAUTHENTICATED`.
- `GET /api/me/workspaces` (`listMyWorkspaces`) → `200 WorkspaceSummaryPage { items[{id,name,role}], has_next, has_prev, next_cursor }` · `401`.
- `POST /api/auth/sign-out` (`signOut`) → `204` always (SCR-05 Sign out).

— `contracts/openapi.yaml, operationId signIn / getMe / listMyWorkspaces / signOut, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator with an active account and at least one active membership
> **When** they sign in with the correct email and password
> **Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

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

### AC-10 — authorization

> **Given** an operator whose every membership has been deactivated
> **When** they sign in with the correct email and password
> **Then** the system tells them they no longer have access to any workspace and shows no workspace data
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/web/src/features/workspaces/resolve.ts`: `resolveWorkspace()` — `getMe` → return address if set → `last_used_workspace_id` (still in the active list) → the only item → `/workspaces` (several) → `/no-access` (none); store the account in the auth store. Also used by T19's guard handler.
- [ ] `apps/web/src/app/routes.tsx`: the full route table (see *Place in the sequence*) with stub pages for SCR-02/04/06/07/09; catch-all → `NotFoundPage`.
- [ ] `apps/web/src/features/auth/sign-in/` + `apps/web/src/pages/SignInPage.tsx`: SCR-01 in every listed state; show the server `message` for errors; clear the password on 401.
- [ ] `apps/web/src/pages/NoAccessPage.tsx`: SCR-05 `default` + `access-removed` (notice from the workspaces store); Sign out → `signOut` → `/sign-in`.
- [ ] `apps/web/src/pages/NotFoundPage.tsx`: SCR-10; **Go to my workspace** → `resolveWorkspace()`; never shows a workspace name.
- [ ] Tests: `SignInPage.test.tsx` (one per state), `resolve.test.ts` (each AC-07 branch + AC-10 empty list), `NoAccessPage.test.tsx`, `NotFoundPage.test.tsx`.

## Edge cases

| Case | Behaviour |
|---|---|
| Unknown email vs wrong password | Identical alert «Email or password is incorrect» (server message), password cleared |
| Locked-out email (with or without an account) | Alert «Too many failed attempts, try again later», no hint about the account |
| `last_used_workspace_id` points at a workspace no longer active | Ignored; falls through to the only workspace / picker / no-access |
| Zero active memberships after sign-in | `/no-access` (SCR-05), no workspace data loaded |
| Guard `404` on `/w/<id>/…` or malformed id | SCR-10 in place, no workspace name |
| Arrived via shared `401` handler | `session-ended` notice; after sign-in, continue to the remembered address |
| Network failure / `500` on sign-in | Destructive alert «Something went wrong», form kept |

## Definition of Done

- [ ] `SignInPage.test.tsx` covers loading, default, submitting, validation, invalid credentials, locked out, session-ended and success navigation.
- [ ] `resolve.test.ts` covers every AC-07 branch and the AC-10 no-access outcome.
- [ ] `NotFoundPage.test.tsx` proves no workspace name or id is rendered (AC-13).
- [ ] Every route in the table resolves (stubs render) and the catch-all renders SCR-10.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
