---
id: T24
title: "Build SCR-07 team screen"
layer: "ui"
deps: ["T23"]
blocks: ["T25"]
acs: ["AC-15", "AC-17", "AC-18", "AC-19", "AC-20"]
files_hint: ["apps/web/src/features/workspaces/team/", "apps/web/src/pages/TeamPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T24 — Build SCR-07 team screen

## Place in the sequence

- **Blocked by:** T23 — Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher · **Blocks:** T25 — Build SCR-08 invite member dialog · **Wave:** 5.
- **Lane:** shares `apps/web/src/pages/TeamPage.tsx` with T25 — serialized. Replaces T20's stub `TeamPage`; does **not** touch `routes.tsx` (`/w/:workspaceId/team` already exists).

## Why (user story)

> **As a** Business owner
> **I want** to see every member and every pending invitation of my workspace and revoke an invitation
> **So that** I always know who has or is about to get access
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to deactivate a member who left and reactivate them if they return
> **So that** former staff lose access to our customers at once
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task delivers the team screen: both lists, deactivate / reactivate / revoke with confirmation, and the owner-only refusal.

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**SCR-07 — Team** (states to build; guard `401`/`403 ACCESS_REMOVED`/`404` go to the shared guard handler of T19):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | `listMemberships` + `listPendingInvitations` in flight | NEW: AppShell, shadcn:skeleton (table rows) |
> | default | Both lists loaded — **Members**: name, email, role badge, state badge, row action (**Deactivate** for active, **Reactivate** for deactivated); **Pending invitations**: email, role badge, «expires <date>», **Revoke**; never a link; **Invite** button in the section header | NEW: AppShell, shadcn:table, shadcn:badge, Button |
> | empty: no pending invitations | «No pending invitations» line in that section | shadcn:table (single muted row) |
> | confirm deactivate | «Deactivate Bob? Bob loses access to Acme Flowers at once. You can reactivate them later.» Cancel / Deactivate | shadcn:alert-dialog |
> | confirm revoke | «Revoke the invitation for bob@x.test? Its link stops working.» Cancel / Revoke | shadcn:alert-dialog |
> | pending action | `deactivateMembership` / `reactivateMembership` / `revokeInvitation` in flight — that row's button spinner, other row actions disabled | Button (disabled + `Loader2`) |
> | success | Deactivated → row state badge «Deactivated», action «Reactivate»; reactivated → «Active» with the previous role; revoked → row removed from pending | shadcn:badge, shadcn:table |
> | error: last active owner | `409 LAST_ACTIVE_OWNER` — the dialog closes, an alert above Members: «A workspace must always have at least one active business owner» | shadcn:alert (destructive) |
> | error: stale row | `404 NOT_FOUND` on deactivate / reactivate / revoke — alert «This item has changed — the list was refreshed» and both lists reload | shadcn:alert (default) |
> | error: owners only | `403 OWNER_ONLY` on any team call — the body shows only «Only business owners manage the team» + **Back to home**; no list is rendered | Card, Button |
> | self-deactivated | The owner deactivated themselves while another active owner remains → `200`; the next request answers `403 ACCESS_REMOVED` → shared guard handler | — |
> | has-more | `has_next: true` on either list (fetched with `limit=100`) — **Show more** under that list | Button (`variant="outline"`) |
> | error: unexpected | network failure / `500` on a list load — «Something went wrong» + Retry; on an action — alert, the row keeps its old state | shadcn:alert (destructive), Button |
>
> The signed-in owner's own row carries a «(you)» label and offers **Deactivate** like any other row; the server decides. Phone: email + role move under the name (`hidden md:table-cell`).
>
> — `screens.md §SCR-07, state table + notes, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T16):

- `GET /api/workspaces/{workspaceId}/memberships` (`listMemberships`) → `200 MembershipPage` (items: `id, display_name, email, role, state, created_at, deactivated_at`).
- `GET /api/workspaces/{workspaceId}/invitations` (`listPendingInvitations`) → `200 PendingInvitationPage` (items: `id, email, role, created_at, expires_at`).
- `POST …/memberships/{membershipId}/deactivate` (`deactivateMembership`) → `200 Membership` · `409 LAST_ACTIVE_OWNER`.
- `POST …/memberships/{membershipId}/reactivate` (`reactivateMembership`) → `200 Membership`.
- `POST …/invitations/{invitationId}/revoke` (`revokeInvitation`) → `204`.
- All: `401`, `403 ACCESS_REMOVED | OWNER_ONLY`, `404 NOT_FOUND`; list reads take `after`, `limit` and are sent with `X-Background-Request: 1` when refetched automatically.

— `contracts/openapi.yaml, operationId listMemberships / listPendingInvitations / deactivateMembership / reactivateMembership / revokeInvitation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-15 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to invite someone or manage the team
> **Then** the system refuses and tells them that only business owners manage the team
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `apps/web/src/features/workspaces/team/`: data hooks for both lists (store-backed, Show more paging), `MembersTable`, `PendingInvitationsTable`, confirm dialogs, row action state.
- [ ] Error mapping: `409` → last-active-owner alert; `404` on an action → stale-row alert + reload both lists; `403 OWNER_ONLY` → owners-only body; guard answers → T19 `handleGuardError`.
- [ ] `apps/web/src/pages/TeamPage.tsx`: replace T20's stub inside the AppShell; leave an `onInvite` slot on the **Invite** button for T25.
- [ ] Tests: `TeamPage.test.tsx` — one test per SCR-07 state, including «no link ever rendered» for pending invitations.

## Edge cases

| Case | Behaviour |
|---|---|
| Deactivating the last active owner (incl. oneself) | `409` → alert «A workspace must always have at least one active business owner»; row unchanged |
| Owner deactivates themselves while another owner remains | `200`, then next call `403 ACCESS_REMOVED` → shared guard handler moves them on |
| Row already changed by another owner | `404` → «This item has changed — the list was refreshed», both lists reload |
| Operator opens `/w/<id>/team` by address | `403 OWNER_ONLY` → «Only business owners manage the team» + Back to home, no list |
| Reactivated member | Badge «Active» with the role returned by the server (unchanged) |
| No pending invitations | «No pending invitations» row |

## Definition of Done

- [ ] `TeamPage.test.tsx` covers every SCR-07 state listed above.
- [ ] A test asserts pending rows show email, role and expiry and contain no link (AC-20).
- [ ] A test asserts the owners-only body renders no list on `403 OWNER_ONLY` (AC-15).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
