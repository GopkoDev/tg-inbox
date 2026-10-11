---
id: T15
title: "Expose the invitation lookup and acceptance routes"
layer: "ports"
deps: ["T10", "T14"]
blocks: ["T17"]
acs: ["AC-03", "AC-04", "AC-04b", "AC-05", "AC-06"]
files_hint: ["apps/api/src/modules/workspaces/http/invitation-routes.ts", "apps/api/src/modules/workspaces/http/routes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T15 — Expose the invitation lookup and acceptance routes

## Place in the sequence

- **Blocked by:** T10 — Implement invitation lookup and acceptance · T14 — Expose the workspace guard and the me / workspaces / enter routes · **Blocks:** T17 — Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs · **Wave:** 7 — plugs into `registerWorkspaces` created by T14.
- **Lane:** shares `apps/api/src/modules/workspaces/http/routes.ts` with T14 and T16 — serialized with T16.

## Why (user story)

> **As an** Operator
> **I want** to accept an invitation link and set up my access
> **So that** I become a member of the business's workspace with the role I was invited for
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task puts invitation lookup and acceptance on HTTP — public routes that read an optional session and sign the device in on success.

## Inlined context

> For an existing account the password is verified by `auth` before the acceptance transaction opens, exactly as at sign-in — a wrong password is recorded as a failure and committed on its own, so it counts toward the AC-09 lockout, and a locked-out email is refused with the generic credentials error; nothing else changes. A password shorter than 10 characters is rejected before anything is written (AC-05). If the invitation is revoked or consumed between the password check and the transaction, the conditional consume fails and the person gets the «no longer valid» answer (AC-06).
>
> — `sad.md §6, critical flow 2 prose, verbatim` · full text: [sad.md](../sad.md)

> public routes (sign-in, invitation lookup and acceptance, reset-link redemption) are explicit
>
> — `sad.md §8, Authentication row, abridged` · full text: [sad.md](../sad.md)

> The token travels in the body so it never appears in request logs.
>
> — `contracts/openapi.yaml, operationId lookUpInvitation description, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod` […].
>
> — `CLAUDE.md §Rules, Contracts, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST /api/invitations/lookup` (`lookUpInvitation`; session cookie optional) — body `{token: LinkToken}` → `200 InvitationPreview {workspace_name, email, role, account_exists}` · errors: `400 VALIDATION_ERROR`, `403 INVITATION_FOR_ANOTHER_EMAIL` (signed-in account's email differs), `404 INVITATION_INVALID` with `details.ask: business_owner | tg_inbox_team` (`tg_inbox_team` when the workspace has no memberships; unknown token → `business_owner`).
- `POST /api/invitations/accept` (`acceptInvitation`; session cookie optional) — body `InvitationAccept {token, password (10–1024), display_name? (1–200, required only when no account exists)}` → `200 WorkspaceSummary {id, name, role}` + `Set-Cookie` session (an existing cookie on the device is replaced and its session ended) · errors: `400 VALIDATION_ERROR` (`details.field: password | display_name`, nothing written), `401 INVALID_CREDENTIALS` (wrong existing password **or** locked-out email), `403 INVITATION_FOR_ANOTHER_EMAIL`, `404 INVITATION_INVALID`.

— `contracts/openapi.yaml, operationIds lookUpInvitation / acceptInvitation + responses InvitationInvalid, InvitationForAnotherEmail, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

- [ ] `apps/api/src/modules/workspaces/http/invitation-routes.ts` — the two routes with the T3 schemas; an optional-session variant of the T13 resolver (no session → anonymous, never `401`); call T10 `lookUpInvitation` / `acceptInvitation`; on accept set the session cookie via the auth cookie helper.
- [ ] `apps/api/src/modules/workspaces/http/routes.ts` — register the invitation routes inside `registerWorkspaces`.
- [ ] `apps/api/src/modules/workspaces/http/invitation-routes.int.test.ts` — `app.inject()`: AC-03 new account → `200` + cookie + membership; AC-04 existing account (incl. signed in on this device) → other memberships unchanged; AC-04b → `403`, no membership; AC-05 → `400 field: password`, no account row; AC-06 expired / accepted / revoked / superseded → `404` with the right `details.ask`; wrong existing password counts toward lockout.

## Edge cases

| Case | Behaviour |
|---|---|
| Unknown or malformed token | `404 INVITATION_INVALID`, `ask: business_owner` (malformed → `400`) |
| First-owner invitation expired | `404`, `ask: tg_inbox_team` |
| Invitation revoked between lookup and accept | `404 INVITATION_INVALID` on accept |
| Existing account, locked-out email | `401 INVALID_CREDENTIALS`, nothing written |
| `display_name` missing when no account exists | `400 field: display_name`, nothing written |
| `display_name` sent for an existing account | Ignored |
| Device already signed in as the invited email | Old session ended, new cookie set |

## Definition of Done

- [ ] `invitation-routes.int.test.ts` passes for AC-03, AC-04, AC-04b, AC-05, AC-06
- [ ] Tokens appear only in request bodies and never in logs
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
