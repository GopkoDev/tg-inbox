---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0004 — Reopen closed conversations inside the capture and reply-outcome transactions

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

A closed conversation must reopen when its customer sends a new message (AC-07, including a late redelivery but not an edit), and when one of its replies ends "not delivered" or "not confirmed" (AC-08). In both cases the assignee is kept, an activity entry is recorded and the team sees it live within 3 s. Both causes are already recorded by `conversations` in one transaction each. The first is `captureInbound`. Its upsert takes no row lock (`ON CONFLICT DO NOTHING` + a plain read), and the conversation row is first locked by the `raiseReceived` `UPDATE` after the message insert. The second is the reply-outcome path. Every reply that becomes "not delivered" or "not confirmed" passes through `settle()` in `conversations/app/replies.ts`: `finishAttempt`, `skipReply`, `resolveStaleInFlight` and the dead-letter resolution.

## Decision drivers

- Spec §6 "Reopen on customer message p95 — message captured → conversation shown open to the team ≤ 3 s"
- Spec §6 "Lost customers — 0 closed conversations whose latest customer message arrived after the close"
- shared-inbox ADR-0003: signals are published in the writing transaction
- The no-triggers rule in `CLAUDE.md`

## Considered options

1. **Reopen inside the existing capture and reply-outcome transactions.** In capture, the raise `UPDATE` also raises the customer message counter and returns status and assignee under its row lock. In `settle()`, the conversation row is locked after the reply. If the locked status is closed and the message is newly captured, or the reply newly failed, the transaction sets it open, raises the version, inserts the activity entry (positioned at the clock read after the lock, never before the latest entry) and publishes the signal, all before the commit.
2. **An async pg-boss job (`conversations.reopen`) enqueued from those transactions.** It decouples the reopen, but there is a window in which the conversation is closed with a later arrival (an integrity violation), plus job latency against the 3 s target.

## Decision outcome

**Chosen:** Option 1. A database trigger is excluded by the repo rules (no triggers) and was not weighed. Only an in-transaction reopen makes "0 closed conversations with a later arrival" true at every moment, and it adds no queue latency.

## Consequences

**Positive**
- One reopen point per cause, both in `conversations/app`: capture, and `settle()` for every failed-reply path. Spec §8 OQ-2 (ignore a "thanks") has a single place to change.
- Idempotent capture means duplicate redeliveries do nothing, and edits go through `applyEdit`, which never reopens.

**Negative**
- The reopen decision must read status from the locked `UPDATE`, never from the upsert's plain read. A test races capture against close.
- Capture and reply-outcome transactions now take part in the close race on the conversation row lock, which adds a little latency when a close holds it.
- The webhook path gains an activity insert and a second signal on a reopen.

**Neutral**
- The customer-reopen entry sits at the moment its capture is recorded (its arrival), never before the close it undoes, while a late-redelivered message keeps its earlier send-time position (AC-07).

## Links

- Spec: [[../spec.md]] AC-07, AC-08, §6
- SAD: [[../sad.md]] §4 choice 4, §6 flow 2
- Related ADR: [[0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes]], [[0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot]]; bot-connection ADR-0003; shared-inbox ADR-0004
