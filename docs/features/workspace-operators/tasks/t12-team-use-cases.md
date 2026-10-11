---
id: T12
title: "Implement the team use cases: invite, revoke, list, deactivate, reactivate"
layer: "app"
deps: ["T6", "T7"]
blocks: ["T16"]
acs: ["AC-14", "AC-16", "AC-18", "AC-19", "AC-20"]
files_hint: ["apps/api/src/modules/workspaces/app/team.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T12 — Implement the team use cases: invite, revoke, list, deactivate, reactivate

## Place in the sequence

- **Blocked by:** T6 — Build the workspaces repositories with cross-workspace isolation tests, T7 — Implement the auth credential and session use cases · **Blocks:** T16 — Expose the owner-only team routes · **Wave:** 4 — needs membership/invitation ports and `auth.findAccountIdByEmail` / `getAccountsByIds`.
- **Lane:** own lane (`workspaces/app/team.ts`). The owner-only role check (AC-15) lives in T16's routes, not here.

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

This task delivers the team-management rules, every one scoped by the `workspaceId` the guard granted.

## Inlined context

> Ws->>D: begin, lock the workspace row → Ws->>A: find the account for the normalised email → Ws->>D: read a membership of that account in this workspace
> alt already a member, active or deactivated → already a member
> else not a member → mark any pending invitation for this email in this workspace superseded → insert invitation with role, token hash, 7-day expiry, commit → invitation and its link
>
> — `sad.md §6, flow 8 «Invite a teammate», abridged` · full text: [sad.md](../sad.md)

> Ws->>D: begin, lock the workspace row (concurrent team changes queue on this lock, so two deactivations are judged one after the other) → read the membership in this workspace and count active business owners
> alt membership not in this workspace → not found
> else it would leave no active business owner → last active business owner
> else allowed → set the membership deactivated, commit
> […] reactivate: lock, read; not in this workspace → not found; deactivated member → set the membership active keeping its role, commit
>
> — `sad.md §6, flow 9 «Deactivate and reactivate a member», abridged` · full text: [sad.md](../sad.md)

> read memberships of the workspace with role and state → Ws->>A: names and emails of these accounts → read pending unexpired invitations of the workspace → members and pending invitations, never a token or link
> […] revoke: mark revoked only while pending and in this workspace; not pending any more or not in this workspace → invitation not found
>
> — `sad.md §6, flow 10 «Review the team and revoke an invitation», abridged` · full text: [sad.md](../sad.md)

> Already deactivated → 200 with the unchanged member. / Already active → 200 with the unchanged member. / `listMemberships` ordered by membership id (join order); `listPendingInvitations` ordered by invitation id (creation order).
>
> — `contracts/openapi.yaml, deactivateMembership / reactivateMembership / list operations, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Hard rule:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Hard rule:** The "at least one active owner" rule (AC-18) is **not** a DB constraint: it is checked in the app layer under the workspace row lock (no triggers, SAD §4).
>
> — `data-model.md §Entities, memberships, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Uses through T6's ports:

| Column | Change |
|---|---|
| `memberships.state` / `deactivated_at` (`(state='deactivated') = (deactivated_at IS NOT NULL)`) | `active` ↔ `deactivated`; `role` unchanged |
| `invitations` (`email`, `role`, `token_hash`, `state`, `expires_at` = +7 days, `closed_at`) | insert; earlier pending → `superseded`; pending → `revoked` |
| `workspaces` row | `SELECT … FOR UPDATE` on invite / deactivate / reactivate |

— `data-model.md §Entities, memberships + invitations, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `apps/api/src/modules/workspaces/app/team.ts` — `inviteMember(workspaceId, { email, role })`: normalise, lock workspace, `auth.findAccountIdByEmail`, existing membership → `AlreadyAMemberError` with `details { membership_id, state }`; else supersede the pending invitation for the email and insert a new one (+7 days); return `{ invitation, link: PUBLIC_WEB_URL + '/invite/' + token }`.
- [ ] `revokeInvitation(workspaceId, invitationId)`: conditional update while `pending` and in this workspace; 0 rows → `NotFoundError`.
- [ ] `listMemberships(workspaceId, page)` (+ `auth.getAccountsByIds` for name/email) and `listPendingInvitations(workspaceId, page)` (pending and `expires_at > now`, no token/link).
- [ ] `deactivateMembership(workspaceId, membershipId)`: lock workspace; not in workspace → `NotFoundError`; already deactivated → return unchanged; would leave zero active owners (T4 rule) → `LastActiveOwnerError`; else set deactivated. `reactivateMembership`: lock; not found → `NotFoundError`; set active, role kept.
- [ ] Unit tests `team.test.ts` with port fakes: AC-14, AC-16 (active + deactivated), AC-18 self/other, AC-19, AC-20 (no link field).
- [ ] Integration test `team.int.test.ts`: two concurrent deactivations of the only two owners → exactly one succeeds; revoked invitation's token no longer pending; isolation — ids from another workspace → `NotFoundError`.

## Edge cases

| Case | Behaviour |
|---|---|
| Invite the same email twice | Second supersedes the first; one pending row |
| Invite an email with a deactivated membership | `AlreadyAMemberError`, `details.state = deactivated` |
| Owner deactivates self, another active owner exists | Allowed |
| Deactivate the last active owner | `LastActiveOwnerError`, nothing changed |
| Membership / invitation id of another workspace | `NotFoundError` |
| Revoke an already accepted / expired-superseded invitation | `NotFoundError` (not pending) |
| Expired pending invitation | Not listed in pending invitations |

## Definition of Done

- [ ] Unit + integration tests pass, asserting AC-14, AC-16, AC-18, AC-19, AC-20
- [ ] Every function takes `workspaceId` and never touches rows of another workspace
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
