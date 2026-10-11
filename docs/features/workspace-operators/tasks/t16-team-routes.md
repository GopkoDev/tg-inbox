---
id: T16
title: "Expose the owner-only team routes"
layer: "ports"
deps: ["T12", "T14"]
blocks: ["T17"]
acs: ["AC-14", "AC-15", "AC-16", "AC-18", "AC-19", "AC-20"]
files_hint: ["apps/api/src/modules/workspaces/http/team-routes.ts", "apps/api/src/modules/workspaces/http/routes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Expose the owner-only team routes

## Place in the sequence

- **Blocked by:** T12 — Implement the team use cases: invite, revoke, list, deactivate, reactivate · T14 — Expose the workspace guard and the me / workspaces / enter routes · **Blocks:** T17 — Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs · **Wave:** 7 — needs the guard and `ownerOnly` helper from T14.
- **Lane:** shares `apps/api/src/modules/workspaces/http/routes.ts` with T14 and T15 — serialized with T15.

## Why (user story)

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

> **As a** Business owner
> **I want** to see every member and every pending invitation of my workspace and revoke an invitation
> **So that** I always know who has or is about to get access
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task exposes the six owner-only team routes behind the guard plus the role check.

## Inlined context

> Workspace-scoped routes live under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard: never a member → not found, deactivated → access-removed refusal, active → `{ workspaceId, role }`; owner-only routes add a role check (`ForbiddenError`)
>
> — `sad.md §8, Authorization row, abridged` · full text: [sad.md](../sad.md)

> **QG-1a** How verify: every route under `/api/workspaces/:workspaceId/…` gets an `app.inject()` test calling it with a session that belongs to the other workspace.
>
> — `sad.md §10, QG-1a, abridged` · full text: [sad.md](../sad.md)

> Each link carries 32 random bytes; only their SHA-256 hash is stored; the link is shown exactly once (in the API response to the business owner right after creation […])
>
> — `sad.md §8, Invitation and reset links row, abridged` · full text: [sad.md](../sad.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

All under the guard + owner check; shared errors `401 UNAUTHENTICATED`, `403 ACCESS_REMOVED` / `403 OWNER_ONLY` («Only business owners manage the team»), `404 NOT_FOUND`.

- `GET /api/workspaces/{workspaceId}/memberships` (`listMemberships`; `after`/`before`/`limit`) → `200 MembershipPage` items `{id, display_name, email, role, state, created_at, deactivated_at}`, ordered by membership id.
- `POST …/memberships/{membershipId}/deactivate` (`deactivateMembership`) → `200 Membership` (already deactivated → unchanged) · `404` not in this workspace · `409 LAST_ACTIVE_OWNER`.
- `POST …/memberships/{membershipId}/reactivate` (`reactivateMembership`) → `200 Membership` (already active → unchanged) · `404`.
- `GET /api/workspaces/{workspaceId}/invitations` (`listPendingInvitations`; paging) → `200 PendingInvitationPage` items `{id, email, role, created_at, expires_at}` — never a link or token.
- `POST /api/workspaces/{workspaceId}/invitations` (`createInvitation`) — body `{email: EmailInput, role}` → `201 IssuedInvitation {invitation, link}` (the only time the link is returned) · `400 VALIDATION_ERROR` · `409 ALREADY_A_MEMBER` with `details {membership_id, state}`.
- `POST …/invitations/{invitationId}/revoke` (`revokeInvitation`) → `204` · `404` when not pending or not in this workspace.

— `contracts/openapi.yaml, operationIds listMemberships / deactivateMembership / reactivateMembership / listPendingInvitations / createInvitation / revokeInvitation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to invite someone or manage the team
> **Then** the system refuses and tells them that only business owners manage the team
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
> **When** the owner invites that person's email
> **Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — domain invariant

> **Given** "Acme Flowers" has active business owners
> **When** any deactivation — of oneself or of another owner, including two deactivations made at the same moment — would leave the workspace with no active business owner
> **Then** the system refuses that deactivation and explains that a workspace must always have at least one active business owner (of two simultaneous deactivations at most the one that keeps an active owner succeeds); an owner may deactivate themselves while another active business owner remains
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — happy path

> **Given** a deactivated member of "Acme Flowers"
> **When** a business owner reactivates them
> **Then** the member regains access to "Acme Flowers" with the role they had before
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

### AC-20 — happy path

> **Given** a business owner of "Acme Flowers" with three members and one pending invitation
> **When** they open the team list and revoke the pending invitation
> **Then** they see each member's name, email, role and state and each pending invitation's email, role and expiry (but not its link), the revoked invitation disappears from the pending list, and its link stops working
>
> — `spec.md §5, AC-20, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/workspaces/http/team-routes.ts` — the six routes with the T3 schemas, each behind `workspaceGuard` + `ownerOnly` (T14); pass `request.workspace.workspaceId` to the T12 use cases; build `link` from `PUBLIC_WEB_URL` + `/invite/` + token.
- [ ] `apps/api/src/modules/workspaces/http/routes.ts` — register the team routes inside `registerWorkspaces`.
- [ ] `apps/api/src/modules/workspaces/http/team-routes.int.test.ts` — AC-14 (201 + link, earlier pending invitation superseded), AC-15 (operator → `403 OWNER_ONLY` on all six), AC-16 (`409` for active and deactivated), AC-18 (self-deactivation allowed with a second owner; last owner → `409`; two parallel deactivations of the last two owners → exactly one `200`), AC-19 (role kept), AC-20 (lists without link; revoked disappears; revoked link → `404 INVITATION_INVALID` on lookup); QG-1a — each route with another workspace's session → `404`, and with a foreign `membershipId` / `invitationId` → `404`.

## Edge cases

| Case | Behaviour |
|---|---|
| `membershipId` / `invitationId` from another workspace | `404 NOT_FOUND`, nothing changed |
| Revoke an already accepted / revoked / superseded invitation | `404 NOT_FOUND` |
| Deactivate an already deactivated member | `200` unchanged |
| Reactivate an active member | `200` unchanged |
| Invite email with spaces / upper case | Normalised; matches an existing member → `409` |
| Unknown role in body | `400 VALIDATION_ERROR` |
| Deactivated owner calls any team route | `403 ACCESS_REMOVED` (guard first) |

## Definition of Done

- [ ] `team-routes.int.test.ts` passes for AC-14, AC-15, AC-16, AC-18, AC-19, AC-20 and the QG-1a isolation cases for every route
- [ ] No list response contains a link or token
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
