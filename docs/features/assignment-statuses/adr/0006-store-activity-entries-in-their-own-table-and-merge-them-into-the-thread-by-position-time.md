---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0006 — Store activity entries in their own table and merge them into the thread by position time

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

Every assign, reassign, unassign, close and reopen must appear in the thread at the time it happened, among messages and replies. Each one names the member or the automatic cause, never counts as unread, never reaches the customer, and appears live (AC-09). Activity entries also serve as the audit trail behind the spec §6.1 abuse cases, and as the counting log for the per-member change limit (AC-12). The thread today merges two keyset halves (messages by `sent_at`, replies by `position_at`) with the cursor `(positionAt, kind, id)` (shared-inbox ADR-0008).

## Decision drivers

- Spec AC-09, and AC-12 (count only recorded changes; a reassignment is one)
- Spec §6.1 abuse case: every change attributed in the thread
- shared-inbox ADR-0008: the thread is paged by position time with a typed cursor
- Thread performance precedent (shared-inbox §6 thread p95)

## Considered options

1. **A `conversation_activities` table (kind, cause, actor, previous / new assignee, position time) as a third keyset half of the thread page.** Kind order at equal times: message < reply < activity.
2. **Store activity lines as rows in `replies` with a special kind.** Fewer merge halves, but it pollutes the delivery state machine, the drain's pending index and the reply limit with rows that are never delivered.
3. **Derive the history from a generic audit/event log table shared across modules.** It would be reusable later, but it is cross-module ownership with no current second user, and the thread would page over a table filtered by type.

## Decision outcome

**Chosen:** Option 1. It follows the existing per-kind table plus in-memory merge pattern exactly, keeps replies' invariants intact, and gives the change limit a natural log to count.

## Consequences

**Positive**
- The cursor change is small (a new `kind` value). Unread and last-activity logic are untouched because they read only messages and replies.
- Activity entries store account ids and the web panel composes the text, so names stay plain text and current.

**Negative**
- The thread page runs three keyset queries instead of two.
- The per-member limit count adds an index on `(workspace_id, actor, position time)`.

**Neutral**
- Activity entries are immutable. If needed later, retention can be handled like messages.

## Links

- Spec: [[../spec.md]] AC-09, AC-12, §6.1
- SAD: [[../sad.md]] §4 supporting choices, §5
- Related ADR: [[0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed]]; shared-inbox ADR-0008
