---
id: T7
title: "Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09"
layer: "app"
deps: ["T1", "T3"]
blocks: ["T8", "T16"]
acs: ["AC-01", "AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/workspaces/", "apps/api/src/cli/commands/workspace-create.ts", "apps/api/migrations/", "docs/features/shared-inbox/migrations/09_contract_memberships_active_since.up.sql", "apps/api/src/test/fixtures/workspaces.ts", "apps/api/src/platform/db.types.gen.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09

## Place in the sequence

- **Blocked by:** T1 — Promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures, T3 — Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync · **Blocks:** T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10, T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Wave:** 2 — after T1, T3.
- **Lane:** shares `apps/api/migrations/` and `db.types.gen.ts` with T1 and T8 — serialized after T1, before T8.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It gives the inbox the unread floor (active-since), the role for owner-only hints, the names on replies and the signal that ends a deactivated member's live stream.

## Inlined context

> `inbox` → `workspaces`: the existing workspace guard (now also returning the membership's role and active-since time) on every route and on the socket upgrade; *active members among accounts* (socket re-validation, delivery pre-check); *member display names* (reply authorship).
>
> — `sad.md §5, Cross-module app-layer calls, verbatim` · full text: [sad.md](../sad.md)

> `bots` and `workspaces` publish bot-state and membership-deactivation signals
>
> — `sad.md §5, Cross-module app-layer calls, abridged` · full text: [sad.md](../sad.md)

> | `active_since` | timestamptz | NOT NULL (after contract) | Set at join and on reactivation, and kept on deactivation. The unread floor (AC-01: messages that arrived before the member joined or was reactivated count as read). Returned with the guard result. Backfilled from `created_at` |
>
> — `data-model.md §memberships — changed, verbatim` · full text: [data-model.md](../data-model.md)

> `09` and `10` must not run before the code that writes `active_since` (join, reactivation, the first-owner CLI) […] the contract migrations land in the same task or PR as that code and the fixture updates (`insertMembership`, `insertConversation`).
>
> — `_audit/data-model-2026-10-18.md, Ordering with code, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> Five reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) […] a new exception needs a change to the SAD.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> No new controlled tenancy exception: the delivery job carries its workspace id; the socket re-validation reads memberships by (workspace id, account ids); every new repository method takes `workspaceId`.
>
> — `sad.md §5, Table ownership, verbatim` · full text: [sad.md](../sad.md)

> Publishing goes through a `platform/realtime` publisher that takes the caller's transaction, so modules stay unaware of `inbox`
>
> — `adr/0003, Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `memberships.active_since` | timestamptz | NOT NULL after `09` | written on join (invitation accept, first-owner CLI) and reactivation; kept on deactivation |

Staged pair promoted here: `docs/features/shared-inbox/migrations/09_contract_memberships_active_since.{up,down}.sql` (`ALTER COLUMN active_since SET NOT NULL` / `DROP NOT NULL`). Fixture `insertMembership(db, workspaceId, { …, activeSince? })` defaults to `T0` and changes in this task.

— `data-model.md §memberships + §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. (Feeds the guard result used by every inbox route and `openLiveSocket`; `MemberRef.display_name` — «kept after a deactivation» — `openapi.yaml components.schemas.MemberRef`.)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member of "Acme Flowers", or someone not signed in
> **When** they try to open the inbox of "Acme Flowers", one of its conversations or one of its customers' media, or to send a reply in it (for example through a saved link)
> **Then** the system refuses and shows no conversation, message, media or customer of "Acme Flowers"; an account of another workspace gets no hint that the workspace or the conversation exists; a deactivated member gets the access-removed notice they already get elsewhere in the panel (they know the workspace, but see nothing of it); someone not signed in is asked to sign in first; nothing is sent to any end customer
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Write `active_since = now` on invitation accept and reactivation, and in the first-owner CLI path — `modules/workspaces/app/accept-invitation.ts`, `app/team.ts`, `app/admin.ts`, `cli/commands/workspace-create.ts`
- [ ] Guard returns `{ workspaceId, role, activeSince }` and `request.workspace` carries it — `modules/workspaces/app/access.ts`, `http/guard.ts`
- [ ] Add `activeMembersAmong(workspaceId, accountIds)` and `displayNames(workspaceId, accountIds)` (names kept for deactivated members) to the app layer + membership repo, each with a cross-workspace isolation test — `modules/workspaces/app/`, `infra/membership-repo.ts`
- [ ] Publish `membership.deactivated { workspace_id, account_id }` with `platform/realtime` inside the deactivation transaction — `modules/workspaces/app/team.ts`
- [ ] Promote `09` (`pnpm db:new contract_memberships_active_since`), migrate/rollback, `pnpm db:codegen`; update `insertMembership` — `apps/api/migrations/`, `test/fixtures/workspaces.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member reactivated | `active_since` moves to the reactivation time — earlier messages count as read (AC-01) |
| Member deactivated | `active_since` kept; signal published only if the transaction commits |
| `activeMembersAmong` with an account of another workspace | not returned (isolation test) |
| Display name of a deactivated author | still returned |

## Definition of Done

- [ ] unit + integration tests: active-since on join / reactivation / CLI, guard result, both lookups isolated by workspace, deactivation signal on commit only
- [ ] staged `09` is promoted to live `migrations/`, then applies and reverts cleanly; types regenerated
- [ ] existing workspaces and team tests still pass
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
