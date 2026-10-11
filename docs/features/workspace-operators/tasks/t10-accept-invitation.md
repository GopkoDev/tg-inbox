---
id: T10
title: "Implement invitation lookup and acceptance"
layer: "app"
deps: ["T6", "T7"]
blocks: ["T15"]
acs: ["AC-03", "AC-04", "AC-04b", "AC-05", "AC-06"]
files_hint: ["apps/api/src/modules/workspaces/app/accept-invitation.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T10 — Implement invitation lookup and acceptance

## Place in the sequence

- **Blocked by:** T6 — Build the workspaces repositories with cross-workspace isolation tests, T7 — Implement the auth credential and session use cases · **Blocks:** T15 — Expose the invitation lookup and acceptance routes · **Wave:** 4 — it composes T6's invitation/membership ports with T7's `createAccount` / `verifyPassword` / `openSession`.
- **Lane:** own lane (`workspaces/app/accept-invitation.ts`).

## Why (user story)

> **As an** Operator
> **I want** to accept an invitation link and set up my access
> **So that** I become a member of the business's workspace with the role I was invited for
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task delivers the server-side rules of opening and accepting an invitation, atomically across `workspaces` and `auth`.

## Inlined context

> Http->>Ws: check invitation and the signed-in account
> alt expired, used, revoked or replaced → invitation no longer valid
> else signed in with a different email → invitation belongs to another email
> else valid → invited email, role, whether an account exists
> […] Http->>Ws: accept invitation
> opt account exists → Ws->>Auth: verify the existing password, outside any transaction
> Ws->>Db: begin and lock the invitation and its workspace
> opt no account for the email → Ws->>Auth: create account within the transaction
> Ws->>Db: insert active membership and consume the invitation
> Ws->>Auth: open a session within the transaction → commit → joined workspace and session token
>
> — `sad.md §6, critical flow 2 «Accept an invitation», abridged` · full text: [sad.md](../sad.md)

> For an existing account the password is verified by `auth` before the acceptance transaction opens, exactly as at sign-in — a wrong password is recorded as a failure and committed on its own, so it counts toward the AC-09 lockout, and a locked-out email is refused with the generic credentials error; nothing else changes. A password shorter than 10 characters is rejected before anything is written (AC-05). If the invitation is revoked or consumed between the password check and the transaction, the conditional consume fails and the person gets the «no longer valid» answer (AC-06).
>
> — `sad.md §6, prose under critical flow 2, verbatim` · full text: [sad.md](../sad.md)

> *invitation by token hash* — scoped by possession of the secret link; returns one invitation and its workspace's name (AC-03–AC-06);
>
> — `sad.md §5, Controlled exceptions to the tenancy rule, verbatim` · full text: [sad.md](../sad.md)

> **First-owner invitation:** not a column — an invitation is "the first business owner's" while its workspace has no memberships; AC-06's "ask the tg-inbox team" hint and flow 5's refusal both derive it from that.
>
> — `data-model.md §Entities, invitations, verbatim` · full text: [data-model.md](../data-model.md)

> `tg_inbox_team` when the invitation is the first business owner's (its workspace has no memberships: only a platform admin re-issues it); otherwise, including an unknown token, `business_owner`
>
> — `contracts/openapi.yaml, InvitationInvalidError.details.ask, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Hard rule:** Cross-module: call the other module's **app layer** (passed in via the composition root). Never query another module's tables.
>
> — `CLAUDE.md §Rules, Cross-module, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Hard rule:** commands that change a workspace's team (deactivate, reactivate, accept the first owner invitation) lock that workspace's row for the length of the transaction […]; single-use links are consumed with a conditional update that only succeeds while the link is still pending and unexpired; a unique index on the normalised email settles two simultaneous account creations.
>
> — `sad.md §4, Concurrency, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Uses through T6's ports (accounts/sessions only through T7):

| Column | Change |
|---|---|
| `invitations.state` / `closed_at` | `pending` → `accepted` via `UPDATE … WHERE token_hash=$1 AND state='pending' AND expires_at > $now` |
| `memberships` (`workspace_id`, `account_id`, `role` = invitation role, `state` = `active`, `created_at`) | insert; UNIQUE (`workspace_id`, `account_id`) |
| `workspaces` row | `SELECT … FOR UPDATE` |

— `data-model.md §Entities, invitations + memberships, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

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

- [ ] `apps/api/src/modules/workspaces/app/accept-invitation.ts` — `lookUpInvitation(token, signedInAccount?)`: hash, find by token hash; unknown / not pending / expired → `InvitationInvalidError` with `details.ask` (`tg_inbox_team` when the workspace has no memberships, else `business_owner`); signed-in account email ≠ invited email → `InvitationForAnotherEmailError`; else `{ workspaceName, email, role, accountExists }` (via `auth.findAccountIdByEmail`).
- [ ] `acceptInvitation({ token, password, displayName? }, signedInAccount?)`: password policy (T4) → `ValidationError` field `password` before any write; repeat the lookup checks; existing account → `auth.verifyPassword` outside the transaction (`InvalidCredentialsError` on wrong/locked); one transaction: lock workspace, conditional consume (0 rows → `InvitationInvalidError`), `auth.createAccount(…, tx)` when none (missing/blank `displayName` → `ValidationError` field `display_name`), insert active membership with the invited role, `auth.openSession(accountId, tx)`; return `{ workspace: { id, name, role }, sessionToken }`.
- [ ] Unit tests `accept-invitation.test.ts` with port fakes: AC-03, AC-04 (other memberships untouched), AC-04b, AC-05 (no write), AC-06 for each of expired / accepted / revoked / superseded and both `ask` values.
- [ ] Integration test `accept-invitation.int.test.ts`: revoke between password check and transaction → `InvitationInvalidError` and no membership; two concurrent accepts → one membership.

## Edge cases

| Case | Behaviour |
|---|---|
| Invitation 7 days + 1 s old (still `pending`) | `InvitationInvalidError` |
| Unknown token | `InvitationInvalidError`, `ask: business_owner` |
| First-owner invitation expired | `InvitationInvalidError`, `ask: tg_inbox_team` |
| Signed-in device, same email as invited | Allowed; the old session is replaced by the caller (T15) |
| Existing account, wrong password | `InvalidCredentialsError`; failure counted toward AC-09 |
| Existing account, email locked out | `InvalidCredentialsError` (same generic answer) |
| `display_name` sent for an existing account | Ignored |
| Account created concurrently for the same email | UNIQUE email fails the transaction; nothing half-written |

## Definition of Done

- [ ] Unit + integration tests pass, asserting AC-03, AC-04, AC-04b, AC-05, AC-06
- [ ] `workspaces` never touches `accounts` / `sessions` / `sign_in_failures` directly — only T7's functions
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
