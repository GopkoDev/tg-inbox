---
id: T11
title: "Implement workspace access: guard check, my workspaces, enter"
layer: "app"
deps: ["T6", "T7"]
blocks: ["T14"]
acs: ["AC-07", "AC-10", "AC-12", "AC-13", "AC-17"]
files_hint: ["apps/api/src/modules/workspaces/app/access.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Implement workspace access: guard check, my workspaces, enter

## Place in the sequence

- **Blocked by:** T6 — Build the workspaces repositories with cross-workspace isolation tests, T7 — Implement the auth credential and session use cases · **Blocks:** T14 — Expose the workspace guard and the me / workspaces / enter routes · **Wave:** 4 — needs the membership ports and `auth.getAccount`.
- **Lane:** own lane (`workspaces/app/access.ts`).

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

This task delivers the access check every workspace-scoped request runs plus the reads that resolve which workspace to open.

## Inlined context

> - no membership of this account in this workspace, or a workspace id that does not exist or is malformed → `NotFoundError` (AC-13, indistinguishable from a missing workspace);
> - a deactivated membership → a refusal with its own error code, so the panel can say access to this workspace was removed and move on (AC-17);
> - an active membership → the request carries `{ workspaceId, role }`, which repositories receive as their `workspaceId` […]
>
> The last-used workspace for the next sign-in (AC-07, AC-12) is recorded on the membership when the panel opens a workspace, not in the session.
>
> — `adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md, Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md)

> *memberships of an account* — scoped by the signed-in account id; returns only that account's memberships and the names of their workspaces (sign-in resolution AC-07, the picker and switcher);
> *membership for the guard* — scoped by (account id, workspace id from the URL); this is the lookup that grants a `workspaceId` to everything else (ADR-0003).
>
> — `sad.md §5, Controlled exceptions to the tenancy rule, verbatim` · full text: [sad.md](../sad.md)

> H->>Ws: guard Bolt Bikes for this account
> alt no longer an active member → not found or access removed
> else active member → Ws->>D: set the last-used time on this membership → workspace id and role
>
> — `sad.md §6, flow 7 «Switch to another workspace», abridged` · full text: [sad.md](../sad.md)

> `last_used_at` is written by one explicit request when a workspace is entered, not on every guarded request, so ordinary reads stay write-free.
>
> — `sad.md §6, Flagged for later stages, abridged` · full text: [sad.md](../sad.md)

> `last_used_workspace_id`: The active membership with the latest `last_used_at`; null when none was ever entered or it is no longer active
> `listMyWorkspaces`: active memberships only, ordered by workspace id (creation order).
>
> — `contracts/openapi.yaml, Me / listMyWorkspaces, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Hard rule:** with no cache, a deactivation is effective on the next request
>
> — `sad.md §4, choice 3, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Uses through T6's ports:

| Column | Change |
|---|---|
| `memberships.role`, `state` (by `workspace_id` + `account_id`, UNIQUE) | read (guard) |
| `memberships.last_used_at` | read (ordered, `memberships_account_id_idx`); written by `enterWorkspace` |
| `workspaces.name` | read for the account's workspace list |

— `data-model.md §Entities, memberships, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator with an active account and at least one active membership
> **When** they sign in with the correct email and password
> **Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — authorization

> **Given** an operator whose every membership has been deactivated
> **When** they sign in with the correct email and password
> **Then** the system tells them they no longer have access to any workspace and shows no workspace data
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/workspaces/app/access.ts` — `guardWorkspace(accountId, workspaceId)`: malformed id / no membership → `NotFoundError` (same message as a missing workspace); `deactivated` → `AccessRemovedError`; `active` → `{ workspaceId, role }`. No cache.
- [ ] `getMe(accountId)`: `auth.getAccount` + the active membership with the latest non-null `last_used_at` → `{ account, lastUsedWorkspaceId | null }`.
- [ ] `listMyWorkspaces(accountId, { after?, before?, limit })`: active memberships only, with workspace names, ordered by workspace id, cursor page `{ items, hasNext, hasPrev, nextCursor }`.
- [ ] `enterWorkspace(accountId, workspaceId)`: `guardWorkspace`, then set `last_used_at = clock.now()`; return `{ id, name, role }`.
- [ ] Unit tests `access.test.ts` with port fakes: each guard branch, `lastUsedWorkspaceId` null when that membership is deactivated, empty list for all-deactivated (AC-10), enter updates `last_used_at`.
- [ ] Integration test `access.int.test.ts` on `twoWorkspaces`: guard for workspace B with an account of A → `NotFoundError`; deactivate then guard → `AccessRemovedError` while the other membership still passes (AC-17).

## Edge cases

| Case | Behaviour |
|---|---|
| Workspace id `not-a-uuid` | `NotFoundError`, identical to unknown id |
| Never-member vs unknown workspace | Same error, same message (AC-13) |
| Last-used workspace now deactivated | `lastUsedWorkspaceId: null`; the panel falls back per AC-07 |
| No membership ever entered | `lastUsedWorkspaceId: null` |
| All memberships deactivated | `listMyWorkspaces` → empty items (AC-10) |
| Enter a deactivated workspace | `AccessRemovedError`, `last_used_at` unchanged |

## Definition of Done

- [ ] Unit + integration tests pass, asserting AC-07, AC-10, AC-12, AC-13, AC-17 (server side)
- [ ] The guard reads the database on every call — no cached membership
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
