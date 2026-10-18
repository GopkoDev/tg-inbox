---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0005 — Track read state as a per-member arrival watermark per conversation

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Each member sees how many customer messages they have not read in each conversation (AC-01); opening a conversation marks everything that has arrived so far as read for that member only (AC-03); a message arriving in a thread open in a visible tab counts as read, an edit never makes a message unread again, and a late redelivery that takes an earlier place in the history still counts as unread by its arrival (AC-15); messages that arrived before the member joined or was reactivated count as read, and teammates' replies never count (AC-01). Today no read state exists and memberships carry no "active since" time.

## Decision drivers

- AC-01, AC-03, AC-15 — unread by arrival in tg-inbox, not by place in the history.
- Spec §6: inbox list p95 ≤ 500 ms server time for 1 000 conversations.
- Spec §6.1: per-member read state is new personal data — keep it minimal.

## Considered options

1. **Arrival watermark per (member, conversation)** — one row holding the arrival point the member has read through; unread = customer messages whose arrival is after the later of the watermark and the membership's active-since time.
2. **Per-message read receipts** — one row per (member, message) read.
3. **Unread counters per (member, conversation)** — incremented on capture for every member, reset on open.

## Decision outcome

**Chosen:** Option 1. Arrival order is exactly the order AC-15 counts by, so late redeliveries and edits fall out of the rule with no special cases; storage is one row per member and conversation they opened. Receipts (option 2) grow with messages × members for no behaviour the spec needs; counters (option 3) need a write per member on every capture and drift on concurrent opens and reactivations.

Rules: the watermark is advanced only (never moved back) to the arrival cursor of the newest message the client has actually displayed — the server issues the cursor, so a message that arrives between the thread read and the mark is not marked read unseen; marking happens on open and while the thread is visible in the foreground. `memberships` gains an active-since time (set at join and on reactivation) that `workspaces` exposes with the guard result, so reactivation also resets the floor. Unread counts for a list page are computed per row over the messages index on (conversation, arrival).

## Consequences

**Positive**
- AC-15's redelivery and edit rules hold by construction; no per-capture fan-out writes.
- Minimal personal data: one timestamp per member and conversation.

**Negative**
- Unread counts are computed at read time; a conversation with a very long unread tail costs a longer count (bounded by the index; §10 verifies the list target).
- A cross-module input (active-since) from `workspaces` is needed by every list read.

**Neutral**
- Per-message "seen by" indicators, if ever wanted, would need option 2 in addition.

## Links

- Spec: [[../spec.md]] AC-01, AC-03, AC-15; §6; §6.1
- SAD: [[../sad.md]] §4, §5, §10
- Related ADR: [[0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads]]
