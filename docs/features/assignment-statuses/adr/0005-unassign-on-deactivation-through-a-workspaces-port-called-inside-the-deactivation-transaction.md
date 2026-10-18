---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0005 — Unassign on deactivation through a workspaces port called inside the deactivation transaction

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

AC-10 says that deactivating a membership unassigns every conversation of that workspace assigned to the member, as part of the deactivation itself. There must never be a moment when a deactivated member is an assignee, and an assignment to them made at the same moment is refused (AC-04). Deactivation lives in `workspaces` (`team.deactivateMembership`, one unit-of-work transaction that locks the workspace row `FOR UPDATE`, then `UPDATE`s the membership's state). Conversations live in `conversations`. `workspaces` depends on no feature module, and it must not query `conversations`' tables. `inbox` already depends on both.

## Decision drivers

- Spec §6 "Deactivation unassign — 0 conversations assigned to a deactivated member at any moment"; "Single assignee — 0 … with an assignee who is not an active member"
- `CLAUDE.md`: one-way dependencies, cross-module only through app layers, no foreign tables
- Precedent: `team` already receives `publish(tx, …)` from the composition root and calls it inside its transaction, and `conversations` passes `tx` into `contacts.upsertFromProfile`

## Considered options

1. **A port declared by `workspaces` (`onMembershipDeactivated(tx, …)`) and filled in `buildDeps()` with `conversations.unassignDeactivatedMember`, called inside the deactivation transaction.** Member changes share-lock the actor's and target's memberships (`workspaces.lockActiveMembers(tx, …)`) before locking the conversation. The deactivation's membership `UPDATE` takes a row lock that conflicts with `FOR SHARE`.
2. **Move deactivation orchestration into `inbox`.** An inbox use case opens the transaction and calls `workspaces` then `conversations`. Settings — Team routes belong to `workspaces`, so the team use case would have to be split across modules, and the admin CLI path would bypass it.
3. **React asynchronously to the existing `membership.deactivated` signal or a pg-boss job.** This keeps the modules fully decoupled, but leaves a window where a deactivated member is still an assignee, which violates AC-10 and the §6 target.
4. **Treat assignments to inactive members as unassigned at read time.** No write is needed, but no activity entry is recorded either, the stored data lies, and reactivation would silently give the conversations back (contradicting AC-10).

## Decision outcome

**Chosen:** Option 1. It is atomic, keeps the dependency direction (`workspaces` declares the interface and imports nothing from `conversations`), and matches the existing `publish` callback pattern. The lock protocol makes the race in AC-10 deterministic. If the deactivation commits first, a waiting assign sees "deactivated" and is refused. If the assign holds the share lock first, it commits first, the deactivation waits, and its unassign then clears that assignment too, with an activity entry. AC-10 says "refused". The second order cannot refuse a change that has already committed, but no assignment to a deactivated member ever exists (SAD §1 decision override).

## Consequences

**Positive**
- The invariant holds at every committed moment, whether deactivation comes through the panel or the admin CLI (both go through `buildDeps()`).
- Locking the caller's own membership also closes the mid-request deactivation gap for every member change.
- The lock order is the same in every path (memberships → conversation row), so there are no deadlocks.

**Negative**
- `buildDeps()` must build `conversations` before `team`, and `workspaces` unit tests need a fake for the port.
- Deactivating a member with many assignments makes the deactivation transaction proportionally longer (§7 threshold).

**Neutral**
- A composite FK `(workspace_id, assignee_account_id) → memberships` adds same-workspace integrity as a constraint only, not "active". Active is guaranteed by this protocol and audited by the integrity query.

## Links

- Spec: [[../spec.md]] AC-10, AC-04, AC-11, §6
- SAD: [[../sad.md]] §4 choice 5, §5, §6 flow 3, §8 Concurrency
- Related ADR: [[0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes]]; workspace-operators ADR-0005; shared-inbox ADR-0007
