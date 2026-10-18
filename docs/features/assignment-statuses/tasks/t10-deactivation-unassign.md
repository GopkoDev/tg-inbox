---
id: T10
title: "Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps"
layer: "app"
deps: ["T5", "T7"]
blocks: ["T13", "T24"]
acs: ["AC-10"]
files_hint: ["apps/api/src/modules/conversations/app/state-changes.ts", "apps/api/src/modules/conversations/app/state-changes.int.test.ts", "apps/api/src/modules/conversations/infra/conversation-repo.ts", "apps/api/src/deps.ts", "apps/api/src/modules/workspaces/app/team.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T10 — Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps

## Place in the sequence

- **Blocked by:** T5 — Give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction, T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal · **Blocks:** T13 — Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 4 — after T5, T7.
- **Lane:** shares `state-changes.ts` with T7 / T8 / T9, `conversation-repo.ts` with T6 / T8 and `deps.ts` with T5 / T13 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** a deactivated member's conversations to return to the team automatically
> **So that** no customer waits on someone who no longer works here
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It returns a deactivated member's conversations to the team at the very moment their access ends.

## Inlined context

> In the same transaction that updates the membership, the `onMembershipDeactivated` port unassigns every conversation of this workspace assigned to that account, open and closed. It raises each version, inserts "unassigned — the member was deactivated" per conversation and publishes one signal per conversation (AC-10, ADR-0005). Another workspace's assignments of the same account are untouched. […] Reactivation changes only the membership, and the conversations stay unassigned.
>
> — `sad.md §6, Flow 12 prose, abridged` · full text: [sad.md](../sad.md)

> This changes the construction order in `buildDeps()`: `contacts` and `conversations` are now built before `team`, so `team` can receive the port.
>
> — `sad.md §5, Building block view, verbatim` · full text: [sad.md](../sad.md)

> A deactivation writes one activity entry and one NOTIFY per conversation assigned to the member, inside one transaction. This is fine up to a few thousand assigned conversations. Above that, batch the inserts and publish a single workspace-level resync signal instead.
>
> — `sad.md §7, Scaling thresholds, verbatim` · full text: [sad.md](../sad.md)

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Member change:** (1) memberships `FOR SHARE`; (2) the conversation row `FOR UPDATE`; (3) the `changes:<ws>:<account>` advisory lock, after the no-op, version and close checks; (4) the activity insert.
> **Deactivation:** (1) the workspace row `FOR UPDATE`; (2) the membership `UPDATE`, whose row lock conflicts with `FOR SHARE`; (3) the conversation rows assigned to the member (`UPDATE`); (4) activity inserts.
> **Capture:** contact upsert and message insert (unique key), then the conversation row (the raise `UPDATE`, returning status).
> **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.
>
> — `sad.md §8, Concurrency, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table · access | Change |
|---|---|
| `conversations` — `UPDATE … WHERE workspace_id = ? AND assignee_account_id = ?` via `conversations_workspace_id_assignee_status_idx` | `assignee_account_id → NULL`, `state_version + 1`, open and closed, status kept |
| `conversation_activities` | one `unassigned` / `member_deactivated` per conversation, `previous_assignee` = the member, no actor |

— `data-model.md §conversations Access patterns, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — the trigger is the unchanged `POST /memberships/{membershipId}/deactivate`; events: one `conversation.changed` `activity` per unassigned conversation, then `membership.deactivated`, all in one transaction — `contracts/events.md, realtime signals, abridged`.

## Acceptance criteria

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `unassignDeactivatedMember(tx, { workspaceId, accountId, at })`: select-and-lock the member's assigned conversations of that workspace, per row `recordChange(unassigned, cause 'member_deactivated')` — `conversations/app/state-changes.ts`, `conversations/infra/conversation-repo.ts`
- [ ] `buildDeps()`: build `contacts` and `conversations` before `team`; replace T5's no-op port with `conversations.unassignDeactivatedMember` — `apps/api/src/deps.ts`
- [ ] Integration tests: open + closed assigned conversations unassigned; other workspace untouched (`twoWorkspacesWithInbox`); throwing unassign rolls the deactivation back; reactivation leaves them unassigned — `state-changes.int.test.ts`, `workspaces/app/team.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member assigned in two workspaces, deactivated in one | only that workspace's conversations unassigned |
| Member with no assigned conversations | no entries, no conversation signals |
| Closed conversation assigned to the member | unassigned, stays closed |
| Deactivation refused (last active owner) | nothing unassigned |

## Definition of Done

- [ ] Integration tests prove that deactivating a member unassigns every conversation of that workspace assigned to them (open and closed) with one unassigned/member_deactivated entry and one signal each, in the deactivation's transaction; another workspace's assignments of the same account stay; reactivation gives nothing back; buildDeps wires the port and the admin CLI still builds.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
