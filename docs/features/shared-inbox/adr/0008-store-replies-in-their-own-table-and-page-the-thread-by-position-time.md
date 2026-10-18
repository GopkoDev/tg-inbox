---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0008 — Store replies in their own table and page the thread by position time

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

A thread shows the customer's messages and the team's replies in the order they happened, scrolls back to the first message (AC-03, up to 5 000 items within 500 ms for the latest page — spec §6), and a reply resent with "Try again" moves to the end at the time it was sent again (AC-12). Messages are ordered by Telegram's message id and edited by edit time (bot-connection ADR-0004); a late redelivery takes its earlier place. Replies have a different life: an author, a delivery state machine, attempts, a client key; until sent they have no Telegram message id.

## Decision drivers

- AC-03 order + pagination; AC-12 "moves to the end of the thread"; AC-15 late redelivery keeps its place.
- Spec §6: thread open p95 ≤ 500 ms server time for the latest page of a 5 000-message conversation.
- bot-connection's `messages` table and its constraints (unique per Telegram message id, kind check, required body for text) stay valid.

## Considered options

1. **Separate `replies` table; the thread pages a union of both, ordered by position time** — a message's position is its Telegram send time with its message id as tie-break; a reply's position is when a member (re)sent it.
2. **One table for both directions** — `messages` gains a direction column and the reply columns.
3. **Order everything by Telegram message id** — replies take their sent message's id (one sequence per private chat); unsent replies are appended.

## Decision outcome

**Chosen:** Option 1. Each table keeps its own constraints and lifecycle (option 2 loosens the capture table's invariants — nullable Telegram ids, author columns meaningless for customers — to fit replies), and a keyset page over two indexed tables merged by (position time, kind, id) is cheap at the spec's sizes. Option 3 cannot place replies that were never sent (not delivered / not confirmed), which must still sit in the thread, and makes "moves to the end at the time it was sent again" impossible.

Rules: the thread cursor is (position time, kind, id); customer messages position by their Telegram send time (second precision — a reply and a message within the same second keep message-before-reply), replies by their (re)send time; edits never move a message; a late redelivery positions by its original send time.

## Consequences

**Positive**
- Capture stays untouched; the reply state machine has its own table and constraints.
- The thread is one query module-wise, paged in both directions.

**Negative**
- Two clocks meet in one order (Telegram's for messages, ours for replies); same-second ties are resolved by rule, not by truth.
- Every thread page is a union of two index scans.

**Neutral**
- A later unified "timeline" table (e.g. with internal notes) can replace the union behind the same use case.

## Links

- Spec: [[../spec.md]] AC-03, AC-12, AC-15; §6
- SAD: [[../sad.md]] §5, §8, §10
- Related ADR: [[0007-add-an-inbox-module-that-orchestrates-conversations-contacts-bots-and-workspaces]], [[0004-send-replies-at-most-once-through-a-per-conversation-delivery-queue-with-an-in-flight-mark]], bot-connection [[../../bot-connection/adr/0004-order-messages-by-telegram-message-id-and-apply-edits-by-telegram-edit-time]]
