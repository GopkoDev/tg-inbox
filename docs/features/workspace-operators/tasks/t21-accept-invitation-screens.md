---
id: T21
title: "Build SCR-02 accept invitation and SCR-03 link unavailable"
layer: "ui"
deps: ["T20"]
blocks: ["T22"]
acs: ["AC-03", "AC-04", "AC-04b", "AC-05", "AC-06"]
files_hint: ["apps/web/src/features/auth/accept-invitation/", "apps/web/src/features/auth/link-unavailable/", "apps/web/src/pages/AcceptInvitationPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T21 — Build SCR-02 accept invitation and SCR-03 link unavailable

## Place in the sequence

- **Blocked by:** T20 — Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found (route table + `resolveWorkspace()`) · **Blocks:** T22 — Build SCR-09 set new password (reuses SCR-03) · **Wave:** 4, parallel with T23.
- **Lane:** own lane. Replaces T20's stub `AcceptInvitationPage`; does **not** touch `routes.tsx` (`/invite/:token` already exists).

## Why (user story)

> **As an** Operator
> **I want** to accept an invitation link and set up my access
> **So that** I become a member of the business's workspace with the role I was invited for
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task delivers the screen behind every invitation link and the shared "link can't be used" screen.

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> For an existing account the password is verified by `auth` before the acceptance transaction opens, exactly as at sign-in — a wrong password is recorded as a failure […] and a locked-out email is refused with the generic credentials error […]. A password shorter than 10 characters is rejected before anything is written (AC-05). If the invitation is revoked or consumed between the password check and the transaction, the conditional consume fails and the person gets the «no longer valid» answer (AC-06).
>
> — `sad.md §6, critical flow 2 prose, abridged` · full text: [sad.md](../sad.md)

**SCR-02 — Accept invitation** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | `lookUpInvitation` in flight after opening `/invite/<token>` | Card, shadcn:skeleton |
> | default: new account | `200` with `account_exists: false` — shows workspace name, invited email (read-only) and role; fields: name, password (hint «at least 10 characters») | Card, shadcn:input, shadcn:label, shadcn:badge (role), Button |
> | default: existing account | `200` with `account_exists: true` — workspace name, email, role; one field: the account's existing password | Card, shadcn:input, shadcn:label, shadcn:badge, Button |
> | submitting | `acceptInvitation` in flight — form disabled, button spinner | Button (disabled + `Loader2`) |
> | validation | `400 VALIDATION_ERROR` with `details.field` — password < 10 chars «The password must be at least 10 characters long» (AC-05), name blank or > 200 chars; the length rule is also checked client-side before submit | shadcn:input (`aria-invalid`), shadcn:label |
> | error: invalid credentials | `401 INVALID_CREDENTIALS` on the existing-account form — wrong password **or** locked-out email, one message «Email or password is incorrect»; password cleared | shadcn:alert (destructive) |
> | error: link unavailable | `404 INVITATION_INVALID` (on lookup, or on submit when the invitation was revoked/used in between) or `403 INVITATION_FOR_ANOTHER_EMAIL` → render SCR-03 in place | — (→ SCR-03) |
> | error: unexpected | network failure / `500` on lookup or submit — «Something went wrong» + Retry (lookup) / keep the form filled (submit) | shadcn:alert (destructive), Button |
> | success | `200 WorkspaceSummary` → `enterWorkspace` → SCR-06 of the joined workspace | — (navigation) |
>
> — `screens.md §SCR-02, state table, abridged` · full text: [screens.md](../screens.md)

**SCR-03 — Link unavailable** (states to build; the reset-link variant is added by T22):

> | State | Trigger / condition | Components |
> |---|---|---|
> | default: invitation invalid, ask a business owner | `404 INVITATION_INVALID`, `details.ask: business_owner` — «This invitation is no longer valid — ask a business owner for a new one» | Card, lucide `LinkOff` icon |
> | default: invitation invalid, ask the tg-inbox team | `404 INVITATION_INVALID`, `details.ask: tg_inbox_team` — «… ask the tg-inbox team for a new one» | Card |
> | default: invitation for another email | `403 INVITATION_FOR_ANOTHER_EMAIL` — «This invitation belongs to another email — sign out and open the link again»; **Sign out** button signs out (`signOut`) and reloads the same `/invite/<token>` | Card, Button |
>
> «Go to sign-in» is shown only when the device has no session; with a session the button reads «Go to my workspace» and runs the AC-07 resolution.
>
> — `screens.md §SCR-03, state table + note, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T15):

- `POST /api/invitations/lookup` (`lookUpInvitation`) — body `{ token }` → `200 InvitationPreview { workspace_name, email, role, account_exists }` · errors: `400`, `403 INVITATION_FOR_ANOTHER_EMAIL`, `404 INVITATION_INVALID` (`details.ask: business_owner | tg_inbox_team`).
- `POST /api/invitations/accept` (`acceptInvitation`) — body `{ token, password, display_name? }` (`display_name` only when `account_exists: false`) → `200 WorkspaceSummary` + session cookie · errors: `400 VALIDATION_ERROR` (`details.field`), `401 INVALID_CREDENTIALS`, `403 INVITATION_FOR_ANOTHER_EMAIL`, `404 INVITATION_INVALID`.
- Then `POST /api/workspaces/{workspaceId}/enter` (`enterWorkspace`) on success; `POST /api/auth/sign-out` from SCR-03.

— `contracts/openapi.yaml, operationId lookUpInvitation / acceptInvitation / enterWorkspace / signOut, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-03 — happy path

> **Given** a valid, unused invitation for a person whose email has no account yet
> **When** the person opens the invitation link, enters their name and a password, and confirms
> **Then** the system creates their account, gives them an active membership with the invited role, signs them in and opens that workspace
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — cross-context

> **Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
> **When** the person opens the invitation link
> **Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-04b — authorization

> **Given** a person signed in with an account whose email differs from the email the invitation was issued for
> **When** they open the invitation link
> **Then** the system does not add any membership to the signed-in account and tells them the invitation belongs to another email — sign out and open the link again to accept it
>
> — `spec.md §5, AC-04b, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a person accepting a valid invitation
> **When** they choose a password shorter than 10 characters
> **Then** the system does not create the account and tells them the password must be at least 10 characters long
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/web/src/features/auth/link-unavailable/LinkUnavailable.tsx`: SCR-03 driven by a `reason` prop (`invitation-invalid` + `ask`, `invitation-for-another-email`; leave room for T22's `reset-link-invalid`); session-aware button (Go to sign-in / Go to my workspace); Sign out → `signOut` → reload `/invite/<token>`.
- [ ] `apps/web/src/features/auth/accept-invitation/`: lookup on mount; new-account form (name + password) vs existing-account form (password only); client-side 10-character check; submit → `acceptInvitation` → `enterWorkspace` → `/w/<id>`.
- [ ] Map `404 INVITATION_INVALID` / `403 INVITATION_FOR_ANOTHER_EMAIL` (lookup or submit) to SCR-03 in place; `401` → alert + clear password; `400` → field error from `details.field`.
- [ ] `apps/web/src/pages/AcceptInvitationPage.tsx`: replace T20's stub.
- [ ] Tests: `AcceptInvitationPage.test.tsx` (each SCR-02 state), `LinkUnavailable.test.tsx` (each SCR-03 invitation state).

## Edge cases

| Case | Behaviour |
|---|---|
| Password of 9 characters | Blocked client-side with «The password must be at least 10 characters long»; server 400 shows the same under the field |
| Blank name on the new-account form | Field error, nothing submitted |
| Wrong existing password or locked-out email | One alert «Email or password is incorrect», password cleared |
| Invitation revoked between lookup and submit | `404 INVITATION_INVALID` on submit → SCR-03 in place |
| First-owner invitation expired | SCR-03 «… ask the tg-inbox team for a new one» (`ask: tg_inbox_team`) |
| Device signed in with another email | SCR-03 «another email» with Sign out; no membership added |
| Network failure on lookup | «Something went wrong» + Retry; on submit the form stays filled |

## Definition of Done

- [ ] `AcceptInvitationPage.test.tsx` covers loading, both default forms, submitting, validation, invalid credentials, link unavailable, unexpected error and success navigation.
- [ ] `LinkUnavailable.test.tsx` covers both `ask` variants and the another-email variant (Sign out reloads the link).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
