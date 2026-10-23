---
id: T5
title: "Give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction"
layer: "app"
deps: []
blocks: ["T10", "T12"]
acs: ["AC-04", "AC-10", "AC-11"]
files_hint: ["apps/api/src/modules/workspaces/app/access.ts", "apps/api/src/modules/workspaces/app/access.test.ts", "apps/api/src/modules/workspaces/app/access.int.test.ts", "apps/api/src/modules/workspaces/app/team.ts", "apps/api/src/modules/workspaces/app/team.test.ts", "apps/api/src/modules/workspaces/app/team.int.test.ts", "apps/api/src/modules/workspaces/app/ports.ts", "apps/api/src/modules/workspaces/infra/membership-repo.ts", "apps/api/src/modules/workspaces/infra/membership-repo.int.test.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T5 — Give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction

## Place in the sequence

- **Blocked by:** — · **Blocks:** T10 — Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps, T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers · **Wave:** 1 — no upstream task.
- **Lane:** shares `apps/api/src/deps.ts` with T10 and T13 — serialized; T5 passes a no-op port that T10 replaces.

## Why (user story)

> **As a** Business owner
> **I want** a deactivated member's conversations to return to the team automatically
> **So that** no customer waits on someone who no longer works here
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It gives the inbox the share-locks that make an assignment and a deactivation serialise, and gives deactivation the hook that returns the member's conversations to the team.

## Inlined context

> - `workspaces` declares a port `onMembershipDeactivated(tx, { workspaceId, accountId, at })`. `buildDeps()` wires it to `conversations.unassignDeactivatedMember`, which in the same transaction unassigns every conversation of that workspace assigned to the account […]. `workspaces` imports nothing from `conversations`, so the dependency direction holds.
> - A member change locks the actor's membership, and for an assignment the target's membership, `FOR SHARE` through `workspaces.lockActiveMembers(tx, workspaceId, accountIds)`, before it locks the conversation.
> - A deactivation, as today, locks the workspace row (`workspaces.lockForUpdate`) and then `UPDATE`s the membership's state. That `UPDATE`'s row lock conflicts with `FOR SHARE`, so the two serialise.
>
> — `sad.md §4, choice 5, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. It is atomic, keeps the dependency direction (`workspaces` declares the interface and imports nothing from `conversations`), and matches the existing `publish` callback pattern.
>
> — `adr/0005 §Decision outcome, abridged` · full text: [ADR-0005](../adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md)

> `GET /api/workspaces/{workspaceId}/memberships` (workspace-operators, `team-routes.ts`) does **not** serve the chooser: it is behind `ownerOnly` […]; it lists deactivated members too and carries `email`, `role`, `state` […]. So the contract adds `listActiveMembers` under the inbox, backed by the new `workspaces` app-layer `activeMembers(workspaceId)` (sad.md §5). The existing `access.activeMembersAmong(workspaceId, accountIds)` and `displayNames(…)` stay the building blocks for the share-locked check and the names.
>
> — `contracts/api-sync-report.md §Existing endpoint check, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> `buildDeps()` must build `conversations` before `team` to fill the deactivation port, and a test fake must exist for `workspaces` unit tests.
>
> — `sad.md §11, Risks, abridged` · full text: [sad.md](../sad.md)

> **Member change:** (1) memberships `FOR SHARE`; (2) the conversation row `FOR UPDATE`; (3) the `changes:<ws>:<account>` advisory lock, after the no-op, version and close checks; (4) the activity insert.
> **Deactivation:** (1) the workspace row `FOR UPDATE`; (2) the membership `UPDATE`, whose row lock conflicts with `FOR SHARE`; (3) the conversation rows assigned to the member (`UPDATE`); (4) activity inserts.
> **Capture:** contact upsert and message insert (unique key), then the conversation row (the raise `UPDATE`, returning status).
> **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.
>
> — `sad.md §8, Concurrency, abridged` · full text: [sad.md](../sad.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Reads and locks `memberships` (`state`, `active_since`) through the existing `memberships_workspace_id_account_id_key`; the active-members read is by workspace, filtered on `state = 'active'` (tens of rows).

— `data-model.md §Reused indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. The HTTP read `GET …/inbox/members` (`listActiveMembers`) is T12; it answers `MemberRef[]` ordered by display name, then account id.

## Acceptance criteria

### AC-04 — error

> **Given** an operator of "Acme Flowers" choosing an assignee for a conversation
> **When** the person they pick is no longer an active member of "Acme Flowers" (deactivated a moment ago), or belongs to another workspace
> **Then** nothing changes, the inbox says that a conversation can be assigned only to an active member of this workspace, and the list of members to choose from shows only active members of "Acme Flowers"
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `lockActiveMembers(tx, workspaceId, accountIds)` — `SELECT … FOR SHARE` on the memberships of those accounts in that workspace, returns the active ones — `workspaces/infra/membership-repo.ts`, `workspaces/app/access.ts`
- [ ] `activeMembers(workspaceId)` → `{ accountId, displayName }[]` ordered by display name, then account id — `access.ts`
- [ ] Declare `OnMembershipDeactivated = (tx, { workspaceId, accountId, at }) => Promise<void>` in team deps; call it after the membership `UPDATE` and before `publish(membership.deactivated)`, inside the unit of work — `workspaces/app/ports.ts`, `team.ts`
- [ ] Pass a no-op port from `buildDeps()` for now (T10 wires `conversations.unassignDeactivatedMember`) — `apps/api/src/deps.ts`
- [ ] Unit tests with a port fake (called once, with the right ids; not called on the refusals) — `team.test.ts`; integration tests: FOR SHARE blocks a concurrent deactivation `UPDATE`, isolation by workspace, port error rolls back — `team.int.test.ts`, `access.int.test.ts`, `membership-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Account active in workspace B, asked for in A | not returned (no hint about B) |
| Deactivation refused (last active owner, already deactivated) | port not called |
| Port throws | the whole deactivation rolls back; no `membership.deactivated` signal |
| Concurrent `lockActiveMembers` and deactivation of the same member | one waits for the other; the lock taker sees the committed state |

## Definition of Done

- [ ] Unit and integration tests prove lockActiveMembers takes FOR SHARE and returns only active accounts of that workspace, activeMembers lists active members ordered by display name then account id, both isolated by workspace, and deactivateMembership calls the port once inside its transaction (a throwing port rolls the deactivation back).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
