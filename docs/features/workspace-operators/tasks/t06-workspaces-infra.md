---
id: T6
title: "Build the workspaces repositories with cross-workspace isolation tests"
layer: "infra"
deps: ["T1", "T2", "T4"]
blocks: ["T9", "T10", "T11", "T12"]
acs: ["AC-13", "AC-16", "AC-18"]
files_hint: ["apps/api/src/modules/workspaces/app/ports.ts", "apps/api/src/modules/workspaces/infra/", "apps/api/src/test/fixtures.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
---

# T6 — Build the workspaces repositories with cross-workspace isolation tests

## Place in the sequence

- **Blocked by:** T1 — Promote the seven staged migrations and regenerate DB types, T2 — Add platform primitives, T4 — Implement the auth and workspaces domain rules · **Blocks:** T9 — Implement create-workspace and re-issue-owner-invitation use cases, T10 — Implement invitation lookup and acceptance, T11 — Implement workspace access, T12 — Implement the team use cases · **Wave:** 2.
- **Lane:** shares `apps/api/src/test/fixtures.ts` with T5 — serialized with it (append the workspace fixtures, keep T5's).

## Why (user story)

> **As an** Operator
> **I want** to switch between the workspaces I am a member of
> **So that** I can work for several businesses with one account while seeing only one business's data at a time
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

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

This task builds the tenant-owned persistence every workspace use case runs on, and proves with tests that no repository method ever reads or changes another workspace's rows.

## Inlined context

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Three `workspaces` repository reads cannot take a `workspaceId` because they are what *produce* it … each with its own isolation test: *memberships of an account* — scoped by the signed-in account id; returns only that account's memberships and the names of their workspaces · *invitation by token hash* — scoped by possession of the secret link; returns one invitation and its workspace's name · *membership for the guard* — scoped by (account id, workspace id from the URL). Every other method in `workspaces` takes `workspaceId`; a new exception needs a change to this SAD.
>
> — `sad.md §5, Controlled exceptions to the tenancy rule, abridged` · full text: [sad.md](../sad.md)

> commands that change a workspace's team (deactivate, reactivate, accept the first owner invitation) lock that workspace's row for the length of the transaction, which serialises the "at least one active business owner" check of AC-18; single-use links are consumed with a conditional update that only succeeds while the link is still pending and unexpired
>
> — `sad.md §4, Concurrency, abridged` · full text: [sad.md](../sad.md)

> every `workspaces` repository method gets a Testcontainers test with two workspaces proving it never returns or changes the other workspace's rows
>
> — `sad.md §10, QG-1a How verify, abridged` · full text: [sad.md](../sad.md)

> The one cross-module FK, `memberships.account_id → accounts(id)`, is kept as a constraint only — `workspaces` still never queries `accounts` and goes through `auth`'s app layer.
>
> — `data-model.md §Conventions applied, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Read/write only (tables created by T1):

| Table | Columns used | Access pattern → index |
|---|---|---|
| `workspaces` | `id`, `name`, `created_at` | insert; read + `SELECT … FOR UPDATE` by id → PK |
| `memberships` | `id`, `workspace_id`, `account_id`, `role`, `state`, `last_used_at`, `deactivated_at`, `created_at` | by (workspace, account) → `…_workspace_id_account_id_key`; list / count active owners / "has any member" by `workspace_id`; active of an account with workspace names ordered by `last_used_at` → `memberships_account_id_idx`; set state; set `last_used_at` |
| `invitations` | `id`, `workspace_id`, `email`, `role`, `token_hash`, `state`, `expires_at`, `created_at`, `closed_at` | by token hash + conditional consume `UPDATE … SET state='accepted' WHERE token_hash=$1 AND state='pending' AND expires_at > $now`; supersede pending for (workspace, email) and list pending unexpired → `…_workspace_id_email_pending_key`; latest of a workspace any state → `invitations_workspace_id_idx`; revoke by (id, workspace) while pending |

— `data-model.md §Entities (aggregate workspace), abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

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

## Checklist

- [ ] Port interfaces `WorkspaceRepo`, `MembershipRepo`, `InvitationRepo` + a `UnitOfWork`/transaction runner; every method takes `workspaceId` except the three named exceptions (`listActiveOfAccount`, `findByTokenHash`, `findForGuard`) — `apps/api/src/modules/workspaces/app/ports.ts`
- [ ] Kysely implementations incl. `lockForUpdate(workspaceId, tx)`, cursor paging (`after` / `before` / `limit`, ordered by id) for lists — `apps/api/src/modules/workspaces/infra/{workspace,membership,invitation}-repo.ts`
- [ ] Fixtures `insertWorkspace`, `insertMembership`, `insertInvitation` (returns raw token), `twoWorkspaces` — `apps/api/src/test/fixtures.ts` (keep T5's auth fixtures)
- [ ] Isolation tests: every method run against `twoWorkspaces()` asserting it never returns or changes the other workspace's rows; one dedicated test per controlled exception — `apps/api/src/modules/workspaces/infra/*.int.test.ts`
- [ ] Lock test: two concurrent transactions on `lockForUpdate` of the same workspace run one after the other (AC-18 serialisation) — `membership-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `findMembership(workspaceB, account)` for an account only in A | returns none — AC-13 |
| Revoke invitation id of workspace A called with workspace B | 0 rows changed, reported "not found" |
| `listActiveOfAccount(accountA)` | only A's active memberships, never another account's |
| `findByTokenHash` of an unknown hash | none |
| Conditional consume of an expired or non-pending invitation | 0 rows, state unchanged |
| Insert a second membership for (workspace, account) | unique violation surfaced — AC-16 backstop |
| `countActiveOwners` | counts `role='owner' AND state='active'` within the workspace only |

## Definition of Done

- [ ] every repository method has a passing two-workspace isolation test; the three exceptions each have their own
- [ ] the concurrent-lock integration test passes
- [ ] no query in `workspaces/infra` touches `accounts`, `sessions` or any `auth` table
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
